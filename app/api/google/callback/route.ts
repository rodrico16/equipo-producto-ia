import { NextResponse } from "next/server";
import {
  clearGoogleOAuthState,
  googleRedirectUri,
  readGoogleOAuthState,
  writeGoogleAuth,
} from "@/lib/google-auth";

export const runtime = "nodejs";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type UserInfo = {
  email?: string;
  name?: string;
  picture?: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = await readGoogleOAuthState();
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/?google=invalid-state", request.url));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return Response.json({ error: "Google OAuth is not configured" }, { status: 500 });
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: googleRedirectUri(url.origin),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const token = (await tokenResponse.json()) as TokenResponse;
  if (!token.access_token) {
    return NextResponse.redirect(new URL(`/?google=${encodeURIComponent(token.error_description || token.error || "oauth-failed")}`, request.url));
  }

  let profile: UserInfo = {};
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
  });
  if (profileResponse.ok) profile = (await profileResponse.json()) as UserInfo;

  await writeGoogleAuth({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    email: profile.email ?? null,
    name: profile.name ?? null,
    picture: profile.picture ?? null,
  });
  await clearGoogleOAuthState();
  return NextResponse.redirect(new URL("/", request.url));
}
