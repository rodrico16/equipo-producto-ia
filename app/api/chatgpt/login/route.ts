import { requireControlRoomIdentity } from "@/lib/server-auth";
import { startChatGPTDeviceLogin } from "@/lib/chatgpt-codex";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const identity = await requireControlRoomIdentity();
    const state = await startChatGPTDeviceLogin(identity.key);
    return Response.json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message === "SESSION_REQUIRED" ? 401 : 500 });
  }
}
