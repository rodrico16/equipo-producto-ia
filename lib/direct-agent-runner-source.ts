export const directAgentRunnerSource = String.raw`
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BuiltInTools, CopilotClient, ToolSet } from "@github/copilot-sdk";

const rawToken = process.env.COPILOT_GITHUB_TOKEN;
const model = process.env.COPILOT_MODEL || "auto";
const reasoningEffort = process.env.COPILOT_REASONING_EFFORT || "";
const task = process.env.COPILOT_TASK || "";
const targetAgent = process.env.COPILOT_TARGET_AGENT || "";
const workdir = process.env.COPILOT_WORKDIR || process.cwd();
const agentDir = process.env.COPILOT_AGENT_DIR || path.join(workdir, ".codex", "agents");
const copilotHome = path.join("/tmp", "copilot-direct-home-" + process.pid);

if (!rawToken) throw new Error("Missing COPILOT_GITHUB_TOKEN");
if (!task.trim()) throw new Error("Missing COPILOT_TASK");
if (!targetAgent.trim()) throw new Error("Missing COPILOT_TARGET_AGENT");

const githubToken = rawToken;
delete process.env.COPILOT_GITHUB_TOKEN;

function emit(type, data = {}, agentId = targetAgent) {
  process.stdout.write(JSON.stringify({ type, data, agentId, at: new Date().toISOString() }) + "\n");
}
function valueOf(source, key) {
  const quoted = source.match(new RegExp("^" + key + "\\s*=\\s*\"([^\"]*)\"", "m"));
  return quoted?.[1]?.trim() || "";
}
function multilineOf(source, key) {
  const match = source.match(new RegExp(key + "\\s*=\\s*'''([\\s\\S]*?)'''", "m"));
  return match?.[1]?.trim() || "";
}

async function loadAgents() {
  const files = (await readdir(agentDir)).filter((file) => file.endsWith(".toml")).sort();
  const agents = [];
  for (const file of files) {
    const source = await readFile(path.join(agentDir, file), "utf8");
    const name = valueOf(source, "name") || file.replace(/\.toml$/, "");
    if (name === "supervisor") continue;
    const description = valueOf(source, "description") || name;
    const instructions = multilineOf(source, "developer_instructions") || description;
    agents.push({
      name,
      displayName: name.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()),
      description,
      prompt: instructions,
      infer: false,
    });
  }
  return agents;
}

await mkdir(copilotHome, { recursive: true });
const agents = await loadAgents();
const selected = agents.find((agent) => agent.name === targetAgent);
if (!selected) throw new Error("Unknown specialist: " + targetAgent);

emit("team.loaded", { count: agents.length + 1, targetAgent, model, reasoningEffort });

const client = new CopilotClient({
  useLoggedInUser: false,
  mode: "empty",
  workingDirectory: workdir,
  baseDirectory: copilotHome,
  sessionIdleTimeoutSeconds: 900,
  logLevel: "error",
});

try {
  await client.start();
  const availableTools = new ToolSet().addBuiltIn(BuiltInTools.Isolated);
  availableTools.addBuiltIn(["view", "grep", "glob"]);

  const sessionConfig = {
    gitHubToken: githubToken,
    model,
    workingDirectory: workdir,
    streaming: true,
    customAgents: agents,
    agent: targetAgent,
    availableTools,
    enableSessionTelemetry: false,
    onPermissionRequest: async () => ({ kind: "approve-once" }),
  };
  if (reasoningEffort) sessionConfig.reasoningEffort = reasoningEffort;

  const session = await client.createSession(sessionConfig);
  emit("run.started", { targetAgent, mode: "agent" });

  session.on((event) => {
    if (event.type === "assistant.message_delta") {
      emit("agent.delta", { messageId: event.data.messageId, content: event.data.deltaContent || "" });
      return;
    }
    if (event.type === "assistant.message") {
      emit("agent.message", { messageId: event.data.messageId, content: event.data.content || "" });
      return;
    }
    if (event.type === "tool.execution_start") {
      emit("tool.started", {
        toolCallId: event.data.toolCallId,
        toolName: event.data.toolName,
        arguments: event.data.arguments,
      });
      return;
    }
    if (event.type === "tool.execution_complete") {
      emit("tool.completed", {
        toolCallId: event.data.toolCallId,
        success: event.data.success,
        error: event.data.error,
      });
    }
  });

  const prompt = [
    "Estás en un chat paralelo directo con el usuario como especialista del equipo.",
    "Tu identidad es " + selected.displayName + ".",
    "Respondé desde tu especialidad y usá el repositorio sólo para inspeccionar contexto cuando haga falta.",
    "No modifiques archivos, no hagas commits, no hagas push y no crees Pull Requests.",
    "El usuario puede estar corrigiendo o redefiniendo una tarea que originalmente te delegó el Supervisor.",
    "Dejá muy claro qué cambiarías o qué recomendás para que el Supervisor pueda incorporar el ajuste en su próximo turno.",
    "",
    "MENSAJE DEL USUARIO:",
    task,
  ].join("\n");

  await session.sendAndWait({ prompt }, 240_000);
  emit("run.completed", { sessionId: session.sessionId, targetAgent, mode: "agent" });
  await session.disconnect();
} catch (error) {
  emit("run.failed", {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : "Error",
    stage: "direct-agent",
  });
  process.exitCode = 1;
} finally {
  await client.stop().catch(() => []);
}
`;
