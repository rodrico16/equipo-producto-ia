import { requireControlRoomIdentity } from "@/lib/server-auth";
import { finishRun, getRun, startRun } from "@/lib/run-store";
import { validateAttachments, type RunAttachment } from "@/lib/run-attachments";

export const runtime = "nodejs";
export const maxDuration = 120;

type RunRequest = {
  model?: string;
  prompt?: string;
  agentName?: string;
  attachments?: RunAttachment[];
};

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message?: string };
};

const encoder = new TextEncoder();
const DEFAULT_MODEL = "gemini-2.5-flash";

function line(payload: unknown) {
  return encoder.encode(JSON.stringify(payload) + "\n");
}

function geminiKey() {
  return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
}

function safeModel(model?: string) {
  const value = model?.trim() || DEFAULT_MODEL;
  return /^[A-Za-z0-9_.:-]+$/.test(value) ? value : DEFAULT_MODEL;
}

function responseText(body: GeminiResponse) {
  return body.candidates?.flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();
}

export async function POST(request: Request) {
  const body = (await request.json()) as RunRequest;
  const prompt = body.prompt?.trim();
  const model = safeModel(body.model);
  const agentName = body.agentName?.trim() || "supervisor";
  const apiKey = geminiKey();

  if (!prompt) return Response.json({ error: "Prompt is required" }, { status: 400 });
  if (!apiKey) return Response.json({ error: "Configurá GOOGLE_API_KEY o GEMINI_API_KEY para usar Google AI Studio." }, { status: 401 });

  let attachments: RunAttachment[];
  try { attachments = validateAttachments(body.attachments); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }

  let runOwner = "";
  let runId = request.headers.get("x-run-id") || "";
  try {
    const identity = await requireControlRoomIdentity();
    runOwner = identity.key;
    const existing = runId ? getRun(runId, runOwner) : null;
    if (existing) return Response.json(existing, { status: 409, headers: { "X-Run-Id": existing.id } });
    runId = startRun(runOwner, runId).id;
  } catch {
    return Response.json({ error: "Session required" }, { status: 401 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(line({ type: "run.started", agentId: agentName, data: { provider: "google", model } }));
        controller.enqueue(line({ type: "control.status", agentId: agentName, data: { message: "Consultando Gemini…" } }));

        const systemText = agentName === "supervisor"
          ? [
              "Actuá como Supervisor del equipo de producto e ingeniería.",
              "Respondé en español, con criterio de producto y foco práctico.",
              "Podés coordinar conceptualmente especialistas, pero no digas que editaste archivos, ejecutaste comandos o creaste Pull Requests.",
            ].join("\n")
          : [
              `Actuá como el especialista "${agentName}" dentro del equipo de producto e ingeniería.`,
              "Respondé directo al usuario, en español, y mantené el contexto del Supervisor.",
              "No digas que editaste archivos, ejecutaste comandos o creaste Pull Requests.",
            ].join("\n");
        const parts: GeminiPart[] = [
          { text: `${systemText}\n\nPEDIDO:\n${prompt}` },
          ...attachments.map((file) => ({ inlineData: { mimeType: file.type || "application/octet-stream", data: file.data } })),
        ];

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { temperature: 0.7 },
          }),
        });
        const data = (await response.json().catch(() => ({}))) as GeminiResponse;
        if (!response.ok) throw new Error(data.error?.message || `Gemini API error (${response.status})`);

        const content = responseText(data);
        if (!content) throw new Error(data.candidates?.[0]?.finishReason ? `Gemini terminó sin texto (${data.candidates[0].finishReason}).` : "Gemini no devolvió texto.");

        controller.enqueue(line({ type: "agent.message", agentId: agentName, data: { content, messageId: `google-${Date.now()}` } }));
        finishRun(runId, runOwner);
        controller.enqueue(line({ type: "control.done", agentId: agentName, data: { delivery: agentName === "supervisor" ? "chat" : "agent", provider: "google", message: "Respuesta de Gemini lista." } }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finishRun(runId, runOwner, message);
        controller.enqueue(line({ type: "control.error", agentId: agentName, data: { message } }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Run-Id": runId,
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
