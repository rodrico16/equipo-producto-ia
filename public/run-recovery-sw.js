const encoder = new TextEncoder();

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function line(payload) {
  return encoder.encode(JSON.stringify(payload) + "\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startDetachedRun(request) {
  const body = await request.clone().text();
  return fetch("/api/run-async/start", {
    method: "POST",
    headers: { "Content-Type": request.headers.get("content-type") || "application/json" },
    body,
    credentials: "same-origin",
    cache: "no-store",
  });
}

async function resilientRunResponse(request) {
  const startResponse = await startDetachedRun(request);
  if (!startResponse.ok) return startResponse;

  const start = await startResponse.json();
  const runId = start.runId;
  let cursor = 0;
  let cancelled = false;
  let consecutiveFailures = 0;
  let lastReconnectNotice = 0;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(line({
        type: "control.status",
        data: { message: "Ejecución protegida · el agente sigue aunque Safari pierda la conexión." },
      }));

      while (!cancelled) {
        try {
          const response = await fetch(`/api/run-async/status?runId=${encodeURIComponent(runId)}&cursor=${cursor}`, {
            credentials: "same-origin",
            cache: "no-store",
          });

          if (response.status === 404) {
            consecutiveFailures += 1;
            if (consecutiveFailures >= 8) {
              controller.enqueue(line({
                type: "control.error",
                data: { message: "El worker ya no está disponible. La ejecución excedió su ventana de recuperación." },
              }));
              break;
            }
            await sleep(1500);
            continue;
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          const payload = await response.json();
          const events = Array.isArray(payload.events) ? payload.events : [];
          for (const event of events) controller.enqueue(line(event));
          cursor = typeof payload.cursor === "number" ? payload.cursor : cursor + events.length;
          consecutiveFailures = 0;

          if (payload.state === "done") break;
          if (payload.state === "error") {
            if (!events.some((event) => event && event.type === "control.error")) {
              controller.enqueue(line({
                type: "control.error",
                data: { message: payload.error || "La ejecución terminó con error." },
              }));
            }
            break;
          }

          await sleep(events.length ? 450 : 1100);
        } catch (error) {
          consecutiveFailures += 1;
          const now = Date.now();
          if (now - lastReconnectNotice > 8000) {
            lastReconnectNotice = now;
            controller.enqueue(line({
              type: "control.status",
              data: { message: "Reconectando con la ejecución… el agente sigue trabajando." },
            }));
          }
          await sleep(Math.min(1000 * Math.pow(1.7, Math.min(consecutiveFailures, 6)), 10000));
        }
      }

      if (!cancelled) controller.close();
    },
    cancel() {
      // Closing or suspending the page must not stop the Sandbox. The worker
      // continues independently and remains recoverable until its timeout.
      cancelled = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
      "X-Control-Room-Run": runId,
    },
  });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method === "POST" &&
    url.origin === self.location.origin &&
    url.pathname === "/api/run"
  ) {
    event.respondWith(resilientRunResponse(event.request));
  }
});
