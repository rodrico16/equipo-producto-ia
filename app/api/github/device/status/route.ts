import {
  clearGitHubDeviceRequest,
  readGitHubDeviceRequest,
  writeGitHubDeviceSession,
} from "@/lib/github-device-auth";

export const runtime = "nodejs";

export async function GET() {
  const pending = await readGitHubDeviceRequest();
  if (!pending) return Response.json({ status: "disconnected" });
  if (pending.expiresAt <= Date.now()) {
    await clearGitHubDeviceRequest();
    return Response.json({ status: "expired", error: "El código de GitHub expiró." });
  }

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: pending.clientId,
      device_code: pending.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
    cache: "no-store",
  });
  const data = (await response.json()) as {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (data.error === "authorization_pending" || data.error === "slow_down") {
    return Response.json({
      status: "pending",
      interval: data.error === "slow_down" ? pending.interval + 5 : pending.interval,
    });
  }

  if (data.error) {
    if (data.error === "expired_token" || data.error === "access_denied") {
      await clearGitHubDeviceRequest();
    }
    return Response.json({
      status: data.error === "expired_token" ? "expired" : "failed",
      error: data.error_description || data.error,
    });
  }

  if (!response.ok || !data.access_token) {
    return Response.json({ status: "failed", error: `GitHub token exchange failed (${response.status})` }, { status: 502 });
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${data.access_token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!userResponse.ok) {
    return Response.json({ status: "failed", error: "GitHub autorizó el token pero no pudimos leer tu usuario." }, { status: 502 });
  }

  const user = (await userResponse.json()) as { login: string; avatar_url?: string | null };
  await writeGitHubDeviceSession(data.access_token, {
    login: user.login,
    avatarUrl: user.avatar_url ?? null,
  });
  await clearGitHubDeviceRequest();

  return Response.json({
    status: "connected",
    user: { login: user.login, avatarUrl: user.avatar_url ?? null },
  });
}
