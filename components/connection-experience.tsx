"use client";

import { useEffect, useRef, useState } from "react";

type Flow = {
  provider: "github" | "chatgpt";
  title: string;
  message: string;
  code?: string | null;
  url?: string | null;
  error?: string | null;
  readyToAuthorize?: boolean;
};

export function ConnectionExperience() {
  const [flow, setFlow] = useState<Flow | null>(null);
  const popupRef = useRef<Window | null>(null);
  const timerRef = useRef<number | null>(null);

  function stopPolling() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function finish() {
    stopPolling();
    try { popupRef.current?.close(); } catch {}
    popupRef.current = null;
    setFlow((current) => current ? {
      ...current,
      title: "Conectado",
      message: "Listo. Actualizando tu espacio…",
      code: null,
      readyToAuthorize: false,
    } : null);
    window.setTimeout(() => window.location.reload(), 450);
  }

  async function pollGitHub() {
    try {
      const response = await fetch("/api/session", { cache: "no-store" });
      const body = await response.json() as { githubConnected?: boolean };
      if (body.githubConnected) return finish();
    } catch {}
    timerRef.current = window.setTimeout(pollGitHub, 1500);
  }

  async function pollChatGPT() {
    try {
      const response = await fetch("/api/chatgpt/status", { cache: "no-store" });
      const body = await response.json() as { status?: string; error?: string };
      if (body.status === "connected") return finish();
      if (body.status === "failed" || body.status === "expired") {
        setFlow((current) => current ? {
          ...current,
          title: "No se pudo conectar",
          message: body.error || "La autorización venció. Probá nuevamente.",
          error: body.error || "Autorización vencida",
          readyToAuthorize: false,
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

  function startGitHub() {
    stopPolling();
    setFlow({
      provider: "github",
      title: "Conectando GitHub",
      message: "Aprobá la integración en GitHub. La primera vez puede pedirte crearla e instalarla; después queda lista para reutilizar.",
    });
    openPopup("/api/auth/github", "epia-github");
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
    stopPolling();
    setFlow({
      provider: "chatgpt",
      title: "Preparando ChatGPT",
      message: "Generando tu código de autorización…",
      readyToAuthorize: false,
    });

    try {
      const response = await fetch("/api/chatgpt/login", { method: "POST" });
      const body = await response.json() as { verificationUrl?: string; userCode?: string; error?: string };
      if (!response.ok || !body.verificationUrl || !body.userCode) {
        throw new Error(body.error || "No se pudo iniciar la autorización de ChatGPT");
      }

      setFlow({
        provider: "chatgpt",
        title: "Código listo",
        message: "Primero copiá el código. Recién después abrimos ChatGPT para autorizar la cuenta.",
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

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const githubLink = target.closest('a[href="/api/auth/github"]');
      if (githubLink) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        startGitHub();
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

    const onFocus = () => {
      if (flow?.provider === "github") void pollGitHub();
      if (flow?.provider === "chatgpt" && !flow.readyToAuthorize) void pollChatGPT();
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("message", onMessage);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("focus", onFocus);
      stopPolling();
    };
  }, [flow?.provider, flow?.readyToAuthorize]);

  if (!flow) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, display: "grid", placeItems: "end center", padding: "18px", pointerEvents: "none" }}>
      <div style={{ width: "min(480px, 100%)", border: "1px solid #2a3942", borderRadius: 18, background: "#111b21", boxShadow: "0 24px 80px rgba(0,0,0,.5)", padding: 18, pointerEvents: "auto" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ width: 42, height: 42, flex: "0 0 auto", borderRadius: 999, display: "grid", placeItems: "center", background: flow.error ? "#482427" : "#163b33", color: flow.error ? "#ffb4b4" : "#74efca", fontWeight: 900 }}>{flow.error ? "!" : flow.provider === "github" ? "GH" : "GPT"}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong style={{ display: "block", color: "#e9edef", fontSize: 15 }}>{flow.title}</strong>
            <span style={{ display: "block", color: "#9aacb5", fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>{flow.message}</span>
            {flow.code && (
              <button
                onClick={() => void copyCode(flow.code || "")}
                style={{ marginTop: 10, border: "1px solid #34505a", borderRadius: 9, padding: "9px 12px", background: "#0b141a", color: "#e9edef", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 900, letterSpacing: ".06em" }}
              >
                {flow.code}
              </button>
            )}
          </div>
          <button onClick={() => { stopPolling(); try { popupRef.current?.close(); } catch {} setFlow(null); }} aria-label="Cerrar" style={{ width: 32, height: 32, border: 0, borderRadius: 999, background: "transparent", color: "#94a5ad", fontSize: 22 }}>×</button>
        </div>

        {flow.provider === "chatgpt" && flow.readyToAuthorize && flow.code && flow.url && (
          <button
            onClick={() => void copyAndOpenChatGPT()}
            style={{ width: "100%", marginTop: 14, border: 0, borderRadius: 10, padding: "13px 14px", background: "#00a884", color: "#041b16", fontWeight: 900 }}
          >
            Copiar código y abrir ChatGPT
          </button>
        )}
      </div>
    </div>
  );
}
