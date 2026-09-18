export const codexRpcSource = String.raw`import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const mode = process.env.CODEX_RPC_MODE || "account-read";
const home = os.homedir();
const codexDir = path.join(home, ".codex");
const stateFile = path.join(codexDir, "control-room-login.json");
await mkdir(codexDir, { recursive: true });

function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

async function saveState(patch) {
  let current = {};
  try {
    current = JSON.parse(await readFile(stateFile, "utf8"));
  } catch {}
  await writeFile(stateFile, JSON.stringify({ ...current, ...patch, updatedAt: new Date().toISOString() }, null, 2));
}

const proc = spawn("codex", ["app-server"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    PATH: [path.join(home, ".local", "bin"), process.env.PATH || ""].filter(Boolean).join(":"),
  },
});

let initialized = false;
let finished = false;
let planType = null;

function send(message) {
  proc.stdin.write(JSON.stringify(message) + "\n");
}

async function finish(code = 0) {
  if (finished) return;
  finished = true;
  try { proc.stdin.end(); } catch {}
  try { proc.kill("SIGTERM"); } catch {}
  setTimeout(() => process.exit(code), 20);
}

const rl = readline.createInterface({ input: proc.stdout });
rl.on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.id === 0 && !initialized) {
    initialized = true;
    send({ method: "initialized", params: {} });
    if (mode === "login-start") {
      send({ method: "account/login/start", id: 1, params: { type: "chatgptDeviceCode" } });
    } else if (mode === "account-read") {
      send({ method: "account/read", id: 2, params: { refreshToken: false } });
    } else if (mode === "models") {
      send({ method: "model/list", id: 3, params: { limit: 50, includeHidden: false } });
    }
    return;
  }

  if (mode === "login-start" && msg.id === 1) {
    if (msg.error) {
      await saveState({ status: "failed", error: msg.error?.message || "Could not start ChatGPT login" });
      emit({ ok: false, error: msg.error });
      await finish(1);
      return;
    }
    const result = msg.result || {};
    await saveState({
      status: "pending",
      loginId: result.loginId || null,
      verificationUrl: result.verificationUrl || null,
      userCode: result.userCode || null,
      error: null,
    });
    emit({ ok: true, result });
    return;
  }

  if (mode === "account-read" && msg.id === 2) {
    emit(msg.error ? { ok: false, error: msg.error } : { ok: true, result: msg.result });
    await finish(msg.error ? 1 : 0);
    return;
  }

  if (mode === "models" && msg.id === 3) {
    emit(msg.error ? { ok: false, error: msg.error } : { ok: true, result: msg.result });
    await finish(msg.error ? 1 : 0);
    return;
  }

  if (msg.method === "account/updated") {
    planType = msg.params?.planType || planType;
    if (mode === "login-start") await saveState({ planType });
    return;
  }

  if (mode === "login-start" && msg.method === "account/login/completed") {
    const success = Boolean(msg.params?.success);
    await saveState({
      status: success ? "connected" : "failed",
      loginId: msg.params?.loginId || null,
      planType,
      error: success ? null : msg.params?.error || "ChatGPT login failed",
    });
    emit({ ok: success, completed: true, planType, error: msg.params?.error || null });
    await finish(success ? 0 : 1);
  }
});

proc.stderr.on("data", () => {});
proc.on("exit", async (code) => {
  if (!finished && mode === "login-start") {
    await saveState({ status: "failed", error: "Codex app-server exited (" + (code ?? "unknown") + ")" });
  }
  if (!finished) process.exit(code ?? 1);
});

send({
  method: "initialize",
  id: 0,
  params: {
    clientInfo: {
      name: "ai_product_team_control_room",
      title: "AI Product Team Control Room",
      version: "0.2.0",
    },
  },
});

if (mode === "login-start") {
  setTimeout(async () => {
    if (finished) return;
    await saveState({ status: "expired", error: "Device login expired. Start a new login." });
    await finish(1);
  }, 10 * 60 * 1000);
} else {
  setTimeout(() => finish(1), 30_000);
}
`;
