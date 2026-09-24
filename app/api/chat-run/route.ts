import type { Sandbox } from "@vercel/sandbox";
import { readCodexAuth } from "@/lib/chatgpt-auth-cookie";
import { createChatGPTWorkerSandbox } from "@/lib/chatgpt-sandbox";
import { getGitHubSession, requireControlRoomIdentity } from "@/lib/server-auth";
import { finishRun, getRun, startRun } from "@/lib/run-store";
import { validateAttachments, writeRunAttachments, type RunAttachment } from "@/lib/run-attachments";

export const runtime = "nodejs";
export const maxDuration = 300;

type RunMode = "chat" | "draft";
type RunRequest = {
  mode?: RunMode;
  repo?: string;
  branch?: string;
  model?: string;
  reasoningEffort?: string;
  prompt?: string;
  attachments?: RunAttachment[];
};
type JsonRecord = Record<string, unknown>;

const encoder = new TextEncoder();
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function line(payload: unknown) {
  return encoder.encode(JSON.stringify(payload) + "\n");
}
function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}
function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}
function agentName(item: JsonRecord) {
  const direct = asString(item.agentName) || asString(item.agent_name) || asString(item.agent_type) || asString(item.agentType) || asString(item.role);
  if (direct) return direct;
  const args = asRecord(item.arguments);
  return asString(args.agentName) || asString(args.agent_name) || asString(args.agent_type) || asString(args.agentType);
}
function emitEvent(controller: ReadableStreamDefaultController<Uint8Array>, event: JsonRecord) {
  const type = asString(event.type);
  const item = asRecord(event.item);
  const itemType = asString(item.type).toLowerCase();
  const itemId = asString(item.id) || `${Date.now()}`;
  const name = agentName(item);

  if (type === "thread.started") {
    controller.enqueue(line({ type: "run.started", agentId: "supervisor", data: { provider: "chatgpt" } }));
    return;
  }
  if (type === "turn.started") {
    controller.enqueue(line({ type: "control.status", data: { message: "El equipo está pensando…" } }));
    return;
  }
  if (type === "turn.completed") {
    controller.enqueue(line({ type: "run.completed", agentId: "supervisor", data: { provider: "chatgpt" } }));
    return;
  }
  if (type === "turn.failed" || type === "error") {
    controller.enqueue(line({
      type: "run.failed",
      agentId: "supervisor",
      data: { message: asString(event.message) || asString(asRecord(event.error).message) || "Codex execution failed" },
    }));
    return;
  }

  if (type === "rollout.assignment") {
    const assignment = asString(item.assignment).trim();
    if (name && assignment) {
      controller.enqueue(line({
        type: "tool.started",
        agentId: "supervisor",
        data: {
          toolName: "task",
          arguments: { agent_type: name, prompt: assignment },
          source: "codex-rollout-bridge",
        },
      }));
    }
    return;
  }

  const looksLikeSubagent = itemType.includes("subagent") || itemType.includes("collab") || Boolean(name);
  if (looksLikeSubagent && name) {
    if (type === "item.started") {
      controller.enqueue(line({ type: "subagent.started", agentId: asString(item.agent_id) || itemId, data: { agentName: name } }));
    } else if (type === "item.completed") {
      controller.enqueue(line({ type: "subagent.completed", agentId: asString(item.agent_id) || itemId, data: { agentName: name } }));
    }
  }

  if (type === "item.started" && itemType === "command_execution") {
    controller.enqueue(line({ type: "tool.started", agentId: name || "supervisor", data: { toolName: asString(item.command) || "command" } }));
    return;
  }
  if (type === "item.completed" && itemType === "command_execution") {
    controller.enqueue(line({
      type: "tool.completed",
      agentId: name || "supervisor",
      data: { success: asString(item.status) !== "failed", toolName: asString(item.command) || "command" },
    }));
    return;
  }
  if (type === "item.completed" && itemType === "agent_message") {
    const text = asString(item.text) || asString(item.content);
    if (text) controller.enqueue(line({ type: "agent.message", agentId: name || "supervisor", data: { content: text, messageId: itemId } }));
  }
}
function githubHeaders(token?: string) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as RunRequest;
  const mode: RunMode = body.mode === "draft" ? "draft" : "chat";
  const prompt = body.prompt?.trim();
  const model = body.model?.trim() || "auto";
  const reasoningEffort = body.reasoningEffort?.trim();
  const repo = body.repo?.trim() || "";

  if (!prompt) return Response.json({ error: "Prompt is required" }, { status: 400 });
  let attachments: RunAttachment[];
  try { attachments = validateAttachments(body.attachments); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
  if (mode === "draft" && !repoPattern.test(repo)) return Response.json({ error: "Choose a repository first" }, { status: 400 });

  let runOwner = "";
  let runId = request.headers.get("x-run-id") || "";
  try {
    const identity = await requireControlRoomIdentity();
    runOwner = identity.key;
    const existing = runId ? getRun(runId, runOwner) : null;
    if (existing) return Response.json(existing, { status: 409, headers: { "X-Run-Id": existing.id } });
    runId = startRun(runOwner, runId).id;
  } catch {
    return Response.json({ error: "Session required" }, { status: 401 });
  }

  const authJson = await readCodexAuth();
  if (!authJson) return Response.json({ error: "Conectá ChatGPT para continuar" }, { status: 401 });
  const github = await getGitHubSession();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sandbox: Sandbox | undefined;
      try {
        controller.enqueue(line({ type: "control.status", data: { message: mode === "chat" ? "Abriendo una sesión de chat…" : "Preparando el repositorio…" } }));
        sandbox = await createChatGPTWorkerSandbox(authJson);

        const workspaceResult = await sandbox.runCommand("bash", ["-lc", "mkdir -p /tmp/control-room-work && mktemp -d /tmp/control-room-work/run-XXXXXX"]);
        if (workspaceResult.exitCode !== 0) throw new Error("Could not create workspace");
        const workspace = (await workspaceResult.stdout()).trim();
        let cwd = workspace;
        let baseBranch = body.branch?.trim() || "main";

        if (mode === "draft") {
          const repoResponse = await fetch(`https://api.github.com/repos/${repo}`, { headers: githubHeaders(github?.token), cache: "no-store" });
          if (!repoResponse.ok) {
            if (!github && (repoResponse.status === 404 || repoResponse.status === 403)) throw new Error("Conectá GitHub para trabajar con repositorios privados.");
            throw new Error(`GitHub repository access failed (${repoResponse.status})`);
          }
          const info = (await repoResponse.json()) as { default_branch?: string; private?: boolean };
          if (!github && info.private) throw new Error("Conectá GitHub para trabajar con repositorios privados.");
          baseBranch = body.branch?.trim() || info.default_branch || "main";
          cwd = `${workspace}/${repo.split("/")[1]}`;
          const clone = github
            ? await sandbox.runCommand({
                cmd: "bash",
                args: ["-lc", 'AUTH=$(printf "x-access-token:%s" "$GH_TOKEN" | base64 | tr -d "\\n"); git -c http.extraHeader="Authorization: Basic $AUTH" clone --depth 1 --branch "$BASE" "https://github.com/$REPO.git" "$TARGET"'],
                env: { GH_TOKEN: github.token, BASE: baseBranch, REPO: repo, TARGET: cwd },
              })
            : await sandbox.runCommand({
                cmd: "git",
                args: ["clone", "--depth", "1", "--branch", baseBranch, `https://github.com/${repo}.git`, cwd],
              });
          if (clone.exitCode !== 0) throw new Error(`Git clone failed: ${(await clone.stderr()).slice(-900)}`);
        } else {
          const init = await sandbox.runCommand({ cmd: "git", args: ["init", "-q"], cwd });
          if (init.exitCode !== 0) throw new Error("Could not initialize chat workspace");
        }

        const agentsClone = await sandbox.runCommand("git", ["clone", "--depth", "1", "https://github.com/rodrico16/equipo-producto-ia.git", "/tmp/equipo-producto-ia-agents"]);
        if (agentsClone.exitCode !== 0) throw new Error(`Could not load agent catalog: ${(await agentsClone.stderr()).slice(-900)}`);
        const install = await sandbox.runCommand({
          cmd: "bash",
          args: ["-lc", 'mkdir -p .codex/agents; cp -n /tmp/equipo-producto-ia-agents/.codex/agents/*.toml .codex/agents/; grep -qxF "/.codex/" .git/info/exclude || echo "/.codex/" >> .git/info/exclude; find .codex/agents -maxdepth 1 -name "*.toml" | wc -l'],
          cwd,
        });
        if (install.exitCode !== 0) throw new Error(`Could not install agent profiles: ${(await install.stderr()).slice(-900)}`);
        controller.enqueue(line({ type: "team.loaded", data: { count: Number((await install.stdout()).trim()) || 0, provider: "chatgpt" } }));

        const instructions = mode === "chat"
          ? [
              "You are coordinating the AI Product Team in conversation-only mode.",
              "Use the supervisor and specialist agents when they materially improve the answer.",
              "Do not create, edit, commit, push or publish repository files. Do not create a pull request.",
              "Answer the user's request directly and collaboratively. Finish with a useful final response, not a delivery report.",
            ]
          : [
              "You are coordinating the AI Product Team in repository draft mode.",
              "Inspect the repository and use the supervisor plus relevant specialist agents.",
              "You may edit files and run tests inside this isolated workspace.",
              "Do not commit, push, create a branch on GitHub, or create a pull request. The result is a private draft only.",
              "Finish with a concise implementation and verification summary.",
            ];
        const attached = await writeRunAttachments(sandbox, attachments, runId);
        const teamPrompt = [...instructions, "", `USER OBJECTIVE:\n${prompt}`, attached.context].filter(Boolean).join("\n");

        const args = ["--sandbox", "danger-full-access", "--ask-for-approval", "never"];
        if (model && model !== "auto") args.push("--model", model);
        if (reasoningEffort) args.push("-c", `model_reasoning_effort=\"${reasoningEffort.replaceAll('"', "")}\"`);
        args.push("exec", "--json");
        for (const image of attached.images) args.push("--image", image);
        // Codex's --image accepts multiple values and otherwise consumes the
        // trailing positional prompt as another image path.
        args.push("--", teamPrompt);

        const command = await sandbox.runCommand({
          cmd: "bash",
          args: ["-lc", 'export PATH="$HOME/.local/bin:$PATH"; exec codex "$@"', "codex", ...args],
          cwd,
          detached: true,
        });

        let pending = "";
        const diagnostics: string[] = [];
        for await (const log of command.logs()) {
          pending += log.data;
          const chunks = pending.split("\n");
          pending = chunks.pop() ?? "";
          for (const chunk of chunks) {
            if (!chunk.trim()) continue;
            try { emitEvent(controller, JSON.parse(chunk) as JsonRecord); }
            catch { diagnostics.push(chunk.trim()); }
          }
        }
        if (pending.trim()) {
          try { emitEvent(controller, JSON.parse(pending) as JsonRecord); }
          catch { diagnostics.push(pending.trim()); }
        }
        const result = await command.wait();
        if (result.exitCode !== 0) {
          const detail = diagnostics.slice(-5).join(" | ").slice(-1400);
          throw new Error(`Codex runtime exited with code ${result.exitCode}${detail ? `: ${detail}` : ""}`);
        }

        if (mode === "draft") {
          await sandbox.runCommand({ cmd: "git", args: ["add", "-N", "."], cwd }).catch(() => undefined);
          const diffStatResult = await sandbox.runCommand({ cmd: "git", args: ["diff", "--stat"], cwd });
          const statusResult = await sandbox.runCommand({ cmd: "git", args: ["status", "--short"], cwd });
          const patchResult = await sandbox.runCommand({ cmd: "git", args: ["diff", "--no-ext-diff", "--unified=3"], cwd });
          const diffStat = (await diffStatResult.stdout()).trim();
          const changed = (await statusResult.stdout()).trim();
          const fullPatch = (await patchResult.stdout()).trim();
          const maxPatchChars = 60_000;
          const patch = fullPatch.length > maxPatchChars
            ? `${fullPatch.slice(0, maxPatchChars)}\n\n... patch truncado en la UI (${fullPatch.length - maxPatchChars} caracteres adicionales)`
            : fullPatch;

          controller.enqueue(line({ type: "workspace.diff", data: { diffStat, changed } }));
          if (patch) {
            controller.enqueue(line({
              type: "agent.message",
              agentId: "supervisor",
              data: {
                messageId: `draft-patch-${Date.now()}`,
                content: `### Patch del borrador\n\n\`\`\`diff\n${patch}\n\`\`\``,
              },
            }));
          }
          finishRun(runId, runOwner);
          controller.enqueue(line({
            type: "control.done",
            data: { delivery: "draft", repo, baseBranch, message: "Borrador terminado. El patch quedó guardado en este chat y no se escribió nada en GitHub." },
          }));
        } else {
          finishRun(runId, runOwner);
          controller.enqueue(line({ type: "control.done", data: { delivery: "chat", message: "Chat terminado." } }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finishRun(runId, runOwner, message);
        controller.enqueue(line({ type: "control.error", data: { message } }));
      } finally {
        if (sandbox) await sandbox.stop().catch(() => undefined);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Run-Id": runId,
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
