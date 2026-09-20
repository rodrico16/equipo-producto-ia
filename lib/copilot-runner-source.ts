export const copilotRunnerSource = String.raw`
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BuiltInTools, CopilotClient, ToolSet } from "@github/copilot-sdk";

const rawToken = process.env.COPILOT_GITHUB_TOKEN;
const model = process.env.COPILOT_MODEL || "auto";
const reasoningEffort = process.env.COPILOT_REASONING_EFFORT || "";
const task = process.env.COPILOT_TASK || "";
const runMode = process.env.COPILOT_MODE || "pr";
const workdir = process.env.COPILOT_WORKDIR || process.cwd();
const agentDir = process.env.COPILOT_AGENT_DIR || path.join(workdir, ".codex", "agents");
const copilotHome = path.join("/tmp", "copilot-home-" + process.pid);
const requestedTurnTimeout = Number(process.env.COPILOT_TURN_TIMEOUT_MS || "240000");
const turnTimeoutMs = Number.isFinite(requestedTurnTimeout)
  ? Math.max(30_000, Math.min(900_000, requestedTurnTimeout))
  : 240_000;

if (!rawToken) throw new Error("Missing COPILOT_GITHUB_TOKEN");
if (!task.trim()) throw new Error("Missing COPILOT_TASK");

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

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

function walk(value, visit, depth = 0) {
  if (depth > 6 || value == null) return;
  const parsed = parseMaybeJson(value);
  if (parsed !== value) return walk(parsed, visit, depth + 1);
  if (Array.isArray(parsed)) {
    for (const item of parsed) walk(item, visit, depth + 1);
    return;
  }
  if (typeof parsed === "object") {
    for (const [key, child] of Object.entries(parsed)) {
      visit(key, child);
      walk(child, visit, depth + 1);
    }
  }
}

function isTaskTool(toolName) {
  const normalized = String(toolName || "").toLowerCase().replace(/[.:-]/g, "_");
  return normalized === "task" || normalized.endsWith("_task") || normalized.includes("start_agent") || normalized.includes("tasks_start");
}

function taskDelegation(toolName, rawArguments, toolCallId, knownAgents) {
  if (!isTaskTool(toolName)) return null;

  const names = new Set(["agent_type", "agenttype", "agent_name", "agentname", "agent"]);
  const assignmentKeys = new Set(["prompt", "task", "message", "description", "instructions", "objective"]);
  let agentName = "";
  let assignment = "";

  walk(rawArguments, (key, value) => {
    const normalized = String(key || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!agentName && names.has(normalized) && typeof value === "string") agentName = value.trim();
    if (!assignment && assignmentKeys.has(normalized) && typeof value === "string") assignment = value.trim();
  });

  let serialized = "";
  try { serialized = JSON.stringify(rawArguments ?? {}); } catch { serialized = String(rawArguments ?? ""); }
  const haystack = serialized.toLowerCase();

  if (!agentName) {
    const match = knownAgents.find((agent) => {
      const name = String(agent.name || "").toLowerCase();
      const display = String(agent.displayName || "").toLowerCase();
      return (name && haystack.includes(name)) || (display && haystack.includes(display));
    });
    if (match) agentName = match.name;
  }

  if (!assignment && typeof rawArguments === "string") assignment = rawArguments.trim();
  if (!assignment && serialized && serialized !== "{}") assignment = serialized.slice(0, 1200);

  const provisional = !agentName;
  if (!agentName) agentName = `especialista_pendiente_${String(toolCallId || Date.now()).slice(-8)}`;
  return {
    agentName,
    assignment: assignment || "Delegación iniciada por Supervisor",
    provisional,
  };
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

await mkdir(copilotHome, { recursive: true });
const { agents, supervisorPrompt } = await loadAgents();
emit("team.loaded", { count: agents.length + 1, model, reasoningEffort, mode: runMode });

const client = new CopilotClient({
  useLoggedInUser: false,
  mode: "empty",
  workingDirectory: workdir,
  baseDirectory: copilotHome,
  sessionIdleTimeoutSeconds: 900,
  logLevel: "error",
});

try {
  emit("runtime.stage", { stage: "client.start", message: "Iniciando runtime de Copilot…" });
  await client.start();

  const availableTools = new ToolSet().addBuiltIn(BuiltInTools.Isolated);
  if (runMode !== "chat") {
    availableTools.addBuiltIn(["bash", "view", "edit", "create_file", "grep", "glob"]);
  }

  const sessionConfig = {
    gitHubToken: githubToken,
    model,
    workingDirectory: workdir,
    streaming: true,
    includeSubAgentStreamingEvents: true,
    customAgents: agents,
    availableTools,
    enableSessionTelemetry: false,
    onPermissionRequest: async () => ({ kind: "approve-once" }),
  };
  if (reasoningEffort) sessionConfig.reasoningEffort = reasoningEffort;

  emit("runtime.stage", { stage: "session.create", message: "Autenticando tu cuenta de GitHub Copilot…" });
  const session = await client.createSession(sessionConfig);
  emit("copilot.connected", { model, reasoningEffort, mode: runMode });

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
      const delegation = taskDelegation(event.data.toolName, event.data.arguments, event.data.toolCallId, agents);
      if (delegation) {
        const configured = agents.find((agent) => agent.name === delegation.agentName);
        emit("specialist.assigned", {
          toolCallId: event.data.toolCallId,
          agentName: delegation.agentName,
          agentDisplayName: configured?.displayName || (delegation.provisional ? "Especialista…" : delegation.agentName),
          agentDescription: configured?.description || "Especialista delegado por Supervisor",
          assignment: delegation.assignment,
          provisional: delegation.provisional,
        }, delegation.agentName);
        // Keep compatibility with the current UI, which already opens a thread
        // for subagent.started. This event is guaranteed for every task call.
        emit("subagent.started", {
          toolCallId: event.data.toolCallId,
          agentName: delegation.agentName,
          agentDisplayName: configured?.displayName || (delegation.provisional ? "Especialista…" : delegation.agentName),
          agentDescription: configured?.description || "Especialista delegado por Supervisor",
          assignment: delegation.assignment,
          synthetic: true,
          provisional: delegation.provisional,
        }, delegation.agentName);
      }
      emit("tool.started", {
        toolCallId: event.data.toolCallId,
        toolName: event.data.toolName,
        arguments: delegation
          ? { agent_type: delegation.agentName, prompt: delegation.assignment, provisional: delegation.provisional }
          : event.data.arguments,
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

  const modeRules = runMode === "chat"
    ? [
        "- Estás en modo conversación: respondé el pedido sin modificar archivos del workspace.",
        "- Podés delegar análisis a especialistas si aporta valor, pero no ejecutes cambios de código ni operaciones de entrega.",
        "- No hagas git commit, git push ni crees Pull Requests.",
        "- La respuesta final debe ser útil y directa, no un reporte de implementación.",
      ]
    : runMode === "draft"
      ? [
          "- Trabajá sobre el repositorio abierto y completá el cambio solicitado dentro del Sandbox.",
          "- Delegá a especialistas cuando aporten valor y ejecutá las verificaciones/tests relevantes.",
          "- No hagas git commit, git push ni crees Pull Requests; este modo es un borrador privado.",
          "- Conservá cambios existentes y evitá operaciones destructivas no necesarias.",
          "- La respuesta final debe resumir qué cambió y qué verificaste.",
        ]
      : [
          "- No te quedes en un plan: implementá el cambio completo en el repositorio abierto.",
          "- Delegá a los agentes especializados que realmente aporten valor y dejá que implementen/revisen.",
          "- Antes de cerrar, ejecutá las verificaciones y tests relevantes disponibles en el proyecto.",
          "- No hagas git commit, git push ni crees PR; el control room hace la publicación después.",
          "- Conservá cambios existentes del usuario y evitá operaciones destructivas no necesarias.",
          "- La respuesta final debe resumir qué cambió, pruebas ejecutadas, riesgos y pendientes.",
        ];

  const prompt = [
    "Actuás como Supervisor del equipo de Producto e Ingeniería definido por esta aplicación.",
    supervisorPrompt,
    "",
    "OBJETIVO DEL USUARIO:",
    task,
    "",
    "REGLAS DE EJECUCIÓN:",
    ...modeRules,
    "- No accedas a credenciales ni intentes ampliar los permisos disponibles.",
  ].join("\n");

  emit("run.started", { task, mode: runMode });
  emit("runtime.stage", {
    stage: "turn.send",
    message: "Copilot está coordinando el equipo…",
    timeoutMs: turnTimeoutMs,
  });
  await session.sendAndWait({ prompt }, turnTimeoutMs);
  emit("run.completed", { sessionId: session.sessionId, mode: runMode });
  await session.disconnect();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  emit("run.failed", {
    message,
    name: error instanceof Error ? error.name : "Error",
    stage: "copilot-sdk",
  });
  process.exitCode = 1;
} finally {
  await client.stop().catch(() => []);
}
`;
