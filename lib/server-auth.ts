import { cookies } from "next/headers";
import { decryptSession, sessionCookie } from "@/lib/session";
import { guestIdentityKey, guestSessionCookie } from "@/lib/guest-session";

export async function getGitHubSession() {
  const store = await cookies();
  return decryptSession(store.get(sessionCookie.name)?.value);
}

export async function requireGitHubSession() {
  const session = await getGitHubSession();
  if (!session) throw new Error("GITHUB_REQUIRED");
  return session;
}

export async function getControlRoomIdentity() {
  const store = await cookies();
  const guestId = store.get(guestSessionCookie.name)?.value;
  if (guestId) {
    return { key: guestIdentityKey(guestId), mode: "guest" as const };
  }

  const github = decryptSession(store.get(sessionCookie.name)?.value);
  if (github) {
    return { key: `github:${github.login}`, mode: "github" as const };
  }

  return null;
}

export async function requireControlRoomIdentity() {
  const identity = await getControlRoomIdentity();
  if (!identity) throw new Error("SESSION_REQUIRED");
  return identity;
}
