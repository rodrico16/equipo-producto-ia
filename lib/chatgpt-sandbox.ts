import { createHash } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";

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

export async function getChatGPTSandbox(login: string) {
  return Sandbox.getOrCreate({
    name: chatGPTSandboxName(login),
    resume: true,
    onCreate: async (sandbox) => {
      await ensureCodex(sandbox);
    },
    onResume: async (sandbox) => {
      await ensureCodex(sandbox);
    },
  });
}
