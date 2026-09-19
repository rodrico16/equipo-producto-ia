import { clearGitHubDeviceSession, clearGitHubDeviceRequest } from "@/lib/github-device-auth";
import { sessionCookie } from "@/lib/session";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function POST() {
  await clearGitHubDeviceRequest();
  await clearGitHubDeviceSession();
  const store = await cookies();
  store.set(sessionCookie.name, "", { ...sessionCookie.options, maxAge: 0 });
  return Response.json({ ok: true });
}
