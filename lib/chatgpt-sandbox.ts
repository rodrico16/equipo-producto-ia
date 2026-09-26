import { randomUUID } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";

const CODEX_EVENT_BRIDGE_SOURCE = String.raw`#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const home = os.homedir();
const realCodex = process.env.CODEX_REAL_BIN || path.join(home, ".local", "bin", "codex-real");
const sessionsDir = path.join(home, ".codex", "sessions");
const startedAt = Date.now();
const offsets = new Map();
const pending = new Map();
const nativeStarted = new Set();
const nativeCompleted = new Set();
const bridged = new Map();
const scheduled = new Map();
const assignmentEmitted = new Set();
let stdoutBuffer = "";
let scanBusy = false;
let closing = false;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function text(value) {
  return typeof value === "string" ? value : "";
}
function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}
function agentName(value) {
  const source = record(parseMaybeJson(value));
  return text(source.agent_type) || text(source.agentType) || text(source.agent_name) || text(source.agentName) || text(source.agent) || text(source.role);
}
function assignmentText(value) {
  const source = record(parseMaybeJson(value));
  return text(source.prompt) || text(source.task) || text(source.message) || text(source.description) || text(source.instruction) || text(source.instructions) || text(source.objective);
}
function nativeLifecycle(line) {
  let event;
  try { event = JSON.parse(line); } catch { return; }
  const item = record(event.item);
  const itemType = text(item.type).toLowerCase();
  if (!itemType.includes("subagent") && !itemType.includes("collab")) return;
  const name = agentName(item) || agentName(item.arguments);
  if (!name) return;
  if (event.type === "item.started") nativeStarted.add(name);
  if (event.type === "item.completed") nativeCompleted.add(name);
}
function emitLifecycle(type, name, callId) {
  const id = "rollout-bridge-" + String(callId || name || Date.now());
  process.stdout.write(JSON.stringify({
    type,
    item: {
      id,
      type: "subagent",
      agentName: name,
      agent_id: id,
      source: "codex-rollout-bridge",
    },
  }) + "\n");
}
function emitAssignment(name, callId, assignment) {
  const clean = text(assignment).trim();
  const key = String(callId || name) + ":" + name;
  if (!clean || assignmentEmitted.has(key)) return;
  assignmentEmitted.add(key);
  const id = "rollout-assignment-" + String(callId || name || Date.now());
  process.stdout.write(JSON.stringify({
    type: "rollout.assignment",
    item: {
      id,
      type: "agent_assignment",
      agentName: name,
      agent_id: id,
      assignment: clean,
      source: "codex-rollout-bridge",
    },
  }) + "\n");
}
function scheduleStart(name, callId) {
  if (!name || name === "supervisor" || bridged.has(name) || scheduled.has(name)) return;
  const timer = setTimeout(() => {
    scheduled.delete(name);
    if (nativeStarted.has(name) || closing) return;
    bridged.set(name, callId);
    emitLifecycle("item.started", name, callId);
  }, 350);
  scheduled.set(name, timer);
}
function extractSpawn(event) {
  const payload = record(event.payload);
  const candidate = payload.type === "function_call" ? payload : record(event.item);
  const toolName = (text(candidate.name) || text(candidate.tool_name) || text(candidate.toolName)).toLowerCase();
  if (toolName !== "spawn_agent" && toolName !== "spawn_agents") return [];
  const rawArguments = parseMaybeJson(candidate.arguments);
  const argsRecord = record(rawArguments);
  const callId = text(candidate.call_id) || text(candidate.callId) || text(candidate.id) || String(Date.now());
  const requests = Array.isArray(rawArguments)
    ? rawArguments
    : Array.isArray(argsRecord.agents)
      ? argsRecord.agents
      : Array.isArray(argsRecord.tasks)
        ? argsRecord.tasks
        : [argsRecord];
  return requests.map((request, index) => {
    const source = record(parseMaybeJson(request));
    const name = agentName(source) || text(source.task_name) || text(source.taskName) || ("especialista_" + callId.slice(-8) + (requests.length > 1 ? "_" + (index + 1) : ""));
    const assignment = assignmentText(source) || assignmentText(argsRecord);
    return { name, assignment, callId: requests.length > 1 ? callId + "-" + index : callId };
  });
}
async function listJsonl(dir, out = []) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await listJsonl(full, out);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}
async function consumeFile(file) {
  let stat;
  try { stat = await fs.stat(file); } catch { return; }
  if (stat.mtimeMs < startedAt - 2000) return;
  const offset = offsets.get(file) || 0;
  if (stat.size <= offset) return;
  let handle;
  try {
    handle = await fs.open(file, "r");
    const size = stat.size - offset;
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, offset);
    offsets.set(file, stat.size);
    const chunk = (pending.get(file) || "") + buffer.toString("utf8");
    const lines = chunk.split("\n");
    pending.set(file, lines.pop() || "");
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      for (const spawnEvent of extractSpawn(event)) {
        emitAssignment(spawnEvent.name, spawnEvent.callId, spawnEvent.assignment);
        scheduleStart(spawnEvent.name, spawnEvent.callId);
      }
    }
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
async function scanSessions() {
  if (!jsonMode || scanBusy || closing) return;
  scanBusy = true;
  try {
    const files = await listJsonl(sessionsDir);
    for (const file of files) await consumeFile(file);
  } finally {
    scanBusy = false;
  }
}

const child = spawn(realCodex, args, { env: process.env, stdio: ["inherit", "pipe", "pipe"] });
child.stdout.on("data", (chunk) => {
  const value = chunk.toString();
  process.stdout.write(value);
  if (!jsonMode) return;
  stdoutBuffer += value;
  const lines = stdoutBuffer.split("\n");
  stdoutBuffer = lines.pop() || "";
  for (const line of lines) if (line.trim()) nativeLifecycle(line);
});
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
child.on("error", (error) => {
  process.stderr.write(String(error instanceof Error ? error.stack || error.message : error) + "\n");
});

const poll = jsonMode ? setInterval(() => { void scanSessions(); }, 200) : null;
if (poll) poll.unref();
void scanSessions();

child.on("close", async (code, signal) => {
  if (poll) clearInterval(poll);
  await scanSessions().catch(() => undefined);
  closing = true;
  for (const [name, timer] of scheduled) {
    clearTimeout(timer);
    if (!nativeStarted.has(name) && !bridged.has(name)) {
      bridged.set(name, name);
      emitLifecycle("item.started", name, name);
    }
  }
  for (const [name, callId] of bridged) {
    if (!nativeCompleted.has(name)) emitLifecycle("item.completed", name, callId);
  }
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
`;

export const CODEX_BWRAP_PREFLIGHT = String.raw`#!/usr/bin/env bash
set -uo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

bwrap_bin="$(command -v bwrap || true)"
if [ -z "$bwrap_bin" ]; then
  echo "bwrap is missing from the Vercel Sandbox runtime." >&2
  exit 127
fi

permissions="$(stat -c '%a' "$bwrap_bin" 2>/dev/null || true)"
if [ -z "$permissions" ]; then
  echo "Could not read bwrap permissions inside the Vercel Sandbox." >&2
  exit 70
fi

is_setuid=0
if (( (8#$permissions & 04000) != 0 )); then
  is_setuid=1
fi

output_file="$(mktemp)"
trap 'rm -f "$output_file"' EXIT
if "$bwrap_bin" --ro-bind / / true >"$output_file" 2>&1; then
  exit 0
fi
probe_output="$(cat "$output_file" 2>/dev/null || true)"

if [ "$is_setuid" -eq 0 ] && printf '%s' "$probe_output" | grep -Fq 'Unexpected capabilities but not setuid'; then
  if command -v setcap >/dev/null 2>&1; then
    if [ "$(id -u)" -eq 0 ]; then
      if ! setcap -r "$bwrap_bin"; then
        echo "bwrap reports stale file capabilities, but setcap could not remove them." >&2
        exit 70
      fi
    elif command -v sudo >/dev/null 2>&1; then
      if ! sudo -n setcap -r "$bwrap_bin"; then
        echo "bwrap reports stale file capabilities, but sudo setcap could not remove them." >&2
        exit 70
      fi
    else
      echo "bwrap reports stale file capabilities, but setcap is unavailable." >&2
      exit 70
    fi

    if "$bwrap_bin" --ro-bind / / true >"$output_file" 2>&1; then
      exit 0
    fi
    probe_output="$(cat "$output_file" 2>/dev/null || true)"
  else
    echo "bwrap reports stale file capabilities, but setcap is unavailable." >&2
    exit 70
  fi
fi

printf 'Codex bwrap preflight failed (mode=%s): %s\n' "$permissions" "$probe_output" >&2
if printf '%s' "$probe_output" | grep -Fq 'Operation not permitted'; then
  echo "The Vercel Sandbox runtime does not allow the namespaces required by Codex. No unsandboxed fallback was started." >&2
fi
exit 70
`;

async function ensureBubblewrapInstalled(sandbox: Sandbox) {
  const installScript = String.raw`set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -n "$@"
  else
    echo "bwrap is missing and no root/sudo access is available to install it." >&2
    return 77
  fi
}

if ! command -v bwrap >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then
    run_privileged dnf install -y bubblewrap
  elif command -v microdnf >/dev/null 2>&1; then
    run_privileged microdnf install -y bubblewrap
  elif command -v yum >/dev/null 2>&1; then
    run_privileged yum install -y bubblewrap
  elif command -v apt-get >/dev/null 2>&1; then
    run_privileged apt-get update -qq
    run_privileged apt-get install -y bubblewrap
  elif command -v apk >/dev/null 2>&1; then
    run_privileged apk add --no-cache bubblewrap
  else
    os_description="$(
      . /etc/os-release 2>/dev/null || true
      printf '%s' "\${PRETTY_NAME:-unknown}"
    )"
    echo "bwrap is missing and no supported package manager is available in the Vercel Sandbox runtime (os=\${os_description}; checked: dnf, microdnf, yum, apt-get, apk)." >&2
    exit 127
  fi
fi

command -v bwrap >/dev/null 2>&1 || {
  echo "The package installation completed without providing bwrap." >&2
  exit 70
}
`;

  const result = await sandbox.runCommand("bash", ["-lc", installScript]);
  if (result.exitCode !== 0) {
    const [stderr, stdout] = await Promise.all([result.stderr(), result.stdout()]);
    const details = [stderr, stdout].map((value) => value.trim()).filter(Boolean).join("\n").slice(-2000);
    throw new Error(
      details
        ? `Could not provision bubblewrap in Vercel Sandbox: ${details}`
        : "Could not provision bubblewrap in Vercel Sandbox.",
    );
  }
}

async function ensureCodexSandbox(sandbox: Sandbox) {
  const result = await sandbox.runCommand("bash", ["-lc", CODEX_BWRAP_PREFLIGHT]);
  if (result.exitCode !== 0) {
    const details = (await result.stderr()).trim().slice(-1200);
    throw new Error(
      details
        ? `Codex sandbox preflight failed: ${details}`
        : "Codex sandbox preflight failed inside Vercel Sandbox.",
    );
  }
}

export const CHATGPT_AUTH_NETWORK_POLICY = {
  allow: [
    "chatgpt.com",
    "*.chatgpt.com",
    "*.openai.com",
    "github.com",
    "*.github.com",
    "*.githubusercontent.com",
  ],
};

export const CHATGPT_WORKER_NETWORK_POLICY = {
  allow: [
    ...CHATGPT_AUTH_NETWORK_POLICY.allow,
    "registry.npmjs.org",
    "*.npmjs.org",
    "registry.yarnpkg.com",
    "pypi.org",
    "files.pythonhosted.org",
    "cdn.amazonlinux.com",
    "al2023-repos-us-east-1-de612dc2.s3.dualstack.us-east-1.amazonaws.com",
    "al2023-repos-us-east-1-de612dc2.s3.us-east-1.amazonaws.com",
    "archive.ubuntu.com",
    "security.ubuntu.com",
    "ports.ubuntu.com",
    "deb.debian.org",
    "security.debian.org",
    "dl-cdn.alpinelinux.org",
  ],
};

async function ensureCodex(sandbox: Sandbox) {
  const check = await sandbox.runCommand("bash", [
    "-lc",
    'export PATH="$HOME/.local/bin:$PATH"; command -v codex >/dev/null 2>&1',
  ]);
  if (check.exitCode === 0) return;

  const install = await sandbox.runCommand("bash", [
    "-lc",
    [
      "set -euo pipefail",
      "curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh",
      'export PATH="$HOME/.local/bin:$PATH"',
      "command -v codex >/dev/null 2>&1",
    ].join("; "),
  ]);
  if (install.exitCode !== 0) {
    throw new Error(`Codex installation failed: ${(await install.stderr()).slice(-1200)}`);
  }
}

async function installCodexEventBridge(sandbox: Sandbox) {
  await sandbox.writeFiles([
    { path: "/tmp/codex-event-bridge.mjs", content: Buffer.from(CODEX_EVENT_BRIDGE_SOURCE, "utf8") },
  ]);
  const install = await sandbox.runCommand("bash", [
    "-lc",
    [
      "set -euo pipefail",
      'mkdir -p "$HOME/.local/bin"',
      'export PATH="$HOME/.local/bin:$PATH"',
      'BRIDGE="$HOME/.local/bin/codex"',
      'REAL="$HOME/.local/bin/codex-real"',
      'if [ ! -e "$REAL" ]; then CURRENT="$(command -v codex)"; if [ "$CURRENT" = "$BRIDGE" ]; then mv "$BRIDGE" "$REAL"; else ln -s "$CURRENT" "$REAL"; fi; fi',
      'cp /tmp/codex-event-bridge.mjs "$BRIDGE"',
      'chmod 0755 "$BRIDGE"',
      'rm -f /tmp/codex-event-bridge.mjs',
    ].join("; "),
  ]);
  if (install.exitCode !== 0) {
    throw new Error(`Could not install Codex event bridge: ${(await install.stderr()).slice(-1200)}`);
  }
}

async function restoreAuth(sandbox: Sandbox, authJson?: string | null) {
  if (!authJson) return;
  await sandbox.writeFiles([
    { path: "/tmp/control-room-codex-auth.json", content: Buffer.from(authJson, "utf8") },
  ]);
  const restore = await sandbox.runCommand("bash", [
    "-lc",
    'set -e; mkdir -p "$HOME/.codex"; chmod 700 "$HOME/.codex"; cp /tmp/control-room-codex-auth.json "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"; rm -f /tmp/control-room-codex-auth.json',
  ]);
  if (restore.exitCode !== 0) throw new Error("Could not restore ChatGPT credentials into the worker sandbox");
}

export async function createChatGPTAuthSandbox() {
  const sandbox = await Sandbox.create({
    name: `codex-auth-${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    persistent: false,
    timeout: 12 * 60 * 1000,
    networkPolicy: CHATGPT_AUTH_NETWORK_POLICY,
  });
  await ensureCodex(sandbox);
  return sandbox;
}

export async function createChatGPTRpcSandbox(authJson: string) {
  const sandbox = await Sandbox.create({
    persistent: false,
    timeout: 90_000,
    networkPolicy: CHATGPT_AUTH_NETWORK_POLICY,
  });
  try {
    await ensureCodex(sandbox);
    await restoreAuth(sandbox, authJson);
    return sandbox;
  } catch (error) {
    await sandbox.stop().catch(() => undefined);
    throw error;
  }
}

export async function createChatGPTWorkerSandbox(authJson: string, timeout = 20 * 60 * 1000) {
  const sandbox = await Sandbox.create({
    persistent: false,
    timeout,
    networkPolicy: CHATGPT_WORKER_NETWORK_POLICY,
  });
  await ensureCodex(sandbox);
  await ensureBubblewrapInstalled(sandbox);
  await ensureCodexSandbox(sandbox);
  await restoreAuth(sandbox, authJson);
  await installCodexEventBridge(sandbox);
  return sandbox;
}

export async function readCodexAuthFile(sandbox: Sandbox) {
  const result = await sandbox.runCommand("bash", [
    "-lc",
    'if [ -f "$HOME/.codex/auth.json" ]; then cat "$HOME/.codex/auth.json"; else exit 44; fi',
  ]);
  if (result.exitCode !== 0) throw new Error("Codex did not persist ChatGPT credentials");
  const value = (await result.stdout()).trim();
  JSON.parse(value);
  return value;
}
