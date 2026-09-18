import { requireGitHubSession } from "@/lib/server-auth";
import { logoutChatGPT } from "@/lib/chatgpt-codex";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const auth = await requireGitHubSession();
    await logoutChatGPT(auth.login);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
