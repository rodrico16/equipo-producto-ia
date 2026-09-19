import { Sandbox } from "@vercel/sandbox";
import { codexRpcSource } from "@/lib/codex-rpc-source";
import {
  createChatGPTAuthSandbox,
  createChatGPTWorkerSandbox,
  readCodexAuthFile,
} from "@/lib/chatgpt-sandbox";

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

async function writeRpc(sandbox: Sandbox) {
  await sandbox.writeFiles([{ path: rpcPath, content: Buffer.from(codexRpcSource) }]);
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

async function runRpcInSandbox(sandbox: Sandbox, mode: "account-read" | "models") {
  await writeRpc(sandbox);
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
}

export async function runCodexRpcWithAuth(authJson: string, mode: "account-read" | "models") {
  const sandbox = await createChatGPTWorkerSandbox(authJson, 90_000);
  try {
    return await runRpcInSandbox(sandbox, mode);
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

export async function startChatGPTDeviceLogin() {
  const sandbox = await createChatGPTAuthSandbox();
  let keepAlive = false;
  try {
    await writeRpc(sandbox);
    await sandbox.runCommand("bash", ["-lc", 'rm -f "$HOME/.codex/control-room-login.json" "$HOME/.codex/auth.json"']);
    await sandbox.runCommand({
      cmd: "node",
      args: [rpcPath],
      detached: true,
      env: { CODEX_RPC_MODE: "login-start" },
    });

    for (let attempt = 0; attempt < 24; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const state = await readStateFromSandbox(sandbox);
      if (state.status !== "disconnected") {
        keepAlive = state.status === "pending";
        return { state, sandboxId: sandbox.sandboxId };
      }
    }
    throw new Error("Codex did not return a device code in time");
  } finally {
    if (!keepAlive) await sandbox.stop().catch(() => undefined);
  }
}

export async function readPendingChatGPTLogin(sandboxId: string) {
  const sandbox = await Sandbox.get({ sandboxId });
  let state = await readStateFromSandbox(sandbox);
  let account: Record<string, unknown> | null = null;

  if (state.status === "pending") {
    try {
      const result = await runRpcInSandbox(sandbox, "account-read");
      const value = result.account;
      if (value && typeof value === "object") {
        account = value as Record<string, unknown>;
        state = {
          ...state,
          status: "connected",
          planType: typeof account.planType === "string" ? account.planType : state.planType,
        };
      }
    } catch {
      // Still genuinely pending.
    }
  }

  if (state.status === "connected") {
    const authJson = await readCodexAuthFile(sandbox);
    if (!account) {
      try {
        const result = await runRpcInSandbox(sandbox, "account-read");
        const value = result.account;
        if (value && typeof value === "object") account = value as Record<string, unknown>;
      } catch {}
    }
    return { state, account, authJson, sandbox };
  }

  return { state, account, authJson: null, sandbox };
}

export async function stopPendingChatGPTLogin(sandboxId: string) {
  try {
    const sandbox = await Sandbox.get({ sandboxId });
    await sandbox.stop().catch(() => undefined);
  } catch {}
}
