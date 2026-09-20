import { getControlRoomIdentity } from "@/lib/server-auth";
import { getRun } from "@/lib/run-store";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await getControlRoomIdentity();
  if (!identity) return Response.json({ error: "Session required" }, { status: 401 });
  const { id } = await context.params;
  const run = getRun(id, identity.key);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json(run, { headers: { "Cache-Control": "no-store" } });
}
