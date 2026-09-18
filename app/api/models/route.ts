import { Sandbox } from "@vercel/sandbox";
import { NextResponse } from "next/server";
import { copilotModelsRunnerSource } from "@/lib/copilot-models-runner-source";
import { requireGitHubSession } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  let auth;
  try {
    auth = await requireGitHubSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let sandbox: Sandbox | undefined;
  try {
    sandbox = await Sandbox.create({
      timeout: 120_000,
      persistent: false,
      networkPolicy: "allow-all",
    });

    await sandbox.writeFiles([
      { path: "/tmp/copilot-models.mjs", content: Buffer.from(copilotModelsRunnerSource) },
      { path: "/tmp/package.json", content: Buffer.from(JSON.stringify({ type: "module", private: true })) },
    ]);

    const install = await sandbox.runCommand({
      cmd: "npm",
      args: ["install", "--prefix", "/tmp", "@github/copilot-sdk@1.0.14", "--no-audit", "--no-fund"],
    });
    if (install.exitCode !== 0) {
      throw new Error(`Copilot SDK install failed: ${(await install.stderr()).slice(-1000)}`);
    }

    const command = await sandbox.runCommand({
      cmd: "node",
      args: ["/tmp/copilot-models.mjs"],
      env: { COPILOT_GITHUB_TOKEN: auth.token },
    });
    if (command.exitCode !== 0) {
      throw new Error(`Copilot model discovery failed: ${(await command.stderr()).slice(-1000)}`);
    }

    const raw = (await command.stdout()).trim();
    const models = JSON.parse(raw) as Array<{ id: string; name: string }>;
    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        models: [{ id: "auto", name: "Auto · Copilot decide" }],
      },
      { status: 502 },
    );
  } finally {
    if (sandbox) await sandbox.stop().catch(() => undefined);
  }
}
