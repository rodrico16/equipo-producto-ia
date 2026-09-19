import {
  readGitHubClientId,
  storeGitHubClientId,
  storeGitHubDeviceRequest,
} from "@/lib/github-device-auth";

export const runtime = "nodejs";

type StartBody = { clientId?: string };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as StartBody;
  const supplied = body.clientId?.trim();
  const stored = await readGitHubClientId();
  const clientId = supplied || stored || process.env.GITHUB_CLIENT_ID || "";

  if (!clientId) {
    return Response.json(
      {
        error: "GitHub necesita un Client ID público una sola vez para Device Flow.",
        needsClientId: true,
      },
      { status: 428 },
    );
  }

  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: "repo read:user read:org",
    }),
    cache: "no-store",
  });
  const data = (await response.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.device_code || !data.user_code || !data.verification_uri) {
    return Response.json(
      { error: data.error_description || data.error || `GitHub device login failed (${response.status})` },
      { status: 502 },
    );
  }

  const interval = Math.max(5, data.interval || 5);
  const expiresIn = Math.max(60, data.expires_in || 900);
  await storeGitHubClientId(clientId);
  await storeGitHubDeviceRequest({
    deviceCode: data.device_code,
    clientId,
    interval,
    expiresAt: Date.now() + expiresIn * 1000,
  });

  return Response.json({
    status: "pending",
    userCode: data.user_code,
    verificationUrl: data.verification_uri,
    interval,
    expiresIn,
  });
}
