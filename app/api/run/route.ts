import { Sandbox } from "@vercel/sandbox";
import { readCodexAuth } from "@/lib/chatgpt-auth-cookie";
import { createChatGPTWorkerSandbox } from "@/lib/chatgpt-sandbox";
import { copilotRunnerSource } from "@/lib/copilot-runner-source";
import { presentRuntimeError } from "@/lib/runtime-error";
import { getGitHubSession, requireControlRoomIdentity } from "@/lib/server-auth";
import { finishRun, getRun, startRun } from "@/lib/run-store";
import { validateAttachments, writeRunAttachments, type RunAttachment } from "@/lib/run-attachments";
import { GitHubPublicationAuthError, pushAuthFailure, apiAuthFailure } from "@/lib/github-publication-error";
import { findReusablePullRequest, type ExistingPullRequest } from "@/lib/existing-pull-request";

export const runtime = "nodejs";
export const maxDuration = 800;

type RunRequest = {
  repo?: string;
  branch?: string;
  provider?: "copilot" | "chatgpt";
  model?: string;
  reasoningEffort?: string;
  prompt?: string;
  publicationMode?: "pr";
  existingPrNumbers?: number[];
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

function codexAgentName(item: JsonRecord) {
  const direct =
    asString(item.agentName) ||
    asString(item.agent_name) ||
    asString(item.agent_type) ||
    asString(item.agentType) ||
    asString(item.role);
  if (direct) return direct;
  const args = asRecord(item.arguments);
  return asString(args.agentName) || asString(args.agent_name) || asString(args.agent_type) || asString(args.agentType);
}

function emitCodexEvent(controller: ReadableStreamDefaultController<Uint8Array>, event: JsonRecord) {
  const type = asString(event.type);
  const item = asRecord(event.item);
  const itemType = asString(item.type).toLowerCase();
  const itemId = asString(item.id) || `${Date.now()}`;
  const agentName = codexAgentName(item);

  if (type === "thread.started") {
    controller.enqueue(line({ type: "run.started", agentId: "supervisor", data: { provider: "chatgpt" } }));
    return;
  }
  if (type === "turn.started") {
    controller.enqueue(line({ type: "control.status", data: { message: "ChatGPT/Codex está coordinando el equipo…" } }));
    return;
  }
  if (type === "turn.completed") {
    const usage = asRecord(event.usage);
    const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
    const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
    controller.enqueue(line({
      type: "run.completed",
      agentId: "supervisor",
      data: { totalTokens: input + output, provider: "chatgpt" },
    }));
    return;
  }
  if (type === "turn.failed" || type === "error") {
    controller.enqueue(line({
      type: "run.failed",
      agentId: "supervisor",
      data: {
        message:
          asString(event.message) ||
          asString(asRecord(event.error).message) ||
          "Codex execution failed",
      },
    }));
    return;
  }

  if (type === "rollout.assignment") {
    const assignment = asString(item.assignment).trim();
    if (agentName && assignment) {
      controller.enqueue(line({
        type: "tool.started",
        agentId: "supervisor",
        data: {
          toolName: "task",
          arguments: { agent_type: agentName, prompt: assignment },
          source: "codex-rollout-bridge",
        },
      }));
    }
    return;
  }

  const looksLikeSubagent = itemType.includes("subagent") || itemType.includes("collab") || Boolean(agentName);
  if (looksLikeSubagent && agentName) {
    if (type === "item.started") {
      controller.enqueue(line({
        type: "subagent.started",
        agentId: asString(item.agent_id) || itemId,
        data: { agentName, model: asString(item.model) },
      }));
    } else if (type === "item.completed") {
      controller.enqueue(line({
        type: "subagent.completed",
        agentId: asString(item.agent_id) || itemId,
        data: { agentName },
      }));
    }
  }

  if (type === "item.started" && itemType === "command_execution") {
    controller.enqueue(line({
      type: "tool.started",
      agentId: agentName || "supervisor",
      data: { toolName: asString(item.command) || "command" },
    }));
    return;
  }

  if (type === "item.completed" && itemType === "command_execution") {
    controller.enqueue(line({
      type: "tool.completed",
      agentId: agentName || "supervisor",
      data: {
        success: asString(item.status) !== "failed",
        toolName: asString(item.command) || "command",
      },
    }));
    return;
  }

  if (type === "item.completed" && itemType === "agent_message") {
    const text = asString(item.text) || asString(item.content);
    if (text) {
      controller.enqueue(line({
        type: "agent.message",
        agentId: agentName || "supervisor",
        data: { content: text, messageId: itemId },
      }));
    }
  }
}

function githubHeaders(token?: string) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function parseDiffMetrics(numstat: string) {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  let binaryFiles = 0;
  for (const row of numstat.split("\n").map((value) => value.trim()).filter(Boolean)) {
    const [added, removed] = row.split("\t");
    files += 1;
    if (added === "-" || removed === "-") binaryFiles += 1;
    else { additions += Number(added) || 0; deletions += Number(removed) || 0; }
  }
  return { files, additions, deletions, binaryFiles };
}

export async function POST(request: Request) {
  const body = (await request.json()) as RunRequest;
  const repo = body.repo?.trim() || "rodrico16/equipo-producto-ia";
  const prompt = body.prompt?.trim();
  const provider = body.provider === "chatgpt" ? "chatgpt" : "copilot";
  const model = body.model?.trim() || "auto";
  const reasoningEffort = body.reasoningEffort?.trim();
  const publicationMode = body.publicationMode;

  if (publicationMode !== undefined && publicationMode !== "pr") {
    return Response.json({ error: "Unsupported publication mode" }, { status: 400 });
  }
  if (body.existingPrNumbers !== undefined && (!Array.isArray(body.existingPrNumbers) || body.existingPrNumbers.length > 30 ||
      body.existingPrNumbers.some((number) => !Number.isSafeInteger(number) || number < 1))) {
    return Response.json({ error: "Invalid Pull Request numbers" }, { status: 400 });
  }

  if (!repoPattern.test(repo)) {
    return Response.json({ error: "Repository must be owner/name" }, { status: 400 });
  }
  if (!prompt) {
    return Response.json({ error: "Prompt is required" }, { status: 400 });
  }
  let attachments: RunAttachment[];
  try { attachments = validateAttachments(body.attachments); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
  if (provider === "copilot" && attachments.some((file) => /\.(png|jpe?g|webp|gif)$/i.test(file.name))) return Response.json({ error: "Para analizar imágenes elegí ChatGPT / Codex." }, { status: 400 });

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
    return Response.json(
      { error: "GitHub Copilot requiere conectar GitHub. Usá ChatGPT / Codex para ejecutar como invitado." },
      { status: 401 },
    );
  }

  const chatGPTAuth = provider === "chatgpt" ? await readCodexAuth() : null;
  if (provider === "chatgpt" && !chatGPTAuth) {
    return Response.json({ error: "Conectá ChatGPT para continuar" }, { status: 401 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sandbox: Sandbox | undefined;
      try {
        controller.enqueue(line({ type: "control.status", data: { message: "Validando repositorio…" } }));

        const repoResponse = await fetch(`https://api.github.com/repos/${repo}`, {
          headers: githubHeaders(github?.token),
          cache: "no-store",
        });
        if (!repoResponse.ok) {
          if (!github && (repoResponse.status === 404 || repoResponse.status === 403)) {
            throw new Error("Como invitado sólo podés ejecutar sobre repositorios públicos. Conectá GitHub para repos privados.");
          }
          throw new Error(`GitHub repository access failed (${repoResponse.status})`);
        }

        const repoInfo = (await repoResponse.json()) as { default_branch?: string; private?: boolean };
        if (!github && repoInfo.private) {
          throw new Error("Como invitado sólo podés ejecutar sobre repositorios públicos.");
        }

        let existingPr: ExistingPullRequest | null = null;
        for (const number of new Set(body.existingPrNumbers || [])) {
          existingPr = await findReusablePullRequest(repo, number, github?.token);
          if (existingPr) break;
        }
        const baseBranch = existingPr?.baseBranch || body.branch?.trim() || repoInfo.default_branch || "main";
        const runBranch = existingPr?.branch || `ai/control-room-${Date.now()}`;
        const checkoutBranch = existingPr?.branch || baseBranch;
        const actor = github?.login || "guest";
        let repoDir: string;

        controller.enqueue(line({
          type: "control.status",
          data: {
            message: `Creando sandbox ${provider === "chatgpt" ? "ChatGPT/Codex" : "Copilot"} para ${repo}@${checkoutBranch}`,
            branch: github ? runBranch : null,
          },
        }));

        if (provider === "chatgpt") {
          sandbox = await createChatGPTWorkerSandbox(chatGPTAuth!);

          const workspaceResult = await sandbox.runCommand("bash", [
            "-lc",
            "mkdir -p /tmp/control-room-work && mktemp -d /tmp/control-room-work/run-XXXXXX",
          ]);
          if (workspaceResult.exitCode !== 0) throw new Error("Could not create Codex workspace");
          const workspace = (await workspaceResult.stdout()).trim();
          repoDir = `${workspace}/${repo.split("/")[1]}`;

          const clone = github
            ? await sandbox.runCommand({
                cmd: "bash",
                args: [
                  "-lc",
                  'AUTH=$(printf "x-access-token:%s" "$GH_CLONE_TOKEN" | base64 | tr -d "\\n"); git -c http.extraHeader="Authorization: Basic $AUTH" clone --depth 1 --branch "$BASE_BRANCH" "https://github.com/$TARGET_REPO.git" "$TARGET_DIR"',
                ],
                env: {
                  GH_CLONE_TOKEN: github.token,
                  BASE_BRANCH: checkoutBranch,
                  TARGET_REPO: repo,
                  TARGET_DIR: repoDir,
                },
              })
            : await sandbox.runCommand({
                cmd: "bash",
                args: [
                  "-lc",
                  'git clone --depth 1 --branch "$BASE_BRANCH" "https://github.com/$TARGET_REPO.git" "$TARGET_DIR"',
                ],
                env: {
                  BASE_BRANCH: checkoutBranch,
                  TARGET_REPO: repo,
                  TARGET_DIR: repoDir,
                },
              });
          if (clone.exitCode !== 0) {
            throw new Error(`Git clone failed: ${(await clone.stderr()).slice(-1200)}`);
          }
        } else {
          if (!github) throw new Error("GitHub connection required for Copilot");
          sandbox = await Sandbox.create({
            source: {
              type: "git",
              url: `https://github.com/${repo}.git`,
              username: github.login,
              password: github.token,
              revision: checkoutBranch,
              depth: 1,
            },
            timeout: 20 * 60 * 1000,
            persistent: false,
            networkPolicy: "allow-all",
          });
          repoDir = repo.split("/")[1];
        }

        const attached = await writeRunAttachments(sandbox, attachments, runId);

        await sandbox.runCommand({
          cmd: "git",
          args: ["remote", "set-url", "origin", `https://github.com/${repo}.git`],
          cwd: repoDir,
        });
        const baseShaResult = await sandbox.runCommand({ cmd: "git", args: ["rev-parse", "HEAD"], cwd: repoDir });
        const baseSha = (await baseShaResult.stdout()).trim();
        if (!baseSha) throw new Error("Could not resolve base commit");

        if (!existingPr) {
          const switchResult = await sandbox.runCommand({ cmd: "git", args: ["switch", "-c", runBranch], cwd: repoDir });
          if (switchResult.exitCode !== 0) throw new Error(`Could not create branch: ${(await switchResult.stderr()).slice(-800)}`);
        }
        await sandbox.runCommand({
          cmd: "git",
          args: ["config", "user.name", github ? `${github.login} via AI Control Room` : "AI Control Room Guest"],
          cwd: repoDir,
        });
        await sandbox.runCommand({
          cmd: "git",
          args: ["config", "user.email", github ? `${github.login}@users.noreply.github.com` : "control-room@users.noreply.github.com"],
          cwd: repoDir,
        });

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

        if (provider === "chatgpt") {
          const installAgents = await sandbox.runCommand({
            cmd: "bash",
            args: [
              "-lc",
              'mkdir -p .codex/agents; cp -n /tmp/equipo-producto-ia-agents/.codex/agents/*.toml .codex/agents/; if [ -z "$(git ls-files \' .codex/**\')" ]; then grep -qxF "/.codex/" .git/info/exclude || echo "/.codex/" >> .git/info/exclude; fi; find .codex/agents -maxdepth 1 -name "*.toml" | wc -l',
            ],
            cwd: repoDir,
          });
          if (installAgents.exitCode !== 0) {
            throw new Error(`Could not install Codex agent profiles: ${(await installAgents.stderr()).slice(-1000)}`);
          }
          const teamCount = Number((await installAgents.stdout()).trim()) || 0;
          controller.enqueue(line({ type: "team.loaded", data: { count: teamCount, provider: "chatgpt" } }));

          const teamPrompt = [
            "Act as the parent coordinator for the AI Product Team.",
            "Use the custom agents available in .codex/agents. Delegate planning/orchestration to the custom agent named supervisor first, then have the supervisor use the relevant specialist agents for product, UX, architecture, engineering, QA, security, data or operations as needed.",
            "Implement the task completely in this repository. Inspect existing conventions before changing code. Run appropriate verification/tests. Do not commit, push, create a PR, expose credentials, or modify git remotes; the Control Room handles delivery after you finish.",
            "Keep unrelated files untouched. Finish with a concise implementation and verification summary.",
            "",
            `USER OBJECTIVE:\n${prompt}`,
            attached.context,
          ].join("\n");

          const args = ["--sandbox", "workspace-write", "--ask-for-approval", "never"];
          if (model && model !== "auto") args.push("--model", model);
          if (reasoningEffort) {
            args.push("-c", `model_reasoning_effort=\"${reasoningEffort.replaceAll('"', "")}\"`);
          }
          args.push("exec", "--json");
          for (const image of attached.images) args.push("--image", image);
          // End option parsing so --image cannot swallow the positional prompt.
          args.push("--", teamPrompt);

          controller.enqueue(line({
            type: "control.status",
            data: { message: "Equipo conectado a tu ChatGPT. Arrancando Codex…" },
          }));
          const command = await sandbox.runCommand({
            cmd: "bash",
            args: ["-lc", 'export PATH="$HOME/.local/bin:$PATH"; exec codex "$@"', "codex", ...args],
            cwd: repoDir,
            detached: true,
          });

          let pending = "";
          const diagnostics: string[] = [];
          for await (const log of command.logs()) {
            pending += log.data;
            const parts = pending.split("\n");
            pending = parts.pop() ?? "";
            for (const part of parts) {
              if (!part.trim()) continue;
              try {
                emitCodexEvent(controller, JSON.parse(part) as JsonRecord);
              } catch {
                diagnostics.push(part.trim());
                controller.enqueue(line({ type: "runtime.log", data: { message: part } }));
              }
            }
          }
          if (pending.trim()) {
            try {
              emitCodexEvent(controller, JSON.parse(pending) as JsonRecord);
            } catch {
              diagnostics.push(pending.trim());
            }
          }
          const finished = await command.wait();
          if (finished.exitCode !== 0) {
            const detail = diagnostics.slice(-5).join(" | ").slice(-1600);
            throw new Error(`Codex runtime exited with code ${finished.exitCode}${detail ? `: ${detail}` : ""}`);
          }
        } else {
          if (!github) throw new Error("GitHub connection required for Copilot");
          await sandbox.writeFiles([
            { path: "/tmp/copilot-runner.mjs", content: Buffer.from(copilotRunnerSource) },
            { path: "/tmp/package.json", content: Buffer.from(JSON.stringify({ type: "module", private: true })) },
          ]);

          controller.enqueue(line({ type: "control.status", data: { message: "Preparando GitHub Copilot SDK…" } }));
          const install = await sandbox.runCommand({
            cmd: "npm",
            args: ["install", "--prefix", "/tmp", "@github/copilot-sdk@1.0.14", "--no-audit", "--no-fund"],
          });
          if (install.exitCode !== 0) {
            throw new Error(`Copilot SDK install failed: ${(await install.stderr()).slice(-1200)}`);
          }

          controller.enqueue(line({ type: "control.status", data: { message: "Equipo conectado. Arrancando ejecución…" } }));
          const command = await sandbox.runCommand({
            cmd: "node",
            args: ["/tmp/copilot-runner.mjs"],
            cwd: repoDir,
            detached: true,
            env: {
              COPILOT_GITHUB_TOKEN: github.token,
              COPILOT_MODEL: model,
              COPILOT_TASK: [prompt, attached.context].filter(Boolean).join("\n\n"),
              COPILOT_AGENT_DIR: "/tmp/equipo-producto-ia-agents/.codex/agents",
            },
          });

          let pending = "";
          let runtimeFailure = "";
          for await (const log of command.logs()) {
            pending += log.data;
            const parts = pending.split("\n");
            pending = parts.pop() ?? "";
            for (const part of parts) {
              if (!part.trim()) continue;
              try {
                const event = JSON.parse(part) as { type?: string; data?: { message?: unknown } };
                if (event.type === "run.failed" && typeof event.data?.message === "string") runtimeFailure = event.data.message;
                controller.enqueue(line(event));
              } catch {
                controller.enqueue(line({ type: "runtime.log", data: { message: part } }));
              }
            }
          }
          if (pending.trim()) {
            try {
              const event = JSON.parse(pending) as { type?: string; data?: { message?: unknown } };
              if (event.type === "run.failed" && typeof event.data?.message === "string") runtimeFailure = event.data.message;
              controller.enqueue(line(event));
            } catch {
              controller.enqueue(line({ type: "runtime.log", data: { message: pending } }));
            }
          }
          const finished = await command.wait();
          if (finished.exitCode !== 0) throw new Error(presentRuntimeError(runtimeFailure, `Agent runtime exited with code ${finished.exitCode}`));
        }

        const statusResult = await sandbox.runCommand({ cmd: "git", args: ["status", "--porcelain"], cwd: repoDir });
        const changedWorkingTree = (await statusResult.stdout()).trim();
        const headResult = await sandbox.runCommand({ cmd: "git", args: ["rev-parse", "HEAD"], cwd: repoDir });
        const headAfterAgent = (await headResult.stdout()).trim();
        const agentCreatedCommits = headAfterAgent !== baseSha;

        if (!changedWorkingTree && !agentCreatedCommits) {
          controller.enqueue(line({ type: "workspace.diff", data: { changed: "", diffStat: "" } }));
          controller.enqueue(line({
            type: "control.done",
            data: { message: "La ejecución terminó sin cambios de archivos.", delivery: github ? "github" : "guest" },
          }));
          return;
        }

        if (changedWorkingTree) {
          await sandbox.runCommand({ cmd: "git", args: ["add", "-A"], cwd: repoDir });
          const commit = await sandbox.runCommand({
            cmd: "git",
            args: ["commit", "-m", `feat: implement task with AI product team (${provider})`],
            cwd: repoDir,
          });
          if (commit.exitCode !== 0) throw new Error(`Commit failed: ${(await commit.stderr()).slice(-1200)}`);
        }

        const diffStatResult = await sandbox.runCommand({
          cmd: "git",
          args: ["diff", "--stat", `${baseSha}..HEAD`],
          cwd: repoDir,
        });
        const diffNamesResult = await sandbox.runCommand({
          cmd: "git",
          args: ["diff", "--name-status", `${baseSha}..HEAD`],
          cwd: repoDir,
        });
        const diffStat = (await diffStatResult.stdout()).trim();
        const changed = (await diffNamesResult.stdout()).trim();
        const diffNumstatResult = await sandbox.runCommand({ cmd: "git", args: ["diff", "--numstat", `${baseSha}..HEAD`], cwd: repoDir });
        if (diffNumstatResult.exitCode !== 0) throw new Error(`Could not calculate diff metrics: ${(await diffNumstatResult.stderr()).slice(-800)}`);
        const diffMetrics = parseDiffMetrics((await diffNumstatResult.stdout()).trim());
        controller.enqueue(line({ type: "workspace.diff", data: { changed, diffStat } }));

        if (!github) {
          controller.enqueue(line({
            type: "control.done",
            data: {
              repo,
              provider,
              baseBranch,
              diffStat,
              delivery: "guest",
              message: "Cambios generados en Sandbox. Conectá GitHub para publicar una rama y crear el PR automáticamente.",
            },
          }));
          return;
        }

        if (existingPr) {
          const currentPr = await findReusablePullRequest(repo, existingPr.number, github.token);
          if (!currentPr || currentPr.branch !== existingPr.branch) {
            throw new Error("El Pull Request cambió o se cerró durante la ejecución. Volvé a enviar el pedido para publicar de forma segura.");
          }
        }

        controller.enqueue(line({ type: "control.status", data: { message: "Publicando rama en GitHub…" } }));
        const push = await sandbox.runCommand({
          cmd: "bash",
          args: [
            "-lc",
            'AUTH=$(printf "x-access-token:%s" "$GH_PUSH_TOKEN" | base64 | tr -d "\\n"); git -c http.extraHeader="Authorization: Basic $AUTH" push -u origin "HEAD:$RUN_BRANCH"',
          ],
          cwd: repoDir,
          env: { GH_PUSH_TOKEN: github.token, RUN_BRANCH: runBranch },
        });
        if (push.exitCode !== 0) {
          const stderr = (await push.stderr()).slice(-1200);
          const reason = pushAuthFailure(stderr);
          if (reason) throw new GitHubPublicationAuthError("push", reason);
          throw new Error(`Push failed: ${stderr}`);
        }

        const prResponse = existingPr ? null : await fetch(`https://api.github.com/repos/${repo}/pulls`, {
          method: "POST",
          headers: {
            ...githubHeaders(github.token),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: "AI Control Room: cambios listos para revisión",
            head: runBranch,
            base: baseBranch,
            body: [
              "## AI Product Team Control Room",
              "",
              `Cambio implementado por el supervisor y los agentes especializados usando **${provider === "chatgpt" ? "ChatGPT / Codex" : "GitHub Copilot"}** dentro de Vercel Sandbox.`,
              "",
              "El pedido original se omitió por privacidad; revisar el diff y los checks antes de mergear.",
              "",
              "### Cambios medidos",
              `- Archivos modificados: ${diffMetrics.files}`,
              `- Líneas agregadas: ${diffMetrics.additions}`,
              `- Líneas eliminadas: ${diffMetrics.deletions}`,
              diffMetrics.binaryFiles ? `- Archivos binarios (líneas no aplicables): ${diffMetrics.binaryFiles}` : "",
              diffStat ? `\n**Diff:**\n\`\`\`\n${diffStat}\n\`\`\`` : "",
              "",
              "Revisar los checks y el diff antes de mergear.",
            ].join("\n"),
          }),
        });
        const createdPr = prResponse ? await prResponse.json() as { html_url?: string; number?: number; message?: string } : null;
        if (prResponse && (!prResponse.ok || !createdPr?.html_url)) {
          const reason = apiAuthFailure(prResponse.status, createdPr?.message);
          if (reason) throw new GitHubPublicationAuthError("pull_request", reason);
          throw new Error(`Branch pushed but PR creation failed: ${createdPr?.message ?? prResponse.status}`);
        }

        finishRun(runId, runOwner);
        controller.enqueue(line({
          type: "control.done",
          data: {
            repo,
            provider,
            baseBranch,
            branch: runBranch,
            prUrl: existingPr?.url || createdPr?.html_url,
            prNumber: existingPr?.number || createdPr?.number,
            updatedExistingPr: Boolean(existingPr),
            diffStat,
            delivery: "github",
            actor,
          },
        }));
      } catch (error) {
        const message = presentRuntimeError(error instanceof Error ? error.message : String(error), "La ejecución del equipo falló");
        console.error("[api/run] execution failed", {
          runId,
          provider,
          message: message.slice(0, 1600),
        });
        finishRun(runId, runOwner, message);
        if (error instanceof GitHubPublicationAuthError) {
          controller.enqueue(line({ type: "auth.required", data: { provider: "github", message, stage: error.stage, reason: error.reason } }));
        }
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
