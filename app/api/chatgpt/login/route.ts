import { requireControlRoomIdentity } from "@/lib/server-auth";
import { clearCodexAuth, clearPendingCodexSandbox, setPendingCodexSandbox } from "@/lib/chatgpt-auth-cookie";
import { startChatGPTDeviceLogin } from "@/lib/chatgpt-codex";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    await requireControlRoomIdentity();
    await clearCodexAuth();
    await clearPendingCodexSandbox();
    const { state, sandboxId } = await startChatGPTDeviceLogin();
    await setPendingCodexSandbox(sandboxId);
    return Response.json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message === "SESSION_REQUIRED" ? 401 : 500 });
  }
}
