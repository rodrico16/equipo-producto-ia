"use client";

import { useEffect, useRef, useState } from "react";

type Provider = "github" | "chatgpt";
type Flow = {
  provider: Provider;
  title: string;
  message: string;
  code?: string | null;
  url?: string | null;
  error?: string | null;
  readyToAuthorize?: boolean;
  reauthRequired?: boolean;
};

type AuthRequiredDetail = { provider?: Provider; message?: string };

function authLike(message: string) {
  const value = message.toLowerCase();
  return [
    "401",
    "unauthorized",
    "authentication",
    "not authenticated",
    "not logged in",
    "login required",
    "session expired",
    "sesión venc",
    "token expired",
    "expired token",
    "refresh token",
    "auth_required",
  ].some((needle) => value.includes(needle));
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function providerFromRequest(input: RequestInfo | URL, init?: RequestInit): Provider | null {
  const url = requestUrl(input);
  if (url.includes("/api/chatgpt/") || url.includes("/api/chat-run")) return "chatgpt";
  if (url.includes("/api/github/") || url.includes("/api/auth/github") || url.includes("/api/copilot-run")) return "github";
  if (url.includes("/api/run") || url.includes("/api/agent-run")) {
    const body = typeof init?.body === "string" ? init.body : "";
    if (body) {
      try {
        const parsed = JSON.parse(body) as { provider?: string };
        if (parsed.provider === "chatgpt") return "chatgpt";
        if (parsed.provider === "copilot") return "github";
      } catch {}
    }
  }
  return null;
}

export function ConnectionExperience() {
  const [flow, setFlow] = useState<Flow | null>(null);
  const popupRef = useRef<Window | null>(null);
  const timerRef = useRef<number | null>(null);
  const nativeFetchRef = useRef<typeof window.fetch | null>(null);
  const finishScheduledRef = useRef(false);

  function rawFetch(input: RequestInfo | URL, init?: RequestInit) {
    return (nativeFetchRef.current ?? window.fetch)(input, init);
  }

  function stopPolling() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function finish() {
    if (finishScheduledRef.current) return;
    finishScheduledRef.current = true;
    stopPolling();
    try { popupRef.current?.close(); } catch {}
    popupRef.current = null;
    setFlow((current) => current ? {
      ...current,
      title: "Conectado",
      message: "Listo. Actualizando tu espacio…",
      code: null,
      error: null,
      readyToAuthorize: false,
      reauthRequired: false,
    } : null);
    window.setTimeout(() => window.location.reload(), 450);
  }

  function requireReauth(provider: Provider, message?: string) {
    setFlow((current) => {
      if (current && !current.reauthRequired) return current;
      return {
        provider,
        title: provider === "github" ? "GitHub necesita reconectarse" : "ChatGPT necesita reconectarse",
        message: message || "La sesión dejó de ser válida después de un tiempo de inactividad. Volvé a autenticarte para continuar.",
        error: "Sesión vencida",
        readyToAuthorize: false,
        reauthRequired: true,
      };
    });
  }

  async function pollGitHub() {
    try {
      const response = await rawFetch("/api/session", { cache: "no-store" });
      const body = await response.json() as { githubConnected?: boolean; githubAuthExpired?: boolean };
      if (body.githubConnected) return finish();
      if (body.githubAuthExpired) {
        requireReauth("github", "La autorización de GitHub venció. Volvé a iniciar sesión para recuperar repositorios y Copilot.");
        return;
      }
    } catch {}
    timerRef.current = window.setTimeout(pollGitHub, 1500);
  }

  async function pollChatGPT() {
    try {
      const response = await rawFetch("/api/chatgpt/status", { cache: "no-store" });
      const body = await response.json() as { status?: string; error?: string };
      if (body.status === "connected") return finish();
      if (body.status === "failed" || body.status === "expired") {
        setFlow((current) => current ? {
          ...current,
          title: "No se pudo conectar",
          message: body.error || "La autorización venció. Probá nuevamente.",
          error: body.error || "Autorización vencida",
          readyToAuthorize: false,
          reauthRequired: true,
        } : current);
        return;
      }
    } catch {}
    timerRef.current = window.setTimeout(pollChatGPT, 1500);
  }

  function openPopup(url = "about:blank", name = "epia-connect") {
    const popup = window.open(url, name, "popup=yes,width=520,height=760");
    popupRef.current = popup;
    return popup;
  }

  async function startGitHub() {
    finishScheduledRef.current = false;
    stopPolling();
    const popup = openPopup("about:blank", "epia-github");
    setFlow({
      provider: "github",
      title: "Conectando GitHub",
      message: "Aprobá la integración en GitHub. Al reconectar reemplazamos la sesión anterior por una nueva.",
    });
    if (!popup) {
      setFlow((current) => current ? {
        ...current,
        title: "No se pudo abrir GitHub",
        message: "El navegador bloqueó la ventana secundaria. Permití ventanas emergentes para este sitio y volvé a intentar.",
        error: "Ventana emergente bloqueada",
        reauthRequired: true,
      } : current);
      return;
    }
    await rawFetch("/api/github/device/logout", { method: "POST" }).catch(() => undefined);
    popup.location.href = "/api/auth/github";
    void pollGitHub();
  }

  function legacyCopy(text: string) {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      textarea.style.fontSize = "16px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }

  async function copyCode(text: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    return legacyCopy(text);
  }

  async function startChatGPT() {
    finishScheduledRef.current = false;
    stopPolling();
    setFlow({
      provider: "chatgpt",
      title: "Preparando ChatGPT",
      message: "Generando un nuevo código de autorización…",
      readyToAuthorize: false,
    });

    try {
      const response = await rawFetch("/api/chatgpt/login", { method: "POST" });
      const body = await response.json() as { verificationUrl?: string; userCode?: string; error?: string };
      if (!response.ok || !body.verificationUrl || !body.userCode) {
        throw new Error(body.error || "No se pudo iniciar la autorización de ChatGPT");
      }

      setFlow({
        provider: "chatgpt",
        title: "Código listo",
        message: "Primero copiá el código. Después abrimos ChatGPT para autorizar nuevamente la cuenta.",
        code: body.userCode,
        url: body.verificationUrl,
        readyToAuthorize: true,
      });
    } catch (error) {
      setFlow({
        provider: "chatgpt",
        title: "No se pudo conectar",
        message: error instanceof Error ? error.message : String(error),
        error: error instanceof Error ? error.message : String(error),
        readyToAuthorize: false,
        reauthRequired: true,
      });
    }
  }

  async function copyAndOpenChatGPT() {
    if (!flow?.code || !flow.url) return;

    const copied = await copyCode(flow.code);
    if (!copied) {
      setFlow((current) => current ? {
        ...current,
        title: "No pudimos copiar el código",
        message: "Tocá el código para seleccionarlo y copiarlo manualmente. Cuando esté copiado, volvé a tocar el botón.",
        error: "Safari no permitió copiar al portapapeles",
        readyToAuthorize: true,
      } : current);
      return;
    }

    const popup = openPopup(flow.url, "epia-chatgpt");
    if (!popup) {
      window.location.href = flow.url;
      return;
    }

    setFlow((current) => current ? {
      ...current,
      title: "Código copiado",
      message: "Abrimos ChatGPT. Pegá el código cuando te lo pida; esta pantalla detecta la aprobación sola.",
      error: null,
      readyToAuthorize: false,
    } : current);
    void pollChatGPT();
  }

  async function inspectResponse(input: RequestInfo | URL, init: RequestInit | undefined, response: Response) {
    const provider = providerFromRequest(input, init);
    if (response.status === 401 && provider) {
      requireReauth(provider);
      return;
    }

    const url = requestUrl(input);
    if (url.includes("/api/session") && response.ok) {
      try {
        const body = await response.clone().json() as { githubAuthExpired?: boolean };
        if (body.githubAuthExpired) requireReauth("github", "La sesión de GitHub venció por inactividad o revocación. Reconectala para continuar.");
      } catch {}
      return;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!provider || !response.ok || !contentType.includes("application/x-ndjson")) return;
    try {
      const text = await response.clone().text();
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as { type?: string; data?: { provider?: string; message?: string } };
          if (event.type === "auth.required") {
            requireReauth(event.data?.provider === "github" ? "github" : provider, event.data?.message);
            return;
          }
          if (event.type === "control.error" && authLike(event.data?.message || "")) {
            requireReauth(provider, event.data?.message);
            return;
          }
        } catch {}
      }
    } catch {}
  }

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    nativeFetchRef.current = originalFetch;
    const wrappedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      void inspectResponse(input, init, response.clone());
      return response;
    };
    window.fetch = wrappedFetch;

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const githubLink = target.closest('a[href="/api/auth/github"]');
      if (githubLink) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        void startGitHub();
        return;
      }

      const button = target.closest("button");
      if (button?.textContent?.trim() === "Conectar") {
        const section = button.closest("section");
        if (section?.textContent?.includes("ChatGPT")) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          void startChatGPT();
        }
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "epia:github-connected") finish();
    };

    const onAuthRequired = (event: Event) => {
      const detail = (event as CustomEvent<AuthRequiredDetail>).detail;
      if (detail?.provider) requireReauth(detail.provider, detail.message);
    };

    const onFocus = () => {
      if (flow?.provider === "github" && !flow.reauthRequired) void pollGitHub();
      if (flow?.provider === "chatgpt" && !flow.readyToAuthorize && !flow.reauthRequired) void pollChatGPT();
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("message", onMessage);
    window.addEventListener("epia:reauth-required", onAuthRequired as EventListener);
    window.addEventListener("focus", onFocus);
    return () => {
      if (window.fetch === wrappedFetch) window.fetch = originalFetch;
      nativeFetchRef.current = null;
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("epia:reauth-required", onAuthRequired as EventListener);
      window.removeEventListener("focus", onFocus);
      stopPolling();
    };
  }, [flow?.provider, flow?.readyToAuthorize, flow?.reauthRequired]);

  if (!flow) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, display: "grid", placeItems: "end center", padding: "18px", pointerEvents: "none" }}>
      <div style={{ width: "min(480px, 100%)", border: "1px solid #2a3942", borderRadius: 18, background: "#111b21", boxShadow: "0 24px 80px rgba(0,0,0,.5)", padding: 18, pointerEvents: "auto" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ width: 42, height: 42, flex: "0 0 auto", borderRadius: 999, display: "grid", placeItems: "center", background: flow.error ? "#482427" : "#163b33", color: flow.error ? "#ffb4b4" : "#74efca", fontWeight: 900 }}>{flow.error ? "!" : flow.provider === "github" ? "GH" : "GPT"}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong style={{ display: "block", color: "#e9edef", fontSize: 16 }}>{flow.title}</strong>
            <span style={{ display: "block", color: "#9aacb5", fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>{flow.message}</span>
            {flow.code && (
              <button
                onClick={() => void copyCode(flow.code || "")}
                style={{ marginTop: 10, border: "1px solid #34505a", borderRadius: 9, padding: "9px 12px", background: "#0b141a", color: "#e9edef", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 900, letterSpacing: ".06em", fontSize: 16 }}
              >
                {flow.code}
              </button>
            )}
          </div>
          <button onClick={() => { stopPolling(); try { popupRef.current?.close(); } catch {} setFlow(null); }} aria-label="Cerrar" style={{ width: 36, height: 36, border: 0, borderRadius: 999, background: "transparent", color: "#94a5ad", fontSize: 22 }}>×</button>
        </div>

        {flow.reauthRequired && (
          <button
            onClick={() => flow.provider === "github" ? void startGitHub() : void startChatGPT()}
            style={{ width: "100%", marginTop: 14, border: 0, borderRadius: 10, padding: "13px 14px", background: "#00a884", color: "#041b16", fontWeight: 900, fontSize: 16 }}
          >
            Reconectar {flow.provider === "github" ? "GitHub" : "ChatGPT"}
          </button>
        )}

        {flow.provider === "chatgpt" && flow.readyToAuthorize && flow.code && flow.url && (
          <button
            onClick={() => void copyAndOpenChatGPT()}
            style={{ width: "100%", marginTop: 14, border: 0, borderRadius: 10, padding: "13px 14px", background: "#00a884", color: "#041b16", fontWeight: 900, fontSize: 16 }}
          >
            Copiar código y abrir ChatGPT
          </button>
        )}
      </div>
    </div>
  );
}
