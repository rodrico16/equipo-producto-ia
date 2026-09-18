import { createHash } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";

const AUTH_ALLOWED_DOMAINS = [
  "chatgpt.com",
  "*.chatgpt.com",
  "*.openai.com",
  "github.com",
  "*.github.com",
  "*.githubusercontent.com",
];

const WORKER_ALLOWED_DOMAINS = [
  ...AUTH_ALLOWED_DOMAINS,
  "registry.npmjs.org",
  "*.npmjs.org",
  "registry.yarnpkg.com",
  "pypi.org",
  "files.pythonhosted.org",
];

type SandboxWithNetworkUpdate = Sandbox & {
  updateNetworkPolicy?: (policy: unknown) => Promise<unknown>;
  update?: (options: unknown) => Promise<unknown>;
};

async function restrictNetwork(sandbox: Sandbox, allowedDomains: string[]) {
  const target = sandbox as SandboxWithNetworkUpdate;
  const networkPolicy = { allow: allowedDomains };

  if (typeof target.updateNetworkPolicy === "function") {
    await target.updateNetworkPolicy(networkPolicy);
    return;
  }
  if (typeof target.update === "function") {
    await target.update({ networkPolicy });
    return;
  }
  throw new Error("This Vercel Sandbox SDK does not support runtime network-policy updates");
}

// app/api/run currently calls Sandbox.fork directly. Harden ChatGPT-derived forks
// at the shared SDK boundary so a future caller cannot accidentally re-enable
// unrestricted egress with networkPolicy: "allow-all".
const globalPatchState = globalThis as typeof globalThis & {
  __epiaChatGPTForkHardened?: boolean;
};

if (!globalPatchState.__epiaChatGPTForkHardened) {
  const sandboxApi = Sandbox as unknown as {
    fork: (options: Record<string, unknown>) => Promise<Sandbox>;
  };
  const originalFork = sandboxApi.fork.bind(Sandbox);

  sandboxApi.fork = async (options: Record<string, unknown>) => {
    const sourceSandbox = options.sourceSandbox;
    if (typeof sourceSandbox === "string" && sourceSandbox.startsWith("chatgpt-codex-")) {
      return originalFork({
        ...options,
        networkPolicy: { allow: WORKER_ALLOWED_DOMAINS },
      });
    }
    return originalFork(options);
  };

  globalPatchState.__epiaChatGPTForkHardened = true;
}

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

async function preparePersistentSandbox(sandbox: Sandbox) {
  // Install/update first if necessary, then close egress. The persistent sandbox
  // stores the ChatGPT/Codex credentials and never runs repository-controlled code.
  await ensureCodex(sandbox);
  await restrictNetwork(sandbox, AUTH_ALLOWED_DOMAINS);
}

export async function getChatGPTSandbox(login: string) {
  const sandbox = await Sandbox.getOrCreate({
    name: chatGPTSandboxName(login),
    resume: true,
    onCreate: preparePersistentSandbox,
    onResume: preparePersistentSandbox,
  });

  // getOrCreate may return an already-running named sandbox without invoking a
  // lifecycle callback. Reassert the firewall policy on every access.
  await restrictNetwork(sandbox, AUTH_ALLOWED_DOMAINS);
  return sandbox;
}
