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

} finally {
  await rm(dir, { recursive: true, force: true });
}
