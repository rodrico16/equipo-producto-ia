export const asyncPrRunnerSource = String.raw`
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import readline from "node:readline";

const provider = process.env.RUN_PROVIDER || "chatgpt";
const model = process.env.RUN_MODEL || "auto";
const reasoningEffort = process.env.RUN_REASONING_EFFORT || "";
const task = process.env.RUN_TASK || "";
const repo = process.env.RUN_REPO || "";
const repoDir = process.env.RUN_REPO_DIR || process.cwd();
const baseBranch = process.env.RUN_BASE_BRANCH || "main";
const baseSha = process.env.RUN_BASE_SHA || "";
const runBranch = process.env.RUN_BRANCH || "";
const actor = process.env.RUN_ACTOR || "user";
const ghToken = process.env.GH_PUSH_TOKEN || "";
const stateDir = "/tmp/control-room-run";
const eventsPath = stateDir + "/events.ndjson";
const statusPath = stateDir + "/status.json";
const agentDir = "/tmp/equipo-producto-ia-agents/.codex/agents";

delete process.env.GH_PUSH_TOKEN;

let writeQueue = Promise.resolve();
function queueEvent(payload) {
  const event = { ...payload, at: payload.at || new Date().toISOString() };
  writeQueue = writeQueue.then(() => appendFile(eventsPath, JSON.stringify(event) + "\n", "utf8"));
  return writeQueue;
}

async function writeStatus(state, extra = {}) {
  await writeFile(statusPath, JSON.stringify({ state, updatedAt: new Date().toISOString(), ...extra }), "utf8");
}

function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}
function asString(value) {
  return typeof value === "string" ? value : "";
}
function codexAgentName(item) {
  const direct = asString(item.agentName) || asString(item.agent_name) || asString(item.agent_type) || asString(item.agentType) || asString(item.role);
  if (direct) return direct;
  const args = asRecord(item.arguments);
  return asString(args.agentName) || asString(args.agent_name) || asString(args.agent_type) || asString(args.agentType);
}

function normalizeCodex(event) {
  const type = asString(event.type);
  const item = asRecord(event.item);
  const itemType = asString(item.type).toLowerCase();
  const itemId = asString(item.id) || String(Date.now());
  const agentName = codexAgentName(item);

  if (type === "thread.started") return [{ type: "run.started", agentId: "supervisor", data: { provider: "chatgpt" } }];
  if (type === "turn.started") return [{ type: "control.status", data: { message: "ChatGPT/Codex está coordinando el equipo…" } }];
  if (type === "turn.completed") {
    const usage = asRecord(event.usage);
    const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
    const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
    return [{ type: "run.completed", agentId: "supervisor", data: { totalTokens: input + output, provider: "chatgpt" } }];
  }
  if (type === "turn.failed" || type === "error") {
    return [{ type: "run.failed", agentId: "supervisor", data: { message: asString(event.message) || asString(asRecord(event.error).message) || "Codex execution failed" } }];
  }

  const output = [];
  const looksLikeSubagent = itemType.includes("subagent") || itemType.includes("collab") || Boolean(agentName);
  if (looksLikeSubagent && agentName) {
    if (type === "item.started") output.push({ type: "subagent.started", agentId: asString(item.agent_id) || itemId, data: { agentName, model: asString(item.model) } });
    else if (type === "item.completed") output.push({ type: "subagent.completed", agentId: asString(item.agent_id) || itemId, data: { agentName } });
  }
  if (type === "item.started" && itemType === "command_execution") {
    output.push({ type: "tool.started", agentId: agentName || "supervisor", data: { toolName: asString(item.command) || "command" } });
  } else if (type === "item.completed" && itemType === "command_execution") {
    output.push({ type: "tool.completed", agentId: agentName || "supervisor", data: { success: asString(item.status) !== "failed", toolName: asString(item.command) || "command" } });
  } else if (type === "item.completed" && itemType === "agent_message") {
    const text = asString(item.text) || asString(item.content);
    if (text) output.push({ type: "agent.message", agentId: agentName || "supervisor", data: { content: text, messageId: itemId } });
  }
  return output;
}

function runProcess(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: options.cwd || repoDir, env: options.env || process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-8000); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function streamProcess(cmd, args, options, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: options.cwd || repoDir, env: options.env || process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => onLine(line));
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

async function runAgent() {
  if (provider === "copilot") {
    const env = {
      ...process.env,
      COPILOT_GITHUB_TOKEN: ghToken,
      COPILOT_MODEL: model,
      COPILOT_REASONING_EFFORT: reasoningEffort,
      COPILOT_MODE: "pr",
      COPILOT_TASK: task,
      COPILOT_WORKDIR: repoDir,
      COPILOT_AGENT_DIR: agentDir,
    };
    const result = await streamProcess("node", ["/tmp/copilot-runner.mjs"], { cwd: repoDir, env }, (line) => {
      if (!line.trim()) return;
      try { queueEvent(JSON.parse(line)); }
      catch { queueEvent({ type: "runtime.log", data: { message: line } }); }
    });
    await writeQueue;
    if (result.code !== 0) throw new Error(result.stderr || "Copilot runtime exited with code " + result.code);
    return;
  }

  const agentFiles = (await readdir(agentDir)).filter((name) => name.endsWith(".toml"));
  await queueEvent({ type: "team.loaded", data: { count: agentFiles.length, provider: "chatgpt" } });
  const teamPrompt = [
    "Act as the parent coordinator for the AI Product Team.",
    "Use the custom agents available in .codex/agents. Delegate planning/orchestration to the custom agent named supervisor first, then have the supervisor use the relevant specialist agents for product, UX, architecture, engineering, QA, security, data or operations as needed.",
    "Implement the task completely in this repository. Inspect existing conventions before changing code. Run appropriate verification/tests. Do not commit, push, create a PR, expose credentials, or modify git remotes; the Control Room handles delivery after you finish.",
    "Keep unrelated files untouched. Finish with a concise implementation and verification summary.",
    "",
    "USER OBJECTIVE:\n" + task,
  ].join("\n");

  const codexArgs = ["--sandbox", "danger-full-access", "--ask-for-approval", "never"];
  if (model && model !== "auto") codexArgs.push("--model", model);
  if (reasoningEffort) codexArgs.push("-c", "model_reasoning_effort=\"" + reasoningEffort.replaceAll('"', "") + "\"");
  codexArgs.push("exec", "--json", teamPrompt);

  const result = await streamProcess(
    "bash",
    ["-lc", 'export PATH="$HOME/.local/bin:$PATH"; exec codex "$@"', "codex", ...codexArgs],
    { cwd: repoDir, env: process.env },
    (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        for (const normalized of normalizeCodex(event)) queueEvent(normalized);
      } catch {
        queueEvent({ type: "runtime.log", data: { message: line } });
      }
    },
  );
  await writeQueue;
  if (result.code !== 0) throw new Error(result.stderr || "Codex runtime exited with code " + result.code);
}

async function finalizeGitHub() {
  const status = await runProcess("git", ["status", "--porcelain"], { cwd: repoDir });
  if (status.code !== 0) throw new Error("Could not inspect git status: " + status.stderr);
  const head = await runProcess("git", ["rev-parse", "HEAD"], { cwd: repoDir });
  const headSha = head.stdout.trim();
  const changedWorkingTree = status.stdout.trim();
  const agentCreatedCommits = Boolean(baseSha && headSha && headSha !== baseSha);

  if (!changedWorkingTree && !agentCreatedCommits) {
    await queueEvent({ type: "workspace.diff", data: { changed: "", diffStat: "" } });
    await queueEvent({ type: "control.done", data: { message: "La ejecución terminó sin cambios de archivos.", delivery: "github", repo, provider, baseBranch, actor } });
    await writeStatus("done", { message: "No file changes" });
    return;
  }

  if (changedWorkingTree) {
    const add = await runProcess("git", ["add", "-A"], { cwd: repoDir });
    if (add.code !== 0) throw new Error("git add failed: " + add.stderr);
    const commit = await runProcess("git", ["commit", "-m", "feat: implement task with AI product team (" + provider + ")"], { cwd: repoDir });
    if (commit.code !== 0) throw new Error("Commit failed: " + commit.stderr);
  }

  const diffStatResult = await runProcess("git", ["diff", "--stat", baseSha + "..HEAD"], { cwd: repoDir });
  const diffNamesResult = await runProcess("git", ["diff", "--name-status", baseSha + "..HEAD"], { cwd: repoDir });
  const diffStat = diffStatResult.stdout.trim();
  const changed = diffNamesResult.stdout.trim();
  await queueEvent({ type: "workspace.diff", data: { changed, diffStat } });
  await queueEvent({ type: "control.status", data: { message: "Publicando rama en GitHub…" } });

  if (!ghToken) throw new Error("GitHub token missing during finalization");
  const auth = Buffer.from("x-access-token:" + ghToken).toString("base64");
  const push = await runProcess("git", ["-c", "http.extraHeader=Authorization: Basic " + auth, "push", "-u", "origin", "HEAD:" + runBranch], { cwd: repoDir });
  if (push.code !== 0) throw new Error("Push failed: " + push.stderr);

  const title = "AI Control Room: " + task.replace(/\s+/g, " ").trim().slice(0, 72);
  const prResponse = await fetch("https://api.github.com/repos/" + repo + "/pulls", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + ghToken,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      head: runBranch,
      base: baseBranch,
      body: [
        "## AI Product Team Control Room",
        "",
        "Cambio implementado por el supervisor y agentes especializados usando **" + (provider === "chatgpt" ? "ChatGPT / Codex" : "GitHub Copilot") + "** dentro de Vercel Sandbox.",
        "",
        "**Solicitud:** " + task,
        "",
        diffStat ? "**Diff:**\n```\n" + diffStat + "\n```" : "",
        "",
        "Revisar los checks y el diff antes de mergear.",
      ].join("\n"),
    }),
  });
  const pr = await prResponse.json();
  if (!prResponse.ok || !pr.html_url) throw new Error("Branch pushed but PR creation failed: " + (pr.message || prResponse.status));

  await queueEvent({
    type: "control.done",
    data: {
      repo,
      provider,
      baseBranch,
      branch: runBranch,
      prUrl: pr.html_url,
      prNumber: pr.number,
      diffStat,
      delivery: "github",
      actor,
    },
  });
  await writeStatus("done", { prUrl: pr.html_url, prNumber: pr.number, branch: runBranch });
}

await mkdir(stateDir, { recursive: true });
await writeFile(eventsPath, "", "utf8");
await writeStatus("running", { provider, repo, branch: runBranch });

try {
  await queueEvent({ type: "control.status", data: { message: "Ejecución desacoplada del navegador · el trabajo sigue aunque cambies de red." } });
  await runAgent();
  await finalizeGitHub();
  await writeQueue;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await queueEvent({ type: "control.error", data: { message } });
  await writeQueue;
  await writeStatus("error", { error: message });
  process.exitCode = 1;
}
`;
