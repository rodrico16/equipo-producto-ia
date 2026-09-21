import { decideRun, type CheckpointDecision } from "@/lib/run-store";
import { requireControlRoomIdentity } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let owner = "";
  try {
    owner = (await requireControlRoomIdentity()).key;
  } catch {
    return Response.json({ error: "Session required" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as { decision?: CheckpointDecision };
  if (!body.decision || !["continue", "finish", "auto"].includes(body.decision)) {
    return Response.json({ error: "decision must be continue, finish or auto" }, { status: 400 });
  }

  const run = decideRun(id, owner, body.decision);
  if (!run) {
    return Response.json({ error: "Run is not waiting for a decision" }, { status: 409 });
  }

  return Response.json(run, { headers: { "Cache-Control": "no-store" } });
}
