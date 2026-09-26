import { Sandbox } from "@vercel/sandbox";
import { readCodexAuth } from "@/lib/chatgpt-auth-cookie";
import { createChatGPTWorkerSandbox } from "@/lib/chatgpt-sandbox";
import { codexProviderFrom, qwenCodexEnv, qwenConfigured, qwenModel, type CodexProvider } from "@/lib/codex-provider";
import { directAgentRunnerSource } from "@/lib/direct-agent-runner-source";
import { presentRuntimeError } from "@/lib/runtime-error";
import { getGitHubSession, requireControlRoomIdentity } from "@/lib/server-auth";
import { finishRun, getRun, startRun } from "@/lib/run-store";
import { validateAttachments, writeRunAttachments, type RunAttachment } from "@/lib/run-attachments";

export const runtime = "nodejs";
export const maxDuration = 300;

type Provider = "copilot" | CodexProvider;
type RunRequest = {
  provider?: Provider;
  agentName?: string;
  prompt?: string;
  repo?: string;
  branch?: string;
  model?: string;
  reasoningEffort?: string;
  attachments?: RunAttachment[];
};
type JsonRecord = Record<string, unknown>;

const encoder = new TextEncoder();
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const agentPattern = /^[A-Za-z0-9_.-]+$/;

function line(payload: unknown) {
  return encoder.encode(JSON.stringify(payload) + "\n");
}
function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}
function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}
function githubHeaders(token?: string) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
function emitCodexEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: JsonRecord,
  agentName: string,
) {
  const type = asString(event.type);
  const item = asRecord(event.item);
  const itemType = asString(item.type).toLowerCase();
  const itemId = asString(item.id) || `${Date.now()}`;

  if (type === "thread.started") {
    controller.enqueue(line({ type: "run.started", agentId: agentName, data: { mode: "agent" } }));
    return;
  }
  if (type === "turn.failed" || type === "error") {
    controller.enqueue(line({
      type: "run.failed",
      agentId: agentName,
      data: { message: asString(event.message) || asString(asRecord(event.error).message) || "Codex specialist run failed" },
    }));
    return;
  }
  if (type === "item.started" && itemType === "command_execution") {
    controller.enqueue(line({
      type: "tool.started",
      agentId: agentName,
      data: { toolName: asString(item.command) || "command" },
    }));
    return;
  }
  if (type === "item.completed" && itemType === "command_execution") {
    controller.enqueue(line({
      type: "tool.completed",
      agentId: agentName,
      data: { success: asString(item.status) !== "failed", toolName: asString(item.command) || "command" },
    }));
    return;
  }
  if (type === "item.completed" && itemType === "agent_message") {
    const text = asString(item.text) || asString(item.content);
    if (text) {
      controller.enqueue(line({
        type: "agent.message",
        agentId: agentName,
        data: { content: text, messageId: itemId },
      }));
    }
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as RunRequest;
  const provider: Provider = body.provider === "copilot" ? "copilot" : codexProviderFrom(body.provider);
  let attachments: RunAttachment[];
  try { attachments = validateAttachments(body.attachments); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
  if (provider === "copilot" && attachments.some((file) => /\.(png|jpe?g|webp|gif)$/i.test(file.name))) return Response.json({ error: "Para analizar imágenes elegí ChatGPT / Codex." }, { status: 400 });
  const agentName = body.agentName?.trim() || "";
  const prompt = body.prompt?.trim() || "";
  const repo = body.repo?.trim() || "";
  const model = body.model?.trim() || "auto";
  const reasoningEffort = body.reasoningEffort?.trim() || "";

  if (!agentPattern.test(agentName) || agentName === "supervisor") {
    return Response.json({ error: "Choose a specialist agent" }, { status: 400 });
  }
  if (!prompt) return Response.json({ error: "Prompt is required" }, { status: 400 });
  if (repo && !repoPattern.test(repo)) return Response.json({ error: "Repository must be owner/name" }, { status: 400 });

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

  const github = await getGitHubSession();
  if (provider === "copilot" && !github) {
    return Response.json({ error: "Conectá GitHub para hablar con especialistas usando Copilot" }, { status: 401 });
  }
  const codexAuth = provider === "chatgpt" ? await readCodexAuth() : null;
  if (provider === "chatgpt" && !codexAuth) {
    return Response.json({ error: "Conectá ChatGPT para hablar con especialistas" }, { status: 401 });
  }
  if (provider === "qwen" && !qwenConfigured()) {
    return Response.json({ error: "Configurá DASHSCOPE_API_KEY para hablar con especialistas usando Qwen" }, { status: 401 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sandbox: Sandbox | undefined;
      try {
        controller.enqueue(line({
          type: "control.status",
          agentId: agentName,
          data: { message: `Abriendo chat directo con ${agentName}…` },
        }));

        sandbox = provider !== "copilot"
          ? await createChatGPTWorkerSandbox(codexAuth)
          : await Sandbox.create({ timeout: 20 * 60 * 1000, persistent: false, networkPolicy: "allow-all" });

        let cwd = "/tmp/direct-agent";
        const mkdir = await sandbox.runCommand("bash", ["-lc", `mkdir -p ${cwd}`]);
        if (mkdir.exitCode !== 0) throw new Error("Could not prepare specialist workspace");

        if (repo) {
          const repoResponse = await fetch(`https://api.github.com/repos/${repo}`, {
            headers: githubHeaders(github?.token),
            cache: "no-store",
          });
          if (!repoResponse.ok) {
            if (!github && (repoResponse.status === 403 || repoResponse.status === 404)) {
              throw new Error("Conectá GitHub para usar repositorios privados en chats de especialistas.");
            }
            throw new Error(`GitHub repository access failed (${repoResponse.status})`);
          }
          const info = (await repoResponse.json()) as { default_branch?: string; private?: boolean };
          if (!github && info.private) throw new Error("Conectá GitHub para usar repositorios privados.");
          const baseBranch = body.branch?.trim() || info.default_branch || "main";
          cwd = `/tmp/direct-agent/${repo.split("/")[1]}`;
          const clone = github
            ? await sandbox.runCommand({
                cmd: "bash",
                args: [
                  "-lc",
                  'AUTH=$(printf "x-access-token:%s" "$GH_TOKEN" | base64 | tr -d "\\n"); git -c http.extraHeader="Authorization: Basic $AUTH" clone --depth 1 --branch "$BASE" "https://github.com/$REPO.git" "$TARGET"',
                ],
                env: { GH_TOKEN: github.token, BASE: baseBranch, REPO: repo, TARGET: cwd },
              })
            : await sandbox.runCommand({
                cmd: "git",
                args: ["clone", "--depth", "1", "--branch", baseBranch, `https://github.com/${repo}.git`, cwd],
              });
          if (clone.exitCode !== 0) throw new Error(`Git clone failed: ${(await clone.stderr()).slice(-1000)}`);
        } else if (provider !== "copilot") {
          const init = await sandbox.runCommand({ cmd: "git", args: ["init", "-q"], cwd });
          if (init.exitCode !== 0) throw new Error("Could not initialize specialist workspace");
        }

        const attached = await writeRunAttachments(sandbox, attachments, runId);

        const agentsClone = await sandbox.runCommand("git", [
          "clone",
          "--depth",
          "1",
          "https://github.com/rodrico16/equipo-producto-ia.git",
          "/tmp/equipo-producto-ia-agents",
        ]);
        if (agentsClone.exitCode !== 0) throw new Error(`Could not load agent catalog: ${(await agentsClone.stderr()).slice(-1000)}`);

        if (provider === "copilot") {
          await sandbox.writeFiles([
            { path: "/tmp/direct-agent-runner.mjs", content: Buffer.from(directAgentRunnerSource) },
            { path: "/tmp/package.json", content: Buffer.from(JSON.stringify({ type: "module", private: true })) },
          ]);
          const install = await sandbox.runCommand({
            cmd: "npm",
            args: ["install", "--prefix", "/tmp", "@github/copilot-sdk@1.0.14", "--no-audit", "--no-fund"],
          });
          if (install.exitCode !== 0) throw new Error(`Copilot SDK install failed: ${(await install.stderr()).slice(-1200)}`);

          const command = await sandbox.runCommand({
            cmd: "node",
            args: ["/tmp/direct-agent-runner.mjs"],
            cwd,
            detached: true,
            env: {
              COPILOT_GITHUB_TOKEN: github!.token,
              COPILOT_MODEL: model,
              COPILOT_REASONING_EFFORT: reasoningEffort,
              COPILOT_TASK: [prompt, attached.context].filter(Boolean).join("\n\n"),
              COPILOT_TARGET_AGENT: agentName,
              COPILOT_WORKDIR: cwd,
              COPILOT_AGENT_DIR: "/tmp/equipo-producto-ia-agents/.codex/agents",
            },
          });

          let pending = "";
          let runtimeFailure = "";
          const diagnostics: string[] = [];
          for await (const log of command.logs()) {
            pending += log.data;
            const chunks = pending.split("\n");
            pending = chunks.pop() ?? "";
            for (const chunk of chunks) {
              if (!chunk.trim()) continue;
              try {
                const event = JSON.parse(chunk) as { type?: string; data?: { message?: unknown } };
                if (event.type === "run.failed" && typeof event.data?.message === "string") runtimeFailure = event.data.message;
                controller.enqueue(line(event));
              }
              catch { diagnostics.push(chunk.trim()); }
            }
          }
          if (pending.trim()) {
            try {
              const event = JSON.parse(pending) as { type?: string; data?: { message?: unknown } };
              if (event.type === "run.failed" && typeof event.data?.message === "string") runtimeFailure = event.data.message;
              controller.enqueue(line(event));
            }
            catch { diagnostics.push(pending.trim()); }
          }
          const result = await command.wait();
          if (result.exitCode !== 0) {
            throw new Error(presentRuntimeError(runtimeFailure || diagnostics.slice(-5).join(" | ").slice(-1600), `Copilot specialist runtime exited with code ${result.exitCode}`));
          }
        } else {
          const installAgents = await sandbox.runCommand({
            cmd: "bash",
            args: [
              "-lc",
              'mkdir -p .codex/agents; cp -n /tmp/equipo-producto-ia-agents/.codex/agents/*.toml .codex/agents/; grep -qxF "/.codex/" .git/info/exclude || echo "/.codex/" >> .git/info/exclude',
            ],
            cwd,
          });
          if (installAgents.exitCode !== 0) throw new Error(`Could not install specialist profiles: ${(await installAgents.stderr()).slice(-1000)}`);

          const specialistPrompt = [
            `Delegate this turn exclusively to the custom agent named "${agentName}".`,
            "This is a direct side conversation between the user and that specialist.",
            "The specialist may inspect repository context but must not edit files, commit, push, or create a Pull Request.",
            "Return the specialist's answer directly. Do not add a separate supervisor summary.",
            "",
            "USER MESSAGE:",
            prompt,
            attached.context,
          ].join("\n");
          const args = ["--sandbox", "read-only", "--ask-for-approval", "never"];
          const runModel = provider === "qwen" ? qwenModel(model) : model;
          if (runModel && runModel !== "auto") args.push("--model", runModel);
          if (reasoningEffort) args.push("-c", `model_reasoning_effort=\"${reasoningEffort.replaceAll('"', "")}\"`);
          args.push("exec", "--json");
          for (const image of attached.images) args.push("--image", image);
          // End option parsing so --image cannot swallow the positional prompt.
          args.push("--", specialistPrompt);

          const command = await sandbox.runCommand({
            cmd: "bash",
            args: ["-lc", 'export PATH="$HOME/.local/bin:$PATH"; exec codex "$@"', "codex", ...args],
            cwd,
            detached: true,
            env: provider === "qwen" ? qwenCodexEnv(model) : undefined,
          });
          let pending = "";
          const diagnostics: string[] = [];
          for await (const log of command.logs()) {
            pending += log.data;
            const chunks = pending.split("\n");
            pending = chunks.pop() ?? "";
            for (const chunk of chunks) {
              if (!chunk.trim()) continue;
              try { emitCodexEvent(controller, JSON.parse(chunk) as JsonRecord, agentName); }
              catch { diagnostics.push(chunk.trim()); }
            }
          }
          if (pending.trim()) {
            try { emitCodexEvent(controller, JSON.parse(pending) as JsonRecord, agentName); }
            catch { diagnostics.push(pending.trim()); }
          }
          const result = await command.wait();
          if (result.exitCode !== 0) {
            throw new Error(diagnostics.slice(-5).join(" | ").slice(-1600) || `Codex specialist runtime exited with code ${result.exitCode}`);
          }
        }

        finishRun(runId, runOwner);
        controller.enqueue(line({
          type: "control.done",
          agentId: agentName,
          data: { delivery: "agent", agentName, message: "Respuesta del especialista lista." },
        }));
      } catch (error) {
        const message = presentRuntimeError(error instanceof Error ? error.message : String(error), "La ejecución del especialista falló");
        finishRun(runId, runOwner, message);
        controller.enqueue(line({
          type: "control.error",
          agentId: agentName,
          data: { message },
        }));
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
