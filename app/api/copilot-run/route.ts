import { Sandbox } from "@vercel/sandbox";
import { copilotRunnerSource } from "@/lib/copilot-runner-source";
import { presentRuntimeError } from "@/lib/runtime-error";
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
type StreamEvent = {
  type?: string;
  data?: Record<string, unknown>;
};

const encoder = new TextEncoder();
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function line(payload: unknown) {
  return encoder.encode(JSON.stringify(payload) + "\n");
}
function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  const body = (await request.json()) as RunRequest;
  const requestedMode = body.mode;
  if (requestedMode !== undefined && requestedMode !== "chat" && requestedMode !== "draft") {
    return Response.json({ error: "Unsupported run mode" }, { status: 400 });
  }
  const mode: RunMode = requestedMode ?? "chat";
  const prompt = body.prompt?.trim();
  const model = body.model?.trim() || "auto";
  const reasoningEffort = body.reasoningEffort?.trim() || "";
  const repo = body.repo?.trim() || "";

  if (!prompt) return Response.json({ error: "Prompt is required" }, { status: 400 });
  let attachments: RunAttachment[];
  try { attachments = validateAttachments(body.attachments); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
  if (attachments.some((file) => /\.(png|jpe?g|webp|gif)$/i.test(file.name))) return Response.json({ error: "Para analizar imágenes elegí ChatGPT / Codex." }, { status: 400 });
  if (mode === "draft" && !repoPattern.test(repo)) {
    return Response.json({ error: "Choose a repository first" }, { status: 400 });
  }

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
  if (!github) {
    return Response.json({ error: "Conectá GitHub para usar Copilot" }, { status: 401 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sandbox: Sandbox | undefined;
      try {
        controller.enqueue(line({
          type: "control.status",
          data: { message: mode === "chat" ? "Abriendo Copilot…" : "Preparando repositorio para Copilot…" },
        }));

        if (mode === "draft") {
          const repoResponse = await fetch(`https://api.github.com/repos/${repo}`, {
            headers: {
              Authorization: `Bearer ${github.token}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            cache: "no-store",
          });
          if (!repoResponse.ok) throw new Error(`GitHub repository access failed (${repoResponse.status})`);
          const info = (await repoResponse.json()) as { default_branch?: string };
          const baseBranch = body.branch?.trim() || info.default_branch || "main";

          sandbox = await Sandbox.create({
            source: {
              type: "git",
              url: `https://github.com/${repo}.git`,
              username: github.login,
              password: github.token,
              revision: baseBranch,
              depth: 1,
            },
            timeout: 20 * 60 * 1000,
            persistent: false,
            networkPolicy: "allow-all",
          });
        } else {
          sandbox = await Sandbox.create({
            timeout: 20 * 60 * 1000,
            persistent: false,
            networkPolicy: "allow-all",
          });
        }

        const workspace = mode === "draft" ? repo.split("/")[1] : "/tmp/copilot-chat";
        if (mode === "chat") {
          const mkdir = await sandbox.runCommand("bash", ["-lc", `mkdir -p ${workspace}`]);
          if (mkdir.exitCode !== 0) throw new Error("Could not create Copilot chat workspace");
        }

        controller.enqueue(line({ type: "control.status", data: { message: "Cargando los perfiles del equipo…" } }));
        const agentsClone = await sandbox.runCommand("git", [
          "clone",
          "--depth",
          "1",
          "https://github.com/rodrico16/equipo-producto-ia.git",
          "/tmp/equipo-producto-ia-agents",
        ]);
        if (agentsClone.exitCode !== 0) {
          throw new Error(`Could not load agent catalog: ${(await agentsClone.stderr()).slice(-1000)}`);
        }

        const attached = await writeRunAttachments(sandbox, attachments, runId);
        await sandbox.writeFiles([
          { path: "/tmp/copilot-runner.mjs", content: Buffer.from(copilotRunnerSource) },
          { path: "/tmp/package.json", content: Buffer.from(JSON.stringify({ type: "module", private: true })) },
        ]);

        const install = await sandbox.runCommand({
          cmd: "npm",
          args: ["install", "--prefix", "/tmp", "@github/copilot-sdk@1.0.14", "--no-audit", "--no-fund"],
        });
        if (install.exitCode !== 0) {
          throw new Error(`Copilot SDK install failed: ${(await install.stderr()).slice(-1200)}`);
        }

        controller.enqueue(line({ type: "control.status", data: { message: "Copilot conectado. Arrancando equipo…" } }));
        const command = await sandbox.runCommand({
          cmd: "node",
          args: ["/tmp/copilot-runner.mjs"],
          cwd: workspace,
          detached: true,
          env: {
            COPILOT_GITHUB_TOKEN: github.token,
            COPILOT_MODEL: model,
            COPILOT_REASONING_EFFORT: reasoningEffort,
            COPILOT_MODE: mode,
            COPILOT_TASK: [prompt, attached.context].filter(Boolean).join("\n\n"),
            COPILOT_AGENT_DIR: "/tmp/equipo-producto-ia-agents/.codex/agents",
          },
        });

        let pending = "";
        let runtimeFailure = "";
        const diagnostics: string[] = [];

        for await (const log of command.logs()) {
          pending += log.data;
          const parts = pending.split("\n");
          pending = parts.pop() ?? "";
          for (const part of parts) {
            if (!part.trim()) continue;
            try {
              const event = JSON.parse(part) as StreamEvent;
              if (event.type === "run.failed") {
                runtimeFailure = asString(event.data?.message) || runtimeFailure;
              }
              if (event.type === "runtime.stage") {
                const message = asString(event.data?.message);
                if (message) controller.enqueue(line({ type: "control.status", data: { message } }));
              } else {
                controller.enqueue(line(event));
              }
            } catch {
              diagnostics.push(part.trim());
              controller.enqueue(line({ type: "runtime.log", data: { message: part } }));
            }
          }
        }
        if (pending.trim()) {
          try {
            const event = JSON.parse(pending) as StreamEvent;
            if (event.type === "run.failed") {
              runtimeFailure = asString(event.data?.message) || runtimeFailure;
            }
            if (event.type === "runtime.stage") {
              const message = asString(event.data?.message);
              if (message) controller.enqueue(line({ type: "control.status", data: { message } }));
            } else {
              controller.enqueue(line(event));
            }
          } catch {
            diagnostics.push(pending.trim());
            controller.enqueue(line({ type: "runtime.log", data: { message: pending } }));
          }
        }

        const finished = await command.wait();
        if (finished.exitCode !== 0) {
          const detail = runtimeFailure || diagnostics.slice(-5).join(" | ").slice(-1600);
          throw new Error(detail || `Copilot runtime exited with code ${finished.exitCode}`);
        }

        if (mode === "draft") {
          await sandbox.runCommand({ cmd: "git", args: ["add", "-N", "."], cwd: workspace }).catch(() => undefined);
          const diffStatResult = await sandbox.runCommand({ cmd: "git", args: ["diff", "--stat"], cwd: workspace });
          const statusResult = await sandbox.runCommand({ cmd: "git", args: ["status", "--short"], cwd: workspace });
          const patchResult = await sandbox.runCommand({ cmd: "git", args: ["diff", "--no-ext-diff", "--unified=3"], cwd: workspace });
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
                messageId: `copilot-draft-patch-${Date.now()}`,
                content: `### Patch del borrador\n\n\`\`\`diff\n${patch}\n\`\`\``,
              },
            }));
          }
          finishRun(runId, runOwner);
          controller.enqueue(line({
            type: "control.done",
            data: { delivery: "draft", repo, message: "Borrador de Copilot terminado. No se escribió nada en GitHub." },
          }));
        } else {
          finishRun(runId, runOwner);
          controller.enqueue(line({ type: "control.done", data: { delivery: "chat", message: "Chat de Copilot terminado." } }));
        }
      } catch (error) {
        const message = presentRuntimeError(error instanceof Error ? error.message : String(error), "La ejecución de Copilot falló");
        finishRun(runId, runOwner, message);
        controller.enqueue(line({
          type: "control.error",
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
