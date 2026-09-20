import { NextResponse } from "next/server";
import { getGitHubSession } from "@/lib/server-auth";
import { clearGitHubDeviceSession } from "@/lib/github-device-auth";
import { guestSessionCookie, newGuestId } from "@/lib/guest-session";
import { sessionCookie } from "@/lib/session";
import { cookies } from "next/headers";

async function validateGitHubToken(token: string) {
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    if (response.status === 401) return "expired" as const;
    if (response.ok) return "valid" as const;
    return "unknown" as const;
  } catch {
    return "unknown" as const;
  }
}

export async function GET() {
  const store = await cookies();
  let github = await getGitHubSession();
  let githubAuthExpired = false;

  if (github) {
    const validity = await validateGitHubToken(github.token);
    if (validity === "expired") {
      githubAuthExpired = true;
      github = null;
      await clearGitHubDeviceSession();
      store.set(sessionCookie.name, "", { ...sessionCookie.options, maxAge: 0 });
    }
  }

  const existingGuestId = store.get(guestSessionCookie.name)?.value;
  const response = NextResponse.json({
    authenticated: true,
    mode: github ? "github" : "guest",
    githubConnected: Boolean(github),
    githubAuthExpired,
    githubConfigured: true,
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
