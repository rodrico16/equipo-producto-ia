import { requireControlRoomIdentity } from "@/lib/server-auth";
import { clearGoogleAuth, clearGoogleOAuthState } from "@/lib/google-auth";

export const runtime = "nodejs";

export async function POST() {
  try {
    await requireControlRoomIdentity();
    await clearGoogleOAuthState();
    await clearGoogleAuth();
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message === "SESSION_REQUIRED" ? 401 : 500 });
  }
}
