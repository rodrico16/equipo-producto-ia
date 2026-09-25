import { cookies } from "next/headers";

const QWEN_API_KEY_COOKIE = "epia_qwen_api_key";
const QWEN_ACCOUNT_COOKIE = "epia_qwen_account";

const secureCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};

export type StoredQwenAccount = {
  workspaceId?: string | null;
  email?: string | null;
  planType?: string | null;
};

export async function writeQwenAuth(apiKey: string, account: StoredQwenAccount = {}) {
  const store = await cookies();
  store.set(QWEN_API_KEY_COOKIE, apiKey, { ...secureCookie, maxAge: 60 * 60 * 24 * 30 });
  store.set(QWEN_ACCOUNT_COOKIE, Buffer.from(JSON.stringify(account)).toString("base64url"), {
    ...secureCookie,
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function readQwenAuth(): Promise<string | null> {
  const store = await cookies();
  return store.get(QWEN_API_KEY_COOKIE)?.value || null;
}

export async function readQwenAccount(): Promise<StoredQwenAccount | null> {
  const value = (await cookies()).get(QWEN_ACCOUNT_COOKIE)?.value;
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as StoredQwenAccount;
  } catch {
    return null;
  }
}

export async function clearQwenAuth() {
  const store = await cookies();
  store.set(QWEN_API_KEY_COOKIE, "", { ...secureCookie, maxAge: 0 });
  store.set(QWEN_ACCOUNT_COOKIE, "", { ...secureCookie, maxAge: 0 });
}

export async function requireQwenAuth() {
  const apiKey = await readQwenAuth();
  if (!apiKey) throw new Error("QWEN_REQUIRED");
  return apiKey;
}
