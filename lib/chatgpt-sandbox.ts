import { randomUUID } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";

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

export async function createChatGPTWorkerSandbox(authJson: string, timeout = 20 * 60 * 1000) {
  const sandbox = await Sandbox.create({
    persistent: false,
    timeout,
    networkPolicy: CHATGPT_WORKER_NETWORK_POLICY,
  });
  await ensureCodex(sandbox);
  await restoreAuth(sandbox, authJson);
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
