import { requireGitHubSession } from "@/lib/server-auth";
import { startChatGPTDeviceLogin } from "@/lib/chatgpt-codex";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const auth = await requireGitHubSession();
    const state = await startChatGPTDeviceLogin(auth.login);
    return Response.json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
