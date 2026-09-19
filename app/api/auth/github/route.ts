export const runtime = "nodejs";

function html() {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>Conectar GitHub</title>
<style>
:root{color-scheme:dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0b141a;color:#e9edef}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:22px;background:radial-gradient(circle at 20% 10%,rgba(37,211,102,.08),transparent 32%),#0b141a}.card{width:min(520px,100%);background:#111b21;border:1px solid #2a3942;border-radius:20px;padding:24px;box-shadow:0 25px 80px rgba(0,0,0,.4)}.brand{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:#202c33;font-weight:900;margin-bottom:18px}h1{font-size:24px;margin:0 0 8px}p{color:#9eacb3;line-height:1.55;margin:0 0 18px}.code{font:800 28px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;background:#0b141a;border:1px solid #2a3942;padding:16px;border-radius:12px;text-align:center;margin:16px 0}.actions{display:flex;gap:10px;flex-wrap:wrap}.btn{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:10px;padding:12px 16px;font-weight:800;text-decoration:none;cursor:pointer}.primary{background:#25d366;color:#04130e}.secondary{background:#202c33;color:#e9edef;border:1px solid #2a3942}.status{margin-top:16px;color:#7ff4a6;font-size:13px}.error{color:#ffaaaa}.setup{display:none;margin-top:16px}.setup input{width:100%;background:#0b141a;border:1px solid #2a3942;color:#e9edef;border-radius:9px;padding:11px;margin:8px 0}.hint{font-size:11px;color:#71818a}</style>
</head>
<body>
<main class="card">
  <div class="brand">GH</div>
  <h1>Conectar GitHub</h1>
  <p>Autorizá esta app desde GitHub. No usamos <code>client_secret</code> ni guardamos tu token en variables de entorno.</p>
  <div id="loading" class="status">Generando código seguro…</div>
  <section id="flow" hidden>
    <div id="code" class="code"></div>
    <p>1. Abrí GitHub. 2. Ingresá este código. 3. Aprobá los permisos. Esta ventana detecta la aprobación automáticamente.</p>
    <div class="actions">
      <a id="open" class="btn primary" target="_blank" rel="noreferrer">Abrir GitHub ↗</a>
      <a class="btn secondary" href="/">Cancelar</a>
    </div>
    <div id="status" class="status">Esperando autorización…</div>
  </section>
  <section id="setup" class="setup">
    <p>GitHub exige un <strong>Client ID público</strong> para Device Flow. No es un secreto. Pegalo una sola vez y este navegador lo recordará.</p>
    <input id="clientId" autocomplete="off" placeholder="Ov23li…" />
    <button id="save" class="btn primary">Continuar</button>
    <div class="hint">Después podés quitar GITHUB_CLIENT_SECRET y SESSION_SECRET de Vercel. El Client ID queda guardado como dato público de conexión.</div>
  </section>
  <div id="error" class="status error"></div>
</main>
<script>
const $=(id)=>document.getElementById(id);
let timer=null;
async function start(clientId){
  $('error').textContent=''; $('setup').style.display='none'; $('loading').textContent='Generando código seguro…'; $('loading').hidden=false;
  const res=await fetch('/api/github/device/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(clientId?{clientId}:{} )});
  const body=await res.json();
  if(res.status===428&&body.needsClientId){$('loading').hidden=true;$('setup').style.display='block';return;}
  if(!res.ok){throw new Error(body.error||'No se pudo iniciar GitHub');}
  $('loading').hidden=true;$('flow').hidden=false;$('code').textContent=body.userCode;$('open').href=body.verificationUrl;
  poll(Math.max(5,body.interval||5));
}
async function poll(seconds){
  clearTimeout(timer);
  timer=setTimeout(async()=>{
    try{
      const res=await fetch('/api/github/device/status',{cache:'no-store'});const body=await res.json();
      if(body.status==='connected'){
        $('status').textContent='✓ GitHub conectado como @'+body.user.login;
        if(window.opener&&!window.opener.closed){window.opener.location.reload();setTimeout(()=>window.close(),800);}else{setTimeout(()=>location.href='/',700);}
        return;
      }
      if(body.status==='failed'||body.status==='expired'){throw new Error(body.error||'La autorización falló');}
      $('status').textContent='Esperando autorización…';poll(Math.max(5,body.interval||seconds));
    }catch(error){$('status').textContent='';$('error').textContent=error instanceof Error?error.message:String(error);}
  },seconds*1000);
}
$('save').addEventListener('click',()=>{const value=$('clientId').value.trim();if(value)start(value).catch(e=>$('error').textContent=e.message);});
start().catch(error=>{$('loading').hidden=true;$('error').textContent=error instanceof Error?error.message:String(error);});
</script>
</body>
</html>`;
}

export async function GET() {
  return new Response(html(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'",
    },
  });
}
