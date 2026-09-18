export const copilotRunnerSource = String.raw`
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CopilotClient } from "@github/copilot-sdk";

const rawToken = process.env.COPILOT_GITHUB_TOKEN;
const model = process.env.COPILOT_MODEL || "auto";
const task = process.env.COPILOT_TASK || "";
const workdir = process.env.COPILOT_WORKDIR || process.cwd();
const agentDir = process.env.COPILOT_AGENT_DIR || path.join(workdir, ".codex", "agents");

if (!rawToken) throw new Error("Missing COPILOT_GITHUB_TOKEN");
if (!task.trim()) throw new Error("Missing COPILOT_TASK");

// Keep the credential in memory only. Tool subprocesses inherit process.env,
// so remove it before the Copilot runtime (and its bash tool) starts.
const githubToken = rawToken;
delete process.env.COPILOT_GITHUB_TOKEN;

function emit(type, data = {}, agentId) {
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
  let supervisorPrompt = "";

  for (const file of files) {
    const source = await readFile(path.join(agentDir, file), "utf8");
    const name = valueOf(source, "name") || file.replace(/\.toml$/, "");
    const description = valueOf(source, "description") || name;
    const instructions = multilineOf(source, "developer_instructions") || description;

    if (name === "supervisor") {
      supervisorPrompt = instructions;
      continue;
    }

    agents.push({
      name,
      displayName: name.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()),
      description,
      prompt: instructions,
      infer: true,
    });
  }

  return { agents, supervisorPrompt };
}

const { agents, supervisorPrompt } = await loadAgents();
emit("team.loaded", { count: agents.length + 1, model });

const client = new CopilotClient({
  gitHubToken: githubToken,
  useLoggedInUser: false,
  mode: "empty",
  workingDirectory: workdir,
  logLevel: "error",
});

try {
  await client.start();
  emit("copilot.connected", { model });

  const session = await client.createSession({
    model,
    workingDirectory: workdir,
    streaming: true,
    includeSubAgentStreamingEvents: true,
    customAgents: agents,
    onPermissionRequest: async () => ({ kind: "approve-once" }),
  });

  session.on((event) => {
    const agentId = event.agentId;

    if (event.type === "assistant.message_delta") {
      emit("agent.delta", {
        messageId: event.data.messageId,
        content: event.data.deltaContent || "",
      }, agentId || "supervisor");
      return;
    }
    if (event.type === "assistant.message") {
      emit("agent.message", {
        messageId: event.data.messageId,
        content: event.data.content || "",
      }, agentId || "supervisor");
      return;
    }
    if (event.type === "tool.execution_start") {
      emit("tool.started", {
        toolCallId: event.data.toolCallId,
        toolName: event.data.toolName,
        arguments: event.data.arguments,
      }, agentId || "supervisor");
      return;
    }
    if (event.type === "tool.execution_complete") {
      emit("tool.completed", {
        toolCallId: event.data.toolCallId,
        success: event.data.success,
        error: event.data.error,
      }, agentId || "supervisor");
      return;
    }
    if (event.type.startsWith("subagent.")) {
      emit(event.type, event.data, agentId);
    }
  });

  const prompt = [
    "Actuás como Supervisor del equipo de Producto e Ingeniería definido por este repositorio.",
    supervisorPrompt,
    "",
    "OBJETIVO DEL USUARIO:",
    task,
    "",
    "REGLAS DE EJECUCIÓN:",
    "- No te quedes en un plan: implementá el cambio completo en el repositorio abierto.",
    "- Delegá a los agentes especializados que realmente aporten valor y dejá que implementen/revisen.",
    "- Antes de cerrar, ejecutá las verificaciones y tests relevantes disponibles en el proyecto.",
    "- No hagas git commit, git push ni crees PR; el control room hace la publicación después.",
    "- No accedas a credenciales ni intentes ampliar los permisos disponibles.",
    "- Conservá cambios existentes del usuario y evitá operaciones destructivas no necesarias.",
    "- La respuesta final debe resumir qué cambió, pruebas ejecutadas, riesgos y pendientes.",
  ].join("\n");

  emit("run.started", { task });
  await session.sendAndWait({ prompt });
  emit("run.completed", { sessionId: session.sessionId });
  await session.disconnect();
} catch (error) {
  emit("run.failed", { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  await client.stop().catch(() => []);
}
`;
