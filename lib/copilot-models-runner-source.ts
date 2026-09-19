export const copilotModelsRunnerSource = String.raw`
import { mkdir } from "node:fs/promises";
import { CopilotClient } from "@github/copilot-sdk";

const rawToken = process.env.COPILOT_GITHUB_TOKEN;
if (!rawToken) throw new Error("Missing COPILOT_GITHUB_TOKEN");

const githubToken = rawToken;
const copilotHome = "/tmp/copilot-models-" + process.pid;
delete process.env.COPILOT_GITHUB_TOKEN;
await mkdir(copilotHome, { recursive: true });

const client = new CopilotClient({
  gitHubToken: githubToken,
  useLoggedInUser: false,
  mode: "empty",
  baseDirectory: copilotHome,
  sessionIdleTimeoutSeconds: 300,
  logLevel: "error",
});

try {
  await client.start();
  const models = await client.listModels();
  process.stdout.write(JSON.stringify(models.map((model) => {
    const supportsReasoning = Boolean(model.capabilities?.supports?.reasoningEffort);
    return {
      id: model.id,
      name: model.name || model.id,
      reasoningEfforts: supportsReasoning
        ? ["low", "medium", "high", "xhigh"].map((id) => ({ id }))
        : [],
      defaultReasoningEffort: supportsReasoning ? "medium" : null,
    };
  })));
} finally {
  await client.stop().catch(() => []);
}
`;
