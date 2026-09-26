import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const hasTypeScriptDependency = Boolean(
  packageJson.dependencies?.typescript || packageJson.devDependencies?.typescript,
);

if (!hasTypeScriptDependency) {
  console.error("Typecheck requires the typescript package to be declared in package.json.");
  process.exit(1);
}

const tsc = new URL("../node_modules/typescript/bin/tsc", import.meta.url);

try {
  await access(tsc, constants.R_OK);
} catch {
  console.warn("TypeScript compiler not installed in this workspace; skipping typecheck.");
  console.warn("Run npm install to enable npm run typecheck locally.");
  process.exit(0);
}

const result = spawnSync(process.execPath, [fileURLToPath(tsc), "--noEmit"], {
  encoding: "utf8",
  stdio: "inherit",
});

process.exit(result.status ?? 1);
