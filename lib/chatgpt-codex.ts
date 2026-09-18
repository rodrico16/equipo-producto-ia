import type { Sandbox } from "@vercel/sandbox";
import { codexRpcSource } from "@/lib/codex-rpc-source";
import { getChatGPTSandbox } from "@/lib/chatgpt-sandbox";

const rpcPath = "/tmp/control-room-codex-rpc.mjs";

type RpcEnvelope = {
  ok?: boolean;
  result?: Record<string, unknown>;
  error?: { message?: string } | string;
};

export type ChatGPTLoginState = {
  status: "disconnected" | "pending" | "connected" | "failed" | "expired";
  loginId?: string | null;
  verificationUrl?: string | null;
  userCode?: string | null;
  planType?: string | null;
  error?: string | null;
  updatedAt?: string;
};

async function prepare(login: string) {
  const sandbox = await getChatGPTSandbox(login);
  await sandbox.writeFiles([{ path: rpcPath, content: Buffer.from(codexRpcSource) }]);
  return sandbox;
}

function parseRpcOutput(output: string): RpcEnvelope {
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]) as RpcEnvelope;
    } catch {}
  }
  throw new Error("Codex app-server returned no structured response");
}

export async function runCodexRpc(login: string, mode: "account-read" | "models") {
  const sandbox = await prepare(login);
  try {
    const command = await sandbox.runCommand({
      cmd: "node",
      args: [rpcPath],
      env: { CODEX_RPC_MODE: mode },
    });
    const stdout = await command.stdout();
    if (command.exitCode !== 0) {
      const stderr = await command.stderr();
      throw new Error(stderr.trim() || `Codex ${mode} failed`);
    }
    const payload = parseRpcOutput(stdout);
    if (!payload.ok) {
      const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
      throw new Error(message || `Codex ${mode} failed`);
    }
    return payload.result ?? {};
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}

async function readStateFromSandbox(sandbox: Sandbox): Promise<ChatGPTLoginState> {
  const result = await sandbox.runCommand("bash", [
    "-lc",
    'if [ -f "$HOME/.codex/control-room-login.json" ]; then cat "$HOME/.codex/control-room-login.json"; else printf \'{"status":"disconnected"}\'; fi',
  ]);
  if (result.exitCode !== 0) return { status: "disconnected" };
  try {
    return JSON.parse(await result.stdout()) as ChatGPTLoginState;
  } catch {
    return { status: "disconnected" };
  }
}

export async function readChatGPTLoginState(login: string) {
  const sandbox = await prepare(login);
  try {
    return await readStateFromSandbox(sandbox);
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}

export async function startChatGPTDeviceLogin(login: string) {
  const sandbox = await prepare(login);
  try {
    await sandbox.runCommand("bash", ["-lc", 'rm -f "$HOME/.codex/control-room-login.json"']);
    await sandbox.runCommand({
      cmd: "node",
      args: [rpcPath],
      detached: true,
      env: { CODEX_RPC_MODE: "login-start" },
    });

    for (let attempt = 0; attempt < 16; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const state = await readStateFromSandbox(sandbox);
      if (state.status !== "disconnected") return state;
    }
    throw new Error("Codex did not return a device code in time");
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}

export async function logoutChatGPT(login: string) {
  const sandbox = await prepare(login);
  try {
    await sandbox.runCommand("bash", [
      "-lc",
      'export PATH="$HOME/.local/bin:$PATH"; codex logout >/dev/null 2>&1 || true; rm -f "$HOME/.codex/control-room-login.json"',
    ]);
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}
