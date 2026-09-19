export const copilotModelsRunnerSource = String.raw`
import { CopilotClient } from "@github/copilot-sdk";

const rawToken = process.env.COPILOT_GITHUB_TOKEN;
if (!rawToken) throw new Error("Missing COPILOT_GITHUB_TOKEN");

const githubToken = rawToken;
delete process.env.COPILOT_GITHUB_TOKEN;

const client = new CopilotClient({
  gitHubToken: githubToken,
  useLoggedInUser: false,
  mode: "empty",
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
