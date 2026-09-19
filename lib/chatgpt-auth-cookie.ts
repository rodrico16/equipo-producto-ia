import { gzipSync, gunzipSync } from "node:zlib";
import { cookies } from "next/headers";

const AUTH_META = "epia_codex_auth_meta";
const AUTH_CHUNK_PREFIX = "epia_codex_auth_";
const ACCOUNT_COOKIE = "epia_codex_account";
const PENDING_COOKIE = "epia_codex_pending";
const CHUNK_SIZE = 2800;
const MAX_CHUNKS = 8;

const secureCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};

export type StoredCodexAccount = {
  planType?: string | null;
  accountType?: string | null;
  email?: string | null;
};

function encodeAuth(authJson: string) {
  return gzipSync(Buffer.from(authJson, "utf8")).toString("base64url");
}

function decodeAuth(encoded: string) {
  return gunzipSync(Buffer.from(encoded, "base64url")).toString("utf8");
}

export async function writeCodexAuth(authJson: string, account: StoredCodexAccount = {}) {
  const encoded = encodeAuth(authJson);
  const chunks = Array.from({ length: Math.ceil(encoded.length / CHUNK_SIZE) }, (_, index) =>
    encoded.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
  );
  if (!chunks.length || chunks.length > MAX_CHUNKS) {
    throw new Error("ChatGPT credential is too large to store safely in the browser session");
  }

  const store = await cookies();
  for (let index = 0; index < MAX_CHUNKS; index += 1) {
    if (index < chunks.length) {
      store.set(`${AUTH_CHUNK_PREFIX}${index}`, chunks[index], { ...secureCookie, maxAge: 60 * 60 * 24 * 7 });
    } else {
      store.set(`${AUTH_CHUNK_PREFIX}${index}`, "", { ...secureCookie, maxAge: 0 });
    }
  }
  store.set(AUTH_META, String(chunks.length), { ...secureCookie, maxAge: 60 * 60 * 24 * 7 });
  store.set(ACCOUNT_COOKIE, Buffer.from(JSON.stringify(account)).toString("base64url"), {
    ...secureCookie,
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function readCodexAuth() {
  const store = await cookies();
  const count = Number(store.get(AUTH_META)?.value || "0");
  if (!Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) return null;
  let encoded = "";
  for (let index = 0; index < count; index += 1) {
    const chunk = store.get(`${AUTH_CHUNK_PREFIX}${index}`)?.value;
    if (!chunk) return null;
    encoded += chunk;
  }
  try {
    const authJson = decodeAuth(encoded);
    JSON.parse(authJson);
    return authJson;
  } catch {
    return null;
  }
}

export async function readCodexAccount(): Promise<StoredCodexAccount | null> {
  const value = (await cookies()).get(ACCOUNT_COOKIE)?.value;
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as StoredCodexAccount;
  } catch {
    return null;
  }
}

export async function clearCodexAuth() {
  const store = await cookies();
  store.set(AUTH_META, "", { ...secureCookie, maxAge: 0 });
  store.set(ACCOUNT_COOKIE, "", { ...secureCookie, maxAge: 0 });
  for (let index = 0; index < MAX_CHUNKS; index += 1) {
    store.set(`${AUTH_CHUNK_PREFIX}${index}`, "", { ...secureCookie, maxAge: 0 });
  }
}

export async function setPendingCodexSandbox(sandboxId: string) {
  (await cookies()).set(PENDING_COOKIE, sandboxId, { ...secureCookie, maxAge: 60 * 12 });
}

export async function readPendingCodexSandbox() {
  return (await cookies()).get(PENDING_COOKIE)?.value || null;
}

export async function clearPendingCodexSandbox() {
  (await cookies()).set(PENDING_COOKIE, "", { ...secureCookie, maxAge: 0 });
}
