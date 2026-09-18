import { Sandbox } from "@vercel/sandbox";
import { copilotRunnerSource } from "@/lib/copilot-runner-source";
import { requireGitHubSession } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

type RunRequest = {
  repo?: string;
  branch?: string;
  model?: string;
  prompt?: string;
};

const encoder = new TextEncoder();
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function line(payload: unknown) {
  return encoder.encode(JSON.stringify(payload) + "\n");
}

export async function POST(request: Request) {
  let auth;
  try {
    auth = await requireGitHubSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as RunRequest;
  const repo = body.repo?.trim() || "rodrico16/equipo-producto-ia";
  const prompt = body.prompt?.trim();
  const model = body.model?.trim() || "auto";

  if (!repoPattern.test(repo)) {
    return Response.json({ error: "Repository must be owner/name" }, { status: 400 });
  }
  if (!prompt) {
    return Response.json({ error: "Prompt is required" }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sandbox: Sandbox | undefined;
      try {
        controller.enqueue(line({ type: "control.status", data: { message: "Validando repositorio…" } }));

        const repoResponse = await fetch(`https://api.github.com/repos/${repo}`, {
          headers: {
            Authorization: `Bearer ${auth.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          cache: "no-store",
        });
        if (!repoResponse.ok) {
          throw new Error(`GitHub repository access failed (${repoResponse.status})`);
        }
        const repoInfo = (await repoResponse.json()) as { default_branch?: string };
        const baseBranch = body.branch?.trim() || repoInfo.default_branch || "main";
        const runBranch = `ai/control-room-${Date.now()}`;

        controller.enqueue(line({
          type: "control.status",
          data: { message: `Creando sandbox para ${repo}@${baseBranch}`, branch: runBranch },
        }));

        sandbox = await Sandbox.create({
          source: {
            type: "git",
            url: `https://github.com/${repo}.git`,
            username: auth.login,
            password: auth.token,
            revision: baseBranch,
            depth: 1,
          },
          timeout: 20 * 60 * 1000,
          persistent: false,
          networkPolicy: "allow-all",
        });

        const repoDir = repo.split("/")[1];

        await sandbox.runCommand({
          cmd: "git",
          args: ["switch", "-c", runBranch],
          cwd: repoDir,
        });
        await sandbox.runCommand({
          cmd: "git",
          args: ["config", "user.name", `${auth.login} via AI Control Room`],
          cwd: repoDir,
        });
        await sandbox.runCommand({
          cmd: "git",
          args: ["config", "user.email", `${auth.login}@users.noreply.github.com`],
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

        await sandbox.writeFiles([
          { path: "/tmp/copilot-runner.mjs", content: Buffer.from(copilotRunnerSource) },
          {
            path: "/tmp/package.json",
            content: Buffer.from(JSON.stringify({ type: "module", private: true })),
          },
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
            COPILOT_GITHUB_TOKEN: auth.token,
            COPILOT_MODEL: model,
            COPILOT_TASK: prompt,
            COPILOT_WORKDIR: `/vercel/sandbox/${repoDir}`,
            COPILOT_AGENT_DIR: "/tmp/equipo-producto-ia-agents/.codex/agents",
          },
        });

        let pending = "";
        for await (const log of command.logs()) {
          pending += log.data;
          const parts = pending.split("\n");
          pending = parts.pop() ?? "";
          for (const part of parts) {
            if (!part.trim()) continue;
            try {
              controller.enqueue(line(JSON.parse(part)));
            } catch {
              controller.enqueue(line({ type: "runtime.log", data: { message: part } }));
            }
          }
        }
        if (pending.trim()) {
          try {
            controller.enqueue(line(JSON.parse(pending)));
          } catch {
            controller.enqueue(line({ type: "runtime.log", data: { message: pending } }));
          }
        }

        const finished = await command.wait();
        if (finished.exitCode !== 0) {
          throw new Error(`Agent runtime exited with code ${finished.exitCode}`);
        }

        const status = await sandbox.runCommand({ cmd: "git", args: ["status", "--porcelain"], cwd: repoDir });
        const changed = (await status.stdout()).trim();
        const diffStatCommand = await sandbox.runCommand({ cmd: "git", args: ["diff", "--stat"], cwd: repoDir });
        const diffStat = (await diffStatCommand.stdout()).trim();
        controller.enqueue(line({ type: "workspace.diff", data: { changed, diffStat } }));

        if (!changed) {
          controller.enqueue(line({ type: "control.done", data: { message: "La ejecución terminó sin cambios de archivos." } }));
          return;
        }

        await sandbox.runCommand({ cmd: "git", args: ["add", "-A"], cwd: repoDir });
        const commit = await sandbox.runCommand({
          cmd: "git",
          args: ["commit", "-m", "feat: implement task with AI product team"],
          cwd: repoDir,
        });
        if (commit.exitCode !== 0) {
          throw new Error(`Commit failed: ${(await commit.stderr()).slice(-1200)}`);
        }

        controller.enqueue(line({ type: "control.status", data: { message: "Publicando rama en GitHub…" } }));
        const push = await sandbox.runCommand({
          cmd: "bash",
          args: [
            "-lc",
            'AUTH=$(printf "x-access-token:%s" "$GH_PUSH_TOKEN" | base64 | tr -d "\\n"); git -c http.extraHeader="Authorization: Basic $AUTH" push -u origin "HEAD:$RUN_BRANCH"',
          ],
          cwd: repoDir,
          env: { GH_PUSH_TOKEN: auth.token, RUN_BRANCH: runBranch },
        });
        if (push.exitCode !== 0) {
          throw new Error(`Push failed: ${(await push.stderr()).slice(-1200)}`);
        }

        const prResponse = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            title: `AI Control Room: ${prompt.slice(0, 72)}`,
            head: runBranch,
            base: baseBranch,
            body: [
              "## AI Product Team Control Room",
              "",
              "Cambio implementado por el supervisor y los agentes especializados usando GitHub Copilot SDK dentro de Vercel Sandbox.",
              "",
              `**Solicitud:** ${prompt}`,
              "",
              diffStat ? `**Diff:**\n\`\`\`\n${diffStat}\n\`\`\`` : "",
              "",
              "Revisar los checks y el diff antes de mergear.",
            ].join("\n"),
          }),
        });
        const pr = (await prResponse.json()) as { html_url?: string; number?: number; message?: string };
        if (!prResponse.ok || !pr.html_url) {
          throw new Error(`Branch pushed but PR creation failed: ${pr.message ?? prResponse.status}`);
        }

        controller.enqueue(line({
          type: "control.done",
          data: { repo, baseBranch, branch: runBranch, prUrl: pr.html_url, prNumber: pr.number, diffStat },
        }));
      } catch (error) {
        controller.enqueue(line({
          type: "control.error",
          data: { message: error instanceof Error ? error.message : String(error) },
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
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
