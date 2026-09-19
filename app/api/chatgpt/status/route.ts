import { requireControlRoomIdentity } from "@/lib/server-auth";
import {
  clearPendingCodexSandbox,
  readCodexAccount,
  readCodexAuth,
  readPendingCodexSandbox,
  writeCodexAuth,
} from "@/lib/chatgpt-auth-cookie";
import { readPendingChatGPTLogin, stopPendingChatGPTLogin } from "@/lib/chatgpt-codex";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    await requireControlRoomIdentity();

    const authJson = await readCodexAuth();
    if (authJson) {
      const account = await readCodexAccount();
      return Response.json({
        status: "connected",
        planType: account?.planType ?? null,
        accountType: account?.accountType ?? "chatgpt",
        email: account?.email ?? null,
      });
    }

    const pendingSandboxId = await readPendingCodexSandbox();
    if (!pendingSandboxId) return Response.json({ status: "disconnected" });

    try {
      const result = await readPendingChatGPTLogin(pendingSandboxId);
      const state = result.state;
      if (state.status === "connected" && result.authJson) {
        const account = result.account ?? {};
        await writeCodexAuth(result.authJson, {
          planType: typeof account.planType === "string" ? account.planType : state.planType ?? null,
          accountType: typeof account.type === "string" ? account.type : "chatgpt",
          email: typeof account.email === "string" ? account.email : null,
        });
        await clearPendingCodexSandbox();
        await result.sandbox.stop().catch(() => undefined);
        return Response.json({
          status: "connected",
          planType: typeof account.planType === "string" ? account.planType : state.planType ?? null,
          accountType: typeof account.type === "string" ? account.type : "chatgpt",
          email: typeof account.email === "string" ? account.email : null,
        });
      }

      if (state.status === "failed" || state.status === "expired") {
        await clearPendingCodexSandbox();
        await result.sandbox.stop().catch(() => undefined);
      }
      return Response.json(state);
    } catch {
      await stopPendingChatGPTLogin(pendingSandboxId);
      await clearPendingCodexSandbox();
      return Response.json({ status: "disconnected" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message === "SESSION_REQUIRED" ? 401 : 500 });
  }
}
