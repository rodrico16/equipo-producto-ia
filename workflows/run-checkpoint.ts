import { defineHook } from "workflow";

export type RunCheckpointDecision = {
  decision: "continue" | "finish" | "auto";
};

export const runCheckpointDecision = defineHook<RunCheckpointDecision>();

export async function durableRunApproval(runId: string, segment: number) {
  "use workflow";

  const events = runCheckpointDecision.create({ token: runId });

  for await (const event of events) {
    if (event.decision === "finish") {
      return { decision: "finish" as const, segment };
    }

    return {
      decision: event.decision,
      segment: segment + 1,
      autoContinue: event.decision === "auto",
    };
  }

  return { decision: "finish" as const, segment };
}
