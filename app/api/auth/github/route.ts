import { NextResponse } from "next/server";
import { oauthStateCookie, randomOAuthState } from "@/lib/session";

export async function GET(request: Request) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "GITHUB_CLIENT_ID is not configured" }, { status: 500 });
  }

  const state = randomOAuthState();
  const callback = new URL("/api/auth/callback", request.url);
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", callback.toString());
  authorize.searchParams.set("scope", "repo read:user read:org");
  authorize.searchParams.set("state", state);

  const response = NextResponse.redirect(authorize);
  response.cookies.set(oauthStateCookie.name, state, oauthStateCookie.options);
  return response;
}
