# Resumable long runs

`Repo + PR` can take longer than the Vercel Hobby Function ceiling (300 seconds).

The browser no longer owns the lifetime of those runs:

1. `/api/run-async/start` prepares a named, **ephemeral** Vercel Sandbox and launches the AI runner detached.
2. The runner writes normalized events and final state inside the active Sandbox and performs commit/push/PR itself.
3. `/api/run-async/status` reads incremental events with a cursor.
4. `/run-recovery-sw.js` intercepts the existing `/api/run` request and exposes the same NDJSON stream to the current UI while polling the detached run.
5. Temporary network failures are retried without cancelling the AI worker.

The Sandbox remains `persistent: false`, so this does not reintroduce Snapshot Storage usage. Its timeout is 20 minutes; the Vercel Function requests themselves remain short-lived.
