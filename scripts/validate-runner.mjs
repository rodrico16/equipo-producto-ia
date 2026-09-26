import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sources = [
  ["lib/copilot-runner-source.ts", "Copilot main runner"],
  ["lib/copilot-models-runner-source.ts", "Copilot model discovery runner"],
  ["lib/codex-rpc-source.ts", "Codex RPC runner"],
];

const dir = await mkdtemp(path.join(tmpdir(), "control-room-runners-"));
try {
  for (const [sourcePath, label] of sources) {
    const wrapper = await readFile(sourcePath, "utf8");
    const match = wrapper.match(/String\.raw`([\s\S]*)`;\s*$/);
    if (!match) throw new Error(`Could not extract String.raw source from ${sourcePath}`);

    const file = path.join(dir, path.basename(sourcePath, ".ts") + ".mjs");
    await writeFile(file, match[1], "utf8");
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.stdout);
      process.exit(result.status ?? 1);
    }
    console.log(`Embedded ${label} syntax: OK`);
  }

  const sandboxSource = await readFile("lib/chatgpt-sandbox.ts", "utf8");
  const installer = sandboxSource.match(/async function ensureBubblewrapInstalled\(sandbox: Sandbox\) \{([\s\S]*?)\n\}/);
  if (!installer) throw new Error("Vercel Sandbox bubblewrap installer is missing");
  for (const required of [
    "dnf install -y bubblewrap",
    "microdnf install -y bubblewrap",
    "yum install -y bubblewrap",
    "apt-get update -qq",
    "apt-get install -y bubblewrap",
    "apk add --no-cache bubblewrap",
    "no supported package manager is available",
    "command -v bwrap",
    "Could not provision bubblewrap in Vercel Sandbox",
    "cdn.amazonlinux.com",
    "archive.ubuntu.com",
    "deb.debian.org",
    "dl-cdn.alpinelinux.org",
    "al2023-repos-us-east-1-de612dc2.s3.dualstack.us-east-1.amazonaws.com",
  ]) {
    if (!sandboxSource.includes(required)) throw new Error(`Bubblewrap installer is missing: ${required}`);
  }
  const workerSetup = sandboxSource.indexOf("await ensureBubblewrapInstalled(sandbox);");
  const bwrapCheck = sandboxSource.indexOf("await ensureCodexSandbox(sandbox);", workerSetup);
  if (workerSetup < 0 || bwrapCheck < 0) throw new Error("Bubblewrap must be installed before the Codex preflight");

  const installerScript = sandboxSource.match(/const installScript = String\.raw`([\\s\\S]*?)`;/);
  if (!installerScript) throw new Error("Bubblewrap installer shell script is missing");
  const installerFile = path.join(dir, "install-bubblewrap.sh");
  await writeFile(installerFile, installerScript[1], "utf8");
  const installerCheck = spawnSync("bash", ["-n", installerFile], { encoding: "utf8" });
  if (installerCheck.status !== 0) {
    process.stderr.write(installerCheck.stderr || installerCheck.stdout);
    process.exit(installerCheck.status ?? 1);
  }
  console.log("Bubblewrap installer shell syntax: OK");

  const preflight = sandboxSource.match(/export const CODEX_BWRAP_PREFLIGHT = String\.raw`([\s\S]*?)`;/);
  if (!preflight) throw new Error("Codex bwrap preflight is missing");
  for (const required of [
    "Unexpected capabilities but not setuid",
    "setcap -r",
    "--ro-bind / / true",
    "Operation not permitted",
    "No unsandboxed fallback was started",
  ]) {
    if (!preflight[1].includes(required)) throw new Error(`Codex bwrap preflight is missing guardrail: ${required}`);
  }
  const preflightFile = path.join(dir, "codex-bwrap-preflight.sh");
  await writeFile(preflightFile, preflight[1], "utf8");
  const shellCheck = spawnSync("bash", ["-n", preflightFile], { encoding: "utf8" });
  if (shellCheck.status !== 0) {
    process.stderr.write(shellCheck.stderr || shellCheck.stdout);
    process.exit(shellCheck.status ?? 1);
  }
  console.log("Codex bwrap preflight syntax and guardrails: OK");

  const codexSource = await readFile("lib/chatgpt-codex.ts", "utf8");
  if (!codexSource.includes("createChatGPTRpcSandbox(authJson)")) {
    throw new Error("Codex model/account RPC must not depend on the execution worker sandbox");
  }
  if (codexSource.includes("createChatGPTWorkerSandbox(authJson, 90_000)")) {
    throw new Error("Codex RPC still starts the full execution worker");
  }
  console.log("Codex model/account RPC isolation: OK");

} finally {
  await rm(dir, { recursive: true, force: true });
}
