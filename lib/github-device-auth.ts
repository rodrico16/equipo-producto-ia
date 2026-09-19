import { cookies } from "next/headers";

const TOKEN_COOKIE = "epia_github_token";
const USER_COOKIE = "epia_github_user";
const CLIENT_COOKIE = "epia_github_client_id";
const DEVICE_COOKIE = "epia_github_device";

const secureHttpOnly = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};

export type GitHubDeviceUser = {
  login: string;
  avatarUrl?: string | null;
};

export async function readGitHubDeviceSession() {
  const store = await cookies();
  const token = store.get(TOKEN_COOKIE)?.value;
  const userValue = store.get(USER_COOKIE)?.value;
  if (!token || !userValue) return null;
  try {
    const user = JSON.parse(Buffer.from(userValue, "base64url").toString("utf8")) as GitHubDeviceUser;
    if (!user.login) return null;
    return { token, login: user.login, avatarUrl: user.avatarUrl ?? undefined, exp: Date.now() + 24 * 60 * 60 * 1000 };
  } catch {
    return null;
  }
}

export async function writeGitHubDeviceSession(token: string, user: GitHubDeviceUser) {
  const store = await cookies();
  store.set(TOKEN_COOKIE, token, { ...secureHttpOnly, maxAge: 60 * 60 * 24 * 30 });
  store.set(USER_COOKIE, Buffer.from(JSON.stringify(user)).toString("base64url"), {
    ...secureHttpOnly,
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearGitHubDeviceSession() {
  const store = await cookies();
  store.set(TOKEN_COOKIE, "", { ...secureHttpOnly, maxAge: 0 });
  store.set(USER_COOKIE, "", { ...secureHttpOnly, maxAge: 0 });
  store.set(DEVICE_COOKIE, "", { ...secureHttpOnly, maxAge: 0 });
}

export async function storeGitHubClientId(clientId: string) {
  (await cookies()).set(CLIENT_COOKIE, clientId, { ...secureHttpOnly, maxAge: 60 * 60 * 24 * 365 });
}

export async function readGitHubClientId() {
  return (await cookies()).get(CLIENT_COOKIE)?.value || null;
}

export async function storeGitHubDeviceRequest(value: { deviceCode: string; clientId: string; interval: number; expiresAt: number }) {
  (await cookies()).set(DEVICE_COOKIE, Buffer.from(JSON.stringify(value)).toString("base64url"), {
    ...secureHttpOnly,
    maxAge: Math.max(60, Math.floor((value.expiresAt - Date.now()) / 1000)),
  });
}

export async function readGitHubDeviceRequest() {
  const value = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      deviceCode: string;
      clientId: string;
      interval: number;
      expiresAt: number;
    };
  } catch {
    return null;
  }
}

export async function clearGitHubDeviceRequest() {
  (await cookies()).set(DEVICE_COOKIE, "", { ...secureHttpOnly, maxAge: 0 });
}
