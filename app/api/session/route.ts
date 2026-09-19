import { NextResponse } from "next/server";
import { getGitHubSession } from "@/lib/server-auth";
import { guestSessionCookie, newGuestId } from "@/lib/guest-session";
import { readGitHubClientId } from "@/lib/github-device-auth";
import { cookies } from "next/headers";

export async function GET() {
  const store = await cookies();
  const github = await getGitHubSession();
  const existingGuestId = store.get(guestSessionCookie.name)?.value;
  const rememberedClientId = await readGitHubClientId();

  const response = NextResponse.json({
    authenticated: true,
    mode: github ? "github" : "guest",
    githubConnected: Boolean(github),
    githubConfigured: Boolean(process.env.GITHUB_CLIENT_ID || rememberedClientId),
    githubDeviceFlow: true,
    user: github
      ? { login: github.login, avatarUrl: github.avatarUrl ?? null }
      : { login: "invitado", avatarUrl: null },
  });

  if (!existingGuestId) {
    response.cookies.set(guestSessionCookie.name, newGuestId(), guestSessionCookie.options);
  }

  return response;
}
