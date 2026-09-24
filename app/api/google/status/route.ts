import { requireControlRoomIdentity } from "@/lib/server-auth";
import { readGoogleAuth, refreshGoogleAuth } from "@/lib/google-auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireControlRoomIdentity();
    const auth = await readGoogleAuth();
    if (!auth) return Response.json({ status: "disconnected" });
    const fresh = await refreshGoogleAuth(auth);
    if (!fresh) return Response.json({ status: "expired" });
    return Response.json({
      status: "connected",
      email: fresh.email ?? null,
      name: fresh.name ?? null,
      picture: fresh.picture ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message === "SESSION_REQUIRED" ? 401 : 500 });
  }
}
