import type { Sandbox } from "@vercel/sandbox";

export type RunAttachment = { name: string; type: string; data: string };

const MAX_FILES = 4;
const MAX_BYTES = 2_500_000;
const MAX_TOTAL = 3_000_000;
const supported = new Set(["png", "jpg", "jpeg", "webp", "gif", "pdf", "txt", "md", "csv", "json", "xml", "html", "docx", "xlsx", "zip"]);

export function validateAttachments(value: unknown): RunAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_FILES) throw new Error("Podés adjuntar hasta 4 archivos por mensaje.");
  let total = 0;
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Adjunto inválido.");
    const { name, type, data } = item as Record<string, unknown>;
    if (typeof name !== "string" || !name || name.length > 160 || typeof type !== "string" || typeof data !== "string") throw new Error("Adjunto inválido.");
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (!supported.has(ext)) throw new Error(`Formato no admitido: ${name}`);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) throw new Error(`Archivo inválido: ${name}`);
    const bytes = Buffer.from(data, "base64");
    if (!bytes.length || bytes.length > MAX_BYTES) throw new Error(`${name} supera el límite de 2,5 MB.`);
    total += bytes.length;
    if (total > MAX_TOTAL) throw new Error("Los adjuntos superan el límite total de 3 MB.");
    return { name, type, data };
  });
}

export async function writeRunAttachments(sandbox: Sandbox, attachments: RunAttachment[], runId: string) {
  if (!attachments.length) return { context: "", images: [] as string[] };
  const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "run";
  const directory = `/tmp/control-room-attachments/${safeRunId}`;
  const created = await sandbox.runCommand("mkdir", ["-p", directory]);
  if (created.exitCode !== 0) throw new Error("No se pudo preparar el directorio de adjuntos.");
  const files = attachments.map((file, index) => {
    const ext = file.name.split(".").pop()!.toLowerCase();
    return { path: `${directory}/${index + 1}.${ext}`, content: Buffer.from(file.data, "base64"), name: file.name, image: ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) };
  });
  await sandbox.writeFiles(files.map(({ path, content }) => ({ path, content })));
  return {
    context: `ARCHIVOS ADJUNTOS DEL MENSAJE ACTUAL (solo lectura; no incluirlos en commits):\n${files.map((file) => `- ${JSON.stringify(file.name)}: ${file.path}`).join("\n")}\nAbrí y analizá estos archivos para responder el pedido.`,
    images: files.filter((file) => file.image).map((file) => file.path),
  };
}
