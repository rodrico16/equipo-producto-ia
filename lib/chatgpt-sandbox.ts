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

type ForkOptions = Parameters<typeof Sandbox.fork>[0];
type HardenedGlobal = typeof globalThis & { __epiaChatGPTForkHardened?: boolean };

const PRIVATE_AUTH_SANDBOX = "chatgpt-codex-private";
const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

const hardenedGlobal = globalThis as HardenedGlobal;
if (!hardenedGlobal.__epiaChatGPTForkHardened) {
  const originalFork = Sandbox.fork.bind(Sandbox);
  Sandbox.fork = (async (options: ForkOptions) => {
    if (
      typeof options.sourceSandbox === "string" &&
      options.sourceSandbox.startsWith("chatgpt-codex-")
    ) {
      return originalFork({ ...options, persistent: false, networkPolicy: CHATGPT_WORKER_NETWORK_POLICY });
    }
    return originalFork(options);
  }) as typeof Sandbox.fork;
  hardenedGlobal.__epiaChatGPTForkHardened = true;
}

// The deployment is protected by Vercel Authentication and is intentionally
// single-user. Reusing one named auth sandbox avoids creating one persistent
// snapshot chain per browser/chat identity.
export function chatGPTSandboxName(_identity?: string) {
  return PRIVATE_AUTH_SANDBOX;
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
  await sandbox.update({
    networkPolicy: CHATGPT_AUTH_NETWORK_POLICY,
    persistent: true,
    snapshotExpiration: ONE_WEEK,
    keepLastSnapshots: { count: 1 },
  });
}

export async function getChatGPTSandbox(identity?: string) {
  const sandbox = await Sandbox.getOrCreate({
    name: chatGPTSandboxName(identity),
    resume: true,
    snapshotExpiration: ONE_WEEK,
    keepLastSnapshots: { count: 1 },
    onCreate: hardenPersistentSandbox,
    onResume: hardenPersistentSandbox,
  });

  await sandbox.update({
    networkPolicy: CHATGPT_AUTH_NETWORK_POLICY,
    persistent: true,
    snapshotExpiration: ONE_WEEK,
    keepLastSnapshots: { count: 1 },
  });
  return sandbox;
}
