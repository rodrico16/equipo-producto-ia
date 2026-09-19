"use client";

import { useEffect, useRef, useState } from "react";

type Flow = {
  provider: "github" | "chatgpt";
  title: string;
  message: string;
  code?: string | null;
  url?: string | null;
  error?: string | null;
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
    setFlow((current) => current ? { ...current, title: "Conectado", message: "Listo. Actualizando tu espacio…", code: null } : null);
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
        setFlow((current) => current ? { ...current, title: "No se pudo conectar", message: body.error || "La autorización venció. Probá nuevamente.", error: body.error || "Autorización vencida" } : current);
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

  async function startChatGPT() {
    stopPolling();
    const popup = openPopup("about:blank", "epia-chatgpt");
    setFlow({ provider: "chatgpt", title: "Conectando ChatGPT", message: "Preparando la autorización segura…" });

    try {
      const response = await fetch("/api/chatgpt/login", { method: "POST" });
      const body = await response.json() as { verificationUrl?: string; userCode?: string; error?: string };
      if (!response.ok || !body.verificationUrl || !body.userCode) throw new Error(body.error || "No se pudo iniciar la autorización de ChatGPT");

      let copied = false;
      try {
        await navigator.clipboard.writeText(body.userCode);
        copied = true;
      } catch {}

      if (popup && !popup.closed) popup.location.href = body.verificationUrl;
      setFlow({
        provider: "chatgpt",
        title: "Aprobá en ChatGPT",
        message: copied
          ? "Abrimos ChatGPT y copiamos el código. Pegalo cuando te lo pida; esta pantalla detecta la aprobación sola."
          : "Abrimos ChatGPT. Ingresá el código cuando te lo pida; esta pantalla detecta la aprobación sola.",
        code: body.userCode,
        url: body.verificationUrl,
      });
      void pollChatGPT();
    } catch (error) {
      try { popup?.close(); } catch {}
      setFlow({
        provider: "chatgpt",
        title: "No se pudo conectar",
        message: error instanceof Error ? error.message : String(error),
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
      if (flow?.provider === "chatgpt") void pollChatGPT();
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
  }, [flow?.provider]);

  if (!flow) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, display: "grid", placeItems: "end center", padding: "18px", pointerEvents: "none" }}>
      <div style={{ width: "min(480px, 100%)", border: "1px solid #2a3942", borderRadius: 18, background: "#111b21", boxShadow: "0 24px 80px rgba(0,0,0,.5)", padding: 18, pointerEvents: "auto" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ width: 42, height: 42, flex: "0 0 auto", borderRadius: 999, display: "grid", placeItems: "center", background: flow.error ? "#482427" : "#163b33", color: flow.error ? "#ffb4b4" : "#74efca", fontWeight: 900 }}>{flow.error ? "!" : flow.provider === "github" ? "GH" : "GPT"}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong style={{ display: "block", color: "#e9edef", fontSize: 15 }}>{flow.title}</strong>
            <span style={{ display: "block", color: "#9aacb5", fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>{flow.message}</span>
            {flow.code && <button onClick={() => navigator.clipboard.writeText(flow.code || "")} style={{ marginTop: 10, border: "1px solid #34505a", borderRadius: 9, padding: "8px 11px", background: "#0b141a", color: "#e9edef", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 800 }}>{flow.code} · copiar</button>}
          </div>
          <button onClick={() => { stopPolling(); setFlow(null); }} aria-label="Cerrar" style={{ width: 32, height: 32, border: 0, borderRadius: 999, background: "transparent", color: "#94a5ad", fontSize: 22 }}>×</button>
        </div>
        {flow.url && <button onClick={() => openPopup(flow.url || "about:blank", `epia-${flow.provider}`)} style={{ width: "100%", marginTop: 14, border: 0, borderRadius: 10, padding: "11px 14px", background: "#00a884", color: "#041b16", fontWeight: 850 }}>Abrir autorización</button>}
      </div>
    </div>
  );
}
