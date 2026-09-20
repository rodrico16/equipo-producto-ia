import { randomUUID } from "node:crypto";

export type RunStatus = "running" | "completed" | "failed";
export type RunRecord = { id: string; owner: string; status: RunStatus; createdAt: number; updatedAt: number; error?: string };

const runs = new Map<string, RunRecord>();
const MAX_AGE = 60 * 60 * 1000;
function prune() { const cutoff = Date.now() - MAX_AGE; for (const [id, run] of runs) if (run.updatedAt < cutoff) runs.delete(id); }
export function startRun(owner: string, requestedId?: string) {
  prune();
  const id = requestedId?.match(/^[A-Za-z0-9_-]{8,100}$/)?.[0] || randomUUID();
  const existing = runs.get(id);
  if (existing && existing.owner === owner && existing.status === "running") return existing;
  const run: RunRecord = { id, owner, status: "running", createdAt: Date.now(), updatedAt: Date.now() };
  runs.set(id, run); return run;
}
export function finishRun(id: string, owner: string, error?: string) {
  const current = runs.get(id); if (!current || current.owner !== owner) return;
  runs.set(id, { ...current, status: error ? "failed" : "completed", error, updatedAt: Date.now() });
}
export function getRun(id: string, owner: string) { prune(); const run = runs.get(id); return run && run.owner === owner ? run : null; }
