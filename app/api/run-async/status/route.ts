import { Sandbox } from "@vercel/sandbox";
import { requireControlRoomIdentity } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const runPattern = /^[a-f0-9]{24}$/;

export async function GET(request: Request) {
  try {
    await requireControlRoomIdentity();
  } catch {
    return Response.json({ error: "Session required" }, { status: 401 });
  }

  const url = new URL(request.url);
  const runId = url.searchParams.get("runId") || "";
  const cursorRaw = Number(url.searchParams.get("cursor") || "0");
  const cursor = Number.isFinite(cursorRaw) ? Math.max(0, Math.floor(cursorRaw)) : 0;
  if (!runPattern.test(runId)) return Response.json({ error: "Invalid run id" }, { status: 400 });

  const sandboxName = `ai-run-${runId}`;
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.get({ name: sandboxName, resume: false });
  } catch {
    return Response.json({ runId, state: "missing", events: [], cursor }, { status: 404 });
  }

  try {
    const start = cursor + 1;
    const end = cursor + 200;
    const eventsResult = await sandbox.runCommand("bash", [
      "-lc",
      `if [ -f /tmp/control-room-run/events.ndjson ]; then sed -n '${start},${end}p' /tmp/control-room-run/events.ndjson; fi`,
    ]);
    const rawEvents = (await eventsResult.stdout()).trim();
    const events = rawEvents
      ? rawEvents.split("\n").map((line) => {
          try { return JSON.parse(line) as unknown; }
          catch { return { type: "runtime.log", data: { message: line } }; }
        })
      : [];

    const statusResult = await sandbox.runCommand("bash", [
      "-lc",
      "if [ -f /tmp/control-room-run/status.json ]; then cat /tmp/control-room-run/status.json; else printf '{\"state\":\"starting\"}'; fi",
    ]);
    let status: Record<string, unknown> = { state: "starting" };
    try { status = JSON.parse((await statusResult.stdout()).trim()) as Record<string, unknown>; }
    catch { status = { state: "running" }; }

    return Response.json({
      runId,
      ...status,
      events,
      cursor: cursor + events.length,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({
      runId,
      state: "running",
      events: [],
      cursor,
      warning: error instanceof Error ? error.message : String(error),
    }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
