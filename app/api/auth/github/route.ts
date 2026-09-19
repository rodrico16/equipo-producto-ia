import { readGitHubAppConfig, createManifestState } from "@/lib/github-app-auth";

export const runtime = "nodejs";

function connectingPage(action: string, state: string, manifest: string) {
  const escapedAction = action.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const escapedState = state.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const escapedManifest = manifest.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>Conectar GitHub</title>
<style>
:root{color-scheme:dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0b141a;color:#e9edef}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#0b141a}.card{width:min(430px,100%);text-align:center}.mark{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;margin:0 auto 18px;background:#202c33;font-weight:900}h1{font-size:24px;margin:0 0 10px}p{color:#96a6af;line-height:1.55;margin:0}.spinner{width:28px;height:28px;border:3px solid #25363f;border-top-color:#25d366;border-radius:50%;margin:24px auto;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<main class="card"><div class="mark">GH</div><h1>Conectando GitHub</h1><p>La primera vez GitHub puede pedirte crear e instalar la integración. No tenés que copiar IDs ni configurar secretos.</p><div class="spinner"></div></main>
<form id="manifest" action="${escapedAction}?state=${escapedState}" method="post"><input type="hidden" name="manifest" value="${escapedManifest}" /></form>
<script>setTimeout(()=>document.getElementById('manifest').submit(),250)</script>
</body>
</html>`;
}

export async function GET(request: Request) {
  const config = await readGitHubAppConfig();
  if (config) {
    return Response.redirect(`https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new`, 302);
  }

  const url = new URL(request.url);
  const origin = url.origin;
  const state = await createManifestState();
  const suffix = Math.random().toString(36).slice(2, 8);
  const manifest = JSON.stringify({
    name: `AI Product Team ${suffix}`,
    url: origin,
    redirect_url: `${origin}/api/github/app/manifest`,
    callback_urls: [`${origin}/api/github/app/callback`],
    description: "Conecta repositorios con AI Product Team Control Room.",
    public: true,
    request_oauth_on_install: true,
    default_permissions: {
      administration: "write",
      contents: "write",
      pull_requests: "write",
    },
    default_events: [],
  });

  return new Response(connectingPage("https://github.com/settings/apps/new", state, manifest), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action https://github.com; base-uri 'none'; frame-ancestors 'self'",
    },
  });
}
