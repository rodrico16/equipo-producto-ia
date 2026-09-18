import { CopilotClient } from "@github/copilot-sdk";
import { NextResponse } from "next/server";
import { requireGitHubSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET() {
  let auth;
  try {
    auth = await requireGitHubSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = new CopilotClient({
    gitHubToken: auth.token,
    useLoggedInUser: false,
    mode: "empty",
    logLevel: "error",
  });

  try {
    await client.start();
    const models = await client.listModels();
    return NextResponse.json({
      models: models.map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        policy: model.policy ?? null,
        capabilities: model.capabilities ?? null,
        billing: model.billing ?? null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        models: [{ id: "auto", name: "Auto" }],
      },
      { status: 502 },
    );
  } finally {
    await client.stop().catch(() => []);
  }
}
