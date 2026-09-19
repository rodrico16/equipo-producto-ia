import crypto from "node:crypto";
import { cookies } from "next/headers";

const APP_COOKIE = "epia_github_app";
const MANIFEST_STATE_COOKIE = "epia_github_manifest_state";

const secureCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export type GitHubAppConfig = {
  clientId: string;
  clientSecret: string;
  slug: string;
};

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode<T>(value?: string) {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function readGitHubAppConfig() {
  const value = (await cookies()).get(APP_COOKIE)?.value;
  const config = decode<GitHubAppConfig>(value);
  if (!config?.clientId || !config.clientSecret || !config.slug) return null;
  return config;
}

export async function writeGitHubAppConfig(config: GitHubAppConfig) {
  (await cookies()).set(APP_COOKIE, encode(config), {
    ...secureCookie,
    maxAge: 60 * 60 * 24 * 90,
  });
}

export async function createManifestState() {
  const state = crypto.randomBytes(24).toString("base64url");
  (await cookies()).set(MANIFEST_STATE_COOKIE, state, {
    ...secureCookie,
    maxAge: 10 * 60,
  });
  return state;
}

export async function consumeManifestState(received: string | null) {
  const store = await cookies();
  const expected = store.get(MANIFEST_STATE_COOKIE)?.value;
  store.set(MANIFEST_STATE_COOKIE, "", { ...secureCookie, maxAge: 0 });
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}
