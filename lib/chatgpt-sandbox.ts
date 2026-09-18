import { createHash } from "node:crypto";
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
} as const;

export const CHATGPT_WORKER_NETWORK_POLICY = {
  allow: [
    ...CHATGPT_AUTH_NETWORK_POLICY.allow,
    "registry.npmjs.org",
    "*.npmjs.org",
    "registry.yarnpkg.com",
    "pypi.org",
    "files.pythonhosted.org",
  ],
} as const;

export function chatGPTSandboxName(login: string) {
  const suffix = createHash("sha256").update(login.toLowerCase()).digest("hex").slice(0, 20);
  return `chatgpt-codex-${suffix}`;
}

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

async function hardenPersistentSandbox(sandbox: Sandbox) {
  await ensureCodex(sandbox);
  await sandbox.update({ networkPolicy: CHATGPT_AUTH_NETWORK_POLICY });
}

export async function getChatGPTSandbox(login: string) {
  const sandbox = await Sandbox.getOrCreate({
    name: chatGPTSandboxName(login),
    resume: true,
    onCreate: hardenPersistentSandbox,
    onResume: hardenPersistentSandbox,
  });

  // Reassert the firewall on every access in case the named sandbox was already
  // running and no lifecycle callback fired.
  await sandbox.update({ networkPolicy: CHATGPT_AUTH_NETWORK_POLICY });
  return sandbox;
}
