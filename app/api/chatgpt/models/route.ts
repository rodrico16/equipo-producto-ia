import { requireControlRoomIdentity } from "@/lib/server-auth";
import { clearCodexAuth, readCodexAuth } from "@/lib/chatgpt-auth-cookie";
import { runCodexRpcWithAuth } from "@/lib/chatgpt-codex";

export const runtime = "nodejs";
export const maxDuration = 90;

type CodexModel = {
  id?: string;
  model?: string;
  displayName?: string;
  isDefault?: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{ reasoningEffort?: string; description?: string }>;
};

function isAuthError(message: string) {
  const value = message.toLowerCase();
  return [
    "401",
    "unauthorized",
    "authentication",
    "not authenticated",
    "not logged in",
    "login required",
    "token expired",
    "expired token",
    "refresh token",
  ].some((needle) => value.includes(needle));
}

export async function GET() {
  try {
    await requireControlRoomIdentity();
    const authJson = await readCodexAuth();
    if (!authJson) return Response.json({ error: "ChatGPT no está conectado", models: [] }, { status: 401 });

    const result = await runCodexRpcWithAuth(authJson, "models");
    const data = Array.isArray(result.data) ? (result.data as CodexModel[]) : [];
    const models = data
      .map((item) => ({
        id: item.id || item.model || "",
        name: item.displayName || item.model || item.id || "Model",
        isDefault: Boolean(item.isDefault),
        defaultReasoningEffort: item.defaultReasoningEffort || null,
        reasoningEfforts: Array.isArray(item.supportedReasoningEfforts)
          ? item.supportedReasoningEfforts
              .map((effort) => ({ id: effort.reasoningEffort || "", description: effort.description || "" }))
              .filter((effort) => effort.id)
          : [],
      }))
      .filter((item) => item.id);

    return Response.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isAuthError(message)) {
      await clearCodexAuth();
      return Response.json({ error: "La sesión de ChatGPT venció. Reconectá tu cuenta para continuar.", models: [], authExpired: true }, { status: 401 });
    }
    return Response.json({ error: message, models: [] }, { status: message === "SESSION_REQUIRED" ? 401 : 502 });
  }
}
