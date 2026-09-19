import { requireControlRoomIdentity } from "@/lib/server-auth";
import {
  clearCodexAuth,
  clearPendingCodexSandbox,
  readPendingCodexSandbox,
} from "@/lib/chatgpt-auth-cookie";
import { stopPendingChatGPTLogin } from "@/lib/chatgpt-codex";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST() {
  try {
    await requireControlRoomIdentity();
    const pending = await readPendingCodexSandbox();
    if (pending) await stopPendingChatGPTLogin(pending);
    await clearPendingCodexSandbox();
    await clearCodexAuth();
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message === "SESSION_REQUIRED" ? 401 : 500 });
  }
}
