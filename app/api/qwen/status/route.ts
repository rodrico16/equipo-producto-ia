import { qwenConfigured, QWEN_MODELS } from "@/lib/codex-provider";

export const runtime = "nodejs";

export function GET() {
  return Response.json({
    status: qwenConfigured() ? "connected" : "disconnected",
    models: QWEN_MODELS,
  });
}
