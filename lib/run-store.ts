import { randomUUID } from "node:crypto";

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_for_user"
  | "publishing"
  | "completed"
  | "failed"
  | "cancelled";

export type CheckpointDecision = "continue" | "finish" | "auto";

export type RunCheckpoint = {
  segment: number;
  reason: "duration";
  createdAt: number;
  resumeAfter?: number;
};

export type RunRecord = {
  id: string;
  owner: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
  autoContinue?: boolean;
  checkpoint?: RunCheckpoint;
};

const runs = new Map<string, RunRecord>();
const MAX_AGE = 24 * 60 * 60 * 1000;

function prune() {
  const cutoff = Date.now() - MAX_AGE;
  for (const [id, run] of runs) if (run.updatedAt < cutoff) runs.delete(id);
}

export function startRun(owner: string, requestedId?: string) {
  prune();
  const id = requestedId?.match(/^[A-Za-z0-9_-]{8,100}$/)?.[0] || randomUUID();
  const existing = runs.get(id);
  if (existing && existing.owner === owner && ["queued", "running", "waiting_for_user", "publishing"].includes(existing.status)) return existing;
  const run: RunRecord = { id, owner, status: "running", createdAt: Date.now(), updatedAt: Date.now(), autoContinue: false };
  runs.set(id, run);
  return run;
}

export function updateRun(id: string, owner: string, patch: Partial<Omit<RunRecord, "id" | "owner" | "createdAt">>) {
  const current = runs.get(id);
  if (!current || current.owner !== owner) return null;
  const next = { ...current, ...patch, updatedAt: Date.now() };
  runs.set(id, next);
  return next;
}

export function checkpointRun(id: string, owner: string, segment: number) {
  const current = runs.get(id);
  if (!current || current.owner !== owner) return null;
  return updateRun(id, owner, {
    status: current.autoContinue ? "queued" : "waiting_for_user",
    checkpoint: { segment, reason: "duration", createdAt: Date.now() },
  });
}

export function decideRun(id: string, owner: string, decision: CheckpointDecision) {
  const current = runs.get(id);
  if (!current || current.owner !== owner || current.status !== "waiting_for_user") return null;
  if (decision === "finish") return updateRun(id, owner, { status: "cancelled" });
  return updateRun(id, owner, {
    status: "queued",
    autoContinue: decision === "auto" ? true : current.autoContinue,
    checkpoint: current.checkpoint ? { ...current.checkpoint, resumeAfter: Date.now() } : undefined,
  });
}

export function finishRun(id: string, owner: string, error?: string) {
  const current = runs.get(id);
  if (!current || current.owner !== owner) return;
  runs.set(id, { ...current, status: error ? "failed" : "completed", error, updatedAt: Date.now() });
}

export function getRun(id: string, owner: string) {
  prune();
  const run = runs.get(id);
  return run && run.owner === owner ? run : null;
}
