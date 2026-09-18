import { cookies } from "next/headers";
import { decryptSession, sessionCookie } from "@/lib/session";

export async function getGitHubSession() {
  const store = await cookies();
  return decryptSession(store.get(sessionCookie.name)?.value);
}

export async function requireGitHubSession() {
  const session = await getGitHubSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}
