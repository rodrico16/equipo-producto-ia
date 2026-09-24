import { NextResponse } from "next/server";
import { requireControlRoomIdentity } from "@/lib/server-auth";
import { googleOAuthScopes, googleRedirectUri, setGoogleOAuthState } from "@/lib/google-auth";
import { randomOAuthState } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireControlRoomIdentity();
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return Response.json({ error: "Google OAuth is not configured" }, { status: 500 });

    const url = new URL(request.url);
    const state = randomOAuthState();
    await setGoogleOAuthState(state);

    const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", googleRedirectUri(url.origin));
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", googleOAuthScopes());
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("access_type", "offline");
    authorize.searchParams.set("prompt", "consent");
    authorize.searchParams.set("include_granted_scopes", "true");
    return NextResponse.json({ url: authorize.toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message === "SESSION_REQUIRED" ? 401 : 500 });
  }
}
