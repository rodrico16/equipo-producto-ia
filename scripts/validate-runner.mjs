import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sources = [
  ["lib/copilot-runner-source.ts", "main runner"],
  ["lib/copilot-models-runner-source.ts", "model discovery runner"],
];

const dir = await mkdtemp(path.join(tmpdir(), "copilot-runners-"));
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
    console.log(`Embedded Copilot ${label} syntax: OK`);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
