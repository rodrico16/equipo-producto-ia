import { randomUUID } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { readCodexAuth } from "@/lib/chatgpt-auth-cookie";
import { createChatGPTWorkerSandbox } from "@/lib/chatgpt-sandbox";
import { copilotRunnerSource } from "@/lib/copilot-runner-source";
import { asyncPrRunnerSource } from "@/lib/async-pr-runner-source";
import { getGitHubSession, requireControlRoomIdentity } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

type RunRequest = {
  repo?: string;
  branch?: string;
  provider?: "copilot" | "chatgpt";
  model?: string;
  reasoningEffort?: string;
  prompt?: string;
};

const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUN_TIMEOUT_MS = 20 * 60 * 1000;

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as RunRequest;
  const repo = body.repo?.trim() || "";
  const prompt = body.prompt?.trim() || "";
  const provider = body.provider === "copilot" ? "copilot" : "chatgpt";
  const model = body.model?.trim() || "auto";
  const reasoningEffort = body.reasoningEffort?.trim() || "";

  if (!repoPattern.test(repo)) return Response.json({ error: "Repository must be owner/name" }, { status: 400 });
  if (!prompt) return Response.json({ error: "Prompt is required" }, { status: 400 });

  try {
    await requireControlRoomIdentity();
  } catch {
    return Response.json({ error: "Session required" }, { status: 401 });
  }

  const github = await getGitHubSession();
  if (!github) return Response.json({ error: "Conectá GitHub para crear un Pull Request" }, { status: 401 });

  const chatGPTAuth = provider === "chatgpt" ? await readCodexAuth() : null;
  if (provider === "chatgpt" && !chatGPTAuth) {
    return Response.json({ error: "Conectá ChatGPT para continuar" }, { status: 401 });
  }

  const repoResponse = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: githubHeaders(github.token),
    cache: "no-store",
  });
  if (!repoResponse.ok) return Response.json({ error: `GitHub repository access failed (${repoResponse.status})` }, { status: 400 });
  const repoInfo = (await repoResponse.json()) as { default_branch?: string };
  const baseBranch = body.branch?.trim() || repoInfo.default_branch || "main";

  const runId = randomUUID().replaceAll("-", "").slice(0, 24);
  const sandboxName = `ai-run-${runId}`;
  const runBranch = `ai/control-room-${Date.now()}`;
  const repoName = repo.split("/")[1];
  const workspace = "/tmp/control-room-work";
  const repoDir = `${workspace}/${repoName}`;
  let sandbox: Sandbox | undefined;

  try {
    sandbox = provider === "chatgpt"
      ? await createChatGPTWorkerSandbox(chatGPTAuth!, RUN_TIMEOUT_MS, sandboxName)
      : await Sandbox.create({
          name: sandboxName,
          persistent: false,
          timeout: RUN_TIMEOUT_MS,
          networkPolicy: "allow-all",
        });

    const prep = await sandbox.runCommand("bash", ["-lc", `mkdir -p ${workspace} /tmp/control-room-run`]);
    if (prep.exitCode !== 0) throw new Error("Could not prepare run workspace");

    const clone = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-lc",
        'AUTH=$(printf "x-access-token:%s" "$GH_CLONE_TOKEN" | base64 | tr -d "\\n"); git -c http.extraHeader="Authorization: Basic $AUTH" clone --depth 1 --branch "$BASE_BRANCH" "https://github.com/$TARGET_REPO.git" "$TARGET_DIR"',
      ],
      env: {
        GH_CLONE_TOKEN: github.token,
        BASE_BRANCH: baseBranch,
        TARGET_REPO: repo,
        TARGET_DIR: repoDir,
      },
    });
    if (clone.exitCode !== 0) throw new Error(`Git clone failed: ${(await clone.stderr()).slice(-1200)}`);

    await sandbox.runCommand({ cmd: "git", args: ["remote", "set-url", "origin", `https://github.com/${repo}.git`], cwd: repoDir });
    const baseShaResult = await sandbox.runCommand({ cmd: "git", args: ["rev-parse", "HEAD"], cwd: repoDir });
    const baseSha = (await baseShaResult.stdout()).trim();
    if (!baseSha) throw new Error("Could not resolve base commit");

    const branch = await sandbox.runCommand({ cmd: "git", args: ["switch", "-c", runBranch], cwd: repoDir });
    if (branch.exitCode !== 0) throw new Error(`Could not create run branch: ${(await branch.stderr()).slice(-900)}`);
    await sandbox.runCommand({ cmd: "git", args: ["config", "user.name", `${github.login} via AI Control Room`], cwd: repoDir });
    await sandbox.runCommand({ cmd: "git", args: ["config", "user.email", `${github.login}@users.noreply.github.com`], cwd: repoDir });

    const agentsClone = await sandbox.runCommand("git", [
      "clone",
      "--depth",
      "1",
      "https://github.com/rodrico16/equipo-producto-ia.git",
      "/tmp/equipo-producto-ia-agents",
    ]);
    if (agentsClone.exitCode !== 0) throw new Error(`Could not load agent catalog: ${(await agentsClone.stderr()).slice(-1000)}`);

    if (provider === "chatgpt") {
      const installAgents = await sandbox.runCommand({
        cmd: "bash",
        args: [
          "-lc",
          'mkdir -p .codex/agents; cp -n /tmp/equipo-producto-ia-agents/.codex/agents/*.toml .codex/agents/; if [ -z "$(git ls-files \'.codex/**\')" ]; then grep -qxF "/.codex/" .git/info/exclude || echo "/.codex/" >> .git/info/exclude; fi',
        ],
        cwd: repoDir,
      });
      if (installAgents.exitCode !== 0) throw new Error(`Could not install Codex agents: ${(await installAgents.stderr()).slice(-1000)}`);
    } else {
      await sandbox.writeFiles([
        { path: "/tmp/copilot-runner.mjs", content: Buffer.from(copilotRunnerSource) },
        { path: "/tmp/package.json", content: Buffer.from(JSON.stringify({ type: "module", private: true })) },
      ]);
      const install = await sandbox.runCommand({
        cmd: "npm",
        args: ["install", "--prefix", "/tmp", "@github/copilot-sdk@1.0.14", "--no-audit", "--no-fund"],
      });
      if (install.exitCode !== 0) throw new Error(`Copilot SDK install failed: ${(await install.stderr()).slice(-1200)}`);
    }

    await sandbox.writeFiles([
      { path: "/tmp/control-room-run/runner.mjs", content: Buffer.from(asyncPrRunnerSource) },
    ]);

    const command = await sandbox.runCommand({
      cmd: "node",
      args: ["/tmp/control-room-run/runner.mjs"],
      cwd: repoDir,
      detached: true,
      env: {
        RUN_PROVIDER: provider,
        RUN_MODEL: model,
        RUN_REASONING_EFFORT: reasoningEffort,
        RUN_TASK: prompt,
        RUN_REPO: repo,
        RUN_REPO_DIR: repoDir,
        RUN_BASE_BRANCH: baseBranch,
        RUN_BASE_SHA: baseSha,
        RUN_BRANCH: runBranch,
        RUN_ACTOR: github.login,
        GH_PUSH_TOKEN: github.token,
      },
    });

    return Response.json({
      runId,
      state: "running",
      sandboxName,
      commandId: command.cmdId,
      repo,
      provider,
      baseBranch,
      branch: runBranch,
    });
  } catch (error) {
    if (sandbox) await sandbox.stop().catch(() => undefined);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
