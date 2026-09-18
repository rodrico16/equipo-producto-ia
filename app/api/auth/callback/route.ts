import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  encryptSession,
  oauthStateCookie,
  sessionCookie,
} from "@/lib/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(oauthStateCookie.name)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/?auth=invalid-state", request.url));
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "GitHub OAuth is not configured" }, { status: 500 });
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    cache: "no-store",
  });
  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenData.access_token) {
    return NextResponse.redirect(new URL(`/?auth=${encodeURIComponent(tokenData.error ?? "oauth-failed")}`, request.url));
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!userResponse.ok) {
    return NextResponse.redirect(new URL("/?auth=user-failed", request.url));
  }
  const user = (await userResponse.json()) as { login: string; avatar_url?: string };

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(
    sessionCookie.name,
    encryptSession({
      token: tokenData.access_token,
      login: user.login,
      avatarUrl: user.avatar_url,
      exp: Date.now() + 8 * 60 * 60 * 1000,
    }),
    sessionCookie.options,
  );
  response.cookies.set(oauthStateCookie.name, "", { ...oauthStateCookie.options, maxAge: 0 });
  return response;
}
