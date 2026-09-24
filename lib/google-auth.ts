import crypto from "node:crypto";
import { cookies } from "next/headers";

const GOOGLE_AUTH_COOKIE = "epia_google_auth";
const GOOGLE_STATE_COOKIE = "epia_google_oauth_state";
export const GOOGLE_GEMINI_SCOPE = "https://www.googleapis.com/auth/generative-language.retriever";
const GOOGLE_USER_SCOPES = "openid email profile";

const secureCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export type GoogleAuth = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  email?: string | null;
  name?: string | null;
  picture?: string | null;
};

function getKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be configured with at least 32 characters");
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(payload: GoogleAuth) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

function decrypt(value?: string | null): GoogleAuth | null {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")) as GoogleAuth;
  } catch {
    return null;
  }
}

export function googleOAuthScopes() {
  return `${GOOGLE_GEMINI_SCOPE} ${GOOGLE_USER_SCOPES}`;
}

export function googleRedirectUri(origin: string) {
  return `${origin}/api/google/callback`;
}

export function googleProjectId() {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_PROJECT_ID || process.env.GCLOUD_PROJECT || "";
}

export async function setGoogleOAuthState(state: string) {
  (await cookies()).set(GOOGLE_STATE_COOKIE, state, { ...secureCookie, maxAge: 60 * 10 });
}

export async function readGoogleOAuthState() {
  return (await cookies()).get(GOOGLE_STATE_COOKIE)?.value || null;
}

export async function clearGoogleOAuthState() {
  (await cookies()).set(GOOGLE_STATE_COOKIE, "", { ...secureCookie, maxAge: 0 });
}

export async function writeGoogleAuth(auth: GoogleAuth) {
  (await cookies()).set(GOOGLE_AUTH_COOKIE, encrypt(auth), { ...secureCookie, maxAge: 60 * 60 * 24 * 14 });
}

export async function readGoogleAuth() {
  return decrypt((await cookies()).get(GOOGLE_AUTH_COOKIE)?.value);
}

export async function clearGoogleAuth() {
  (await cookies()).set(GOOGLE_AUTH_COOKIE, "", { ...secureCookie, maxAge: 0 });
}

export async function refreshGoogleAuth(auth: GoogleAuth) {
  if (auth.expiresAt > Date.now() + 60_000) return auth;
  if (!auth.refreshToken) return null;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: auth.refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "No se pudo refrescar Google.");
  const next = { ...auth, accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  await writeGoogleAuth(next);
  return next;
}

export async function requireFreshGoogleAuth() {
  const auth = await readGoogleAuth();
  if (!auth) throw new Error("GOOGLE_REQUIRED");
  const fresh = await refreshGoogleAuth(auth);
  if (!fresh) throw new Error("GOOGLE_REQUIRED");
  return fresh;
}
