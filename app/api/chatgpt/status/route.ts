import { requireControlRoomIdentity } from "@/lib/server-auth";
import { readChatGPTLoginState, runCodexRpc } from "@/lib/chatgpt-codex";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const identity = await requireControlRoomIdentity();
    const state = await readChatGPTLoginState(identity.key);

    if (state.status === "pending") return Response.json(state);

    try {
      const account = await runCodexRpc(identity.key, "account-read");
      const value = (account.account ?? null) as null | { type?: string; planType?: string; email?: string | null };
      if (value) {
        return Response.json({
          status: "connected",
          planType: value.planType ?? state.planType ?? null,
          accountType: value.type ?? "chatgpt",
          email: value.email ?? null,
        });
      }
    } catch {}

    return Response.json(state.status === "connected" ? { status: "disconnected" } : state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message === "SESSION_REQUIRED" ? 401 : 500 });
  }
}
