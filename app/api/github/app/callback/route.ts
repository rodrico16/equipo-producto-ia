import { resolveAppOrigin } from "@/lib/app-origin";
import { consumeManifestState, readGitHubAppConfig } from "@/lib/github-app-auth";
import { writeGitHubDeviceSession } from "@/lib/github-device-auth";

export const runtime = "nodejs";

function donePage(origin: string, login: string) {
  const safeOrigin = JSON.stringify(origin);
  const safeLogin = JSON.stringify(login);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>GitHub conectado</title><style>:root{color-scheme:dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0b141a;color:#e9edef}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px}.card{text-align:center}.ok{width:62px;height:62px;border-radius:50%;display:grid;place-items:center;margin:auto;background:#123d32;color:#6ef0c0;font-size:28px}h1{font-size:24px;margin:18px 0 8px}p{color:#96a6af}</style></head><body><main class="card"><div class="ok">✓</div><h1 id="title">GitHub conectado</h1><p id="message">@${login} ya está listo. Podés volver al chat.</p></main><script>const recovery=()=>{document.getElementById('title').textContent='Volvé a la ventana original';document.getElementById('message').textContent='La autorización terminó, pero esta ventana no puede devolver el resultado. Cerrala y continuá en la ventana donde iniciaste sesión.'};try{if(window.opener&&!window.opener.closed){window.opener.postMessage({type:'epia:github-connected',login:${safeLogin}},${safeOrigin});setTimeout(()=>window.close(),500)}else{recovery()}}catch{recovery()}</script></body></html>`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = resolveAppOrigin(request);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const config = await readGitHubAppConfig();
  if (!code || !config || !(await consumeManifestState(state))) {
    return Response.redirect(new URL("/?github=oauth-missing", request.url), 302);
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: `${origin}/api/github/app/callback`,
    }),
    cache: "no-store",
  });
  const tokenBody = (await tokenResponse.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenResponse.ok || !tokenBody.access_token) {
    return Response.redirect(new URL(`/?github=${encodeURIComponent(tokenBody.error_description || tokenBody.error || "oauth-failed")}`, request.url), 302);
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: "Bearer " + tokenBody.access_token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    cache: "no-store",
  });
  if (!userResponse.ok) {
    return Response.redirect(new URL("/?github=user-failed", request.url), 302);
  }
  const user = (await userResponse.json()) as { login: string; avatar_url?: string | null };
  await writeGitHubDeviceSession(tokenBody.access_token, {
    login: user.login,
    avatarUrl: user.avatar_url ?? null,
  });

  return new Response(donePage(origin, user.login), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'",
    },
  });
}
