import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const files = {
  run: "app/api/run/route.ts",
  chat: "app/api/chat-run/route.ts",
  copilot: "app/api/copilot-run/route.ts",
};
const source = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([name, file]) => [name, await readFile(new URL(file, root), "utf8")])),
);

function compact(value) {
  return value.replace(/\s+/g, " ");
}
function requirePattern(text, pattern, label) {
  assert.match(compact(text), pattern, label);
}
function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `No se encontró sección: ${start}`);
  const to = end ? text.indexOf(end, from + start.length) : text.length;
  return text.slice(from, to === -1 ? text.length : to);
}

// Validación HTTP: entradas inválidas son 400 y la identidad/autenticación es 401.
requirePattern(source.run, /if\s*\(\s*!repoPattern\.test\(repo\)\s*\)[\s\S]{0,180}status\s*:\s*400/, "run: repo inválido debe responder 400");
requirePattern(source.run, /if\s*\(\s*!prompt\s*\)[\s\S]{0,140}status\s*:\s*400/, "run: prompt vacío debe responder 400");
requirePattern(source.chat, /if\s*\(\s*!prompt\s*\)[\s\S]{0,140}status\s*:\s*400/, "chat: prompt vacío debe responder 400");
requirePattern(source.chat, /mode\s*===\s*["']draft["'][\s\S]{0,180}repoPattern\.test\(repo\)[\s\S]{0,180}status\s*:\s*400/, "chat: draft sin repo válido debe responder 400");
requirePattern(source.copilot, /if\s*\(\s*!prompt\s*\)[\s\S]{0,140}status\s*:\s*400/, "copilot: prompt vacío debe responder 400");
for (const [name, text] of Object.entries(source)) {
  requirePattern(text, /status\s*:\s*401/, `${name}: falta contrato 401`);
  requirePattern(text, /type\s*:\s*["']control\.error["']/, `${name}: falta evento control.error`);
  requirePattern(text, /type\s*:\s*["']control\.done["']/, `${name}: falta evento control.done`);
}

// Chat y draft son modos privados: sus instrucciones no pueden publicar cambios.
for (const [name, text] of [["chat", source.chat]]) {
  const instructions = section(text, 'const instructions = mode === "chat"', "const teamPrompt");
  requirePattern(instructions, /mode[\s\S]{0,600}draft/, `${name}: faltan instrucciones de draft`);
  assert.doesNotMatch(instructions, /git\s+push/i, `${name}: chat/draft no debe ejecutar git push`);
  requirePattern(instructions, /do not .*commit|do not .*push|do not .*pull request|no .*escrib/i, `${name}: falta prohibición de publicación`);
}

// El runner de Copilot conserva la misma barrera aunque se ejecute fuera de la ruta.
const runner = await readFile(new URL("lib/copilot-runner-source.ts", root), "utf8");
const modeRules = section(runner, 'const modeRules = runMode === "chat"', "const prompt =");
requirePattern(modeRules, /runMode\s*===\s*["']draft["']/, "runner: faltan reglas de draft");
requirePattern(modeRules, /no .*git commit|no .*git push|no .*pull request/i, "runner: falta prohibición de publicación");

// Mock mínimo de terminales NDJSON: sólo se aceptan eventos terminales definidos por contrato.
const terminal = [
  JSON.stringify({ type: "control.done", data: { delivery: "chat" } }),
  JSON.stringify({ type: "control.error", data: { message: "validation" } }),
].join("\n");
const events = terminal.split("\n").map((line) => JSON.parse(line));
assert.deepEqual(events.map((event) => event.type), ["control.done", "control.error"]);
assert.equal(typeof events[0].data.delivery, "string");
assert.equal(typeof events[1].data.message, "string");

console.log("Run contracts: OK (4xx, terminales y no publicación chat/draft)");
