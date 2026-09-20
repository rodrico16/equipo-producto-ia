import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sandboxSource = await readFile(new URL("../lib/chatgpt-sandbox.ts", import.meta.url), "utf8");
const chatRoute = await readFile(new URL("../app/api/chat-run/route.ts", import.meta.url), "utf8");
const prRoute = await readFile(new URL("../app/api/run/route.ts", import.meta.url), "utf8");

assert.match(sandboxSource, /type:\s*"rollout\.assignment"/);
assert.match(sandboxSource, /assignment:\s*clean/);
assert.match(sandboxSource, /emitAssignment\(spawnEvent\.name, spawnEvent\.callId, spawnEvent\.assignment\)/);

for (const route of [chatRoute, prRoute]) {
  assert.match(route, /type === "rollout\.assignment"/);
  assert.match(route, /toolName:\s*"task"/);
  assert.match(route, /agent_type:/);
  assert.match(route, /prompt:\s*assignment/);
}

console.log("Codex assignment bridge contract OK");
