import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");

if (!existsSync(tsc)) {
  console.warn("TypeScript is not installed in this workspace; skipping typecheck.");
  console.warn("Run npm install before relying on npm run typecheck for compiler validation.");
  process.exit(0);
}

const result = spawnSync(process.execPath, [tsc, "--noEmit"], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
