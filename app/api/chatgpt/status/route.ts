import { requireControlRoomIdentity } from "@/lib/server-auth";
import {
  readChatGPTLoginState,
  runCodexRpc,
  stopChatGPTSandbox,
} from "@/lib/chatgpt-codex";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const identity = await requireControlRoomIdentity();
    const state = await readChatGPTLoginState(identity.key);
    const wasPending = state.status === "pending";

    // Never trust the local pending marker as the only source of truth. The
    // app-server notification that completes device auth can be lost if the
    // sandbox/process is resumed. account/read lets us recover from that case.
    try {
      const account = await runCodexRpc(identity.key, "account-read", {
        keepSandboxAlive: wasPending,
      });
      const value = (account.account ?? null) as null | {
        type?: string;
        planType?: string;
        email?: string | null;
      };
      if (value) {
        if (wasPending) await stopChatGPTSandbox(identity.key);
        return Response.json({
          status: "connected",
          planType: value.planType ?? state.planType ?? null,
          accountType: value.type ?? "chatgpt",
          email: value.email ?? null,
        });
      }
    } catch {
      // While device auth is still genuinely pending, account/read can fail.
      // Preserve the pending/device-code state and keep its sandbox alive.
    }

    return Response.json(state.status === "connected" ? { status: "disconnected" } : state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message === "SESSION_REQUIRED" ? 401 : 500 });
  }
}
