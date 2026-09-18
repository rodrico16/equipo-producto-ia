import { requireControlRoomIdentity } from "@/lib/server-auth";
import { logoutChatGPT } from "@/lib/chatgpt-codex";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const identity = await requireControlRoomIdentity();
    await logoutChatGPT(identity.key);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message === "SESSION_REQUIRED" ? 401 : 500 });
  }
}
