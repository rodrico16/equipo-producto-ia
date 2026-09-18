"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";

type Provider = "copilot" | "chatgpt";

type SessionState = {
  authenticated: boolean;
  user?: { login: string; avatarUrl?: string | null };
};

type ReasoningOption = {
  id: string;
  description?: string;
};

type ModelOption = {
  id: string;
  displayName?: string;
  name?: string;
  isDefault?: boolean;
  defaultReasoningEffort?: string | null;
  reasoningEfforts?: ReasoningOption[];
};

type ChatGPTState = {
  status: "disconnected" | "pending" | "connected" | "failed" | "expired";
  verificationUrl?: string | null;
  userCode?: string | null;
  planType?: string | null;
  email?: string | null;
  error?: string | null;
};

type AgentDefinition = {
  name: string;
  displayName: string;
  description: string;
  supervisor?: boolean;
};

type AgentRuntime = AgentDefinition & {
  status: "idle" | "selected" | "active" | "done" | "failed";
  model?: string;
  tool?: string;
  durationMs?: number;
  totalTokens?: number;
  totalToolCalls?: number;
};

type StreamEvent = {
  type: string;
  agentId?: string;
  at?: string;
  data?: Record<string, unknown>;
};

type Transcript = {
  id: string;
  agent: string;
  displayName: string;
  text: string;
  streaming: boolean;
};

type Activity = {
  id: string;
  label: string;
  detail?: string;
  tone?: "neutral" | "good" | "bad";
};

const COPILOT_FALLBACK: ModelOption[] = [{ id: "auto", displayName: "Auto · Copilot decide" }];

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function prettyDuration(ms?: number) {
  if (ms === undefined) return undefined;
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

export default function Home() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [provider, setProvider] = useState<Provider>("copilot");
  const [models, setModels] = useState<ModelOption[]>(COPILOT_FALLBACK);
  const [chatGPT, setChatGPT] = useState<ChatGPTState>({ status: "disconnected" });
  const [connectingChatGPT, setConnectingChatGPT] = useState(false);
  const [agents, setAgents] = useState<AgentRuntime[]>([]);
  const [repo, setRepo] = useState("rodrico16/equipo-producto-ia");
  const [branch, setBranch] = useState("main");
  const [model, setModel] = useState("auto");
  const [reasoningEffort, setReasoningEffort] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Listo para trabajar");
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [diffStat, setDiffStat] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [error, setError] = useState("");
  const agentIdToName = useRef<Record<string, string>>({ supervisor: "supervisor" });
  const transcriptEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/session", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/agents", { cache: "no-store" }).then((response) => response.json()),
    ])
      .then(([sessionData, agentsData]) => {
        setSession(sessionData as SessionState);
        const catalog = ((agentsData as { agents?: AgentDefinition[] }).agents ?? []).map((agent) => ({
          ...agent,
          status: "idle" as const,
        }));
        setAgents(catalog);
      })
      .catch(() => setSession({ authenticated: false }));
  }, []);

  useEffect(() => {
    if (!session?.authenticated) return;
    fetch("/api/chatgpt/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((state) => setChatGPT(state as ChatGPTState))
      .catch(() => setChatGPT({ status: "disconnected" }));
  }, [session?.authenticated]);

  useEffect(() => {
    if (chatGPT.status !== "pending") return;
    const timer = window.setInterval(() => {
      fetch("/api/chatgpt/status", { cache: "no-store" })
        .then((response) => response.json())
        .then((state) => setChatGPT(state as ChatGPTState))
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [chatGPT.status]);

  useEffect(() => {
    if (!session?.authenticated) return;

    const endpoint = provider === "chatgpt" ? "/api/chatgpt/models" : "/api/models";
    if (provider === "chatgpt" && chatGPT.status !== "connected") {
      setModels([]);
      setModel("");
      setReasoningEffort("");
      return;
    }

    fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        const fetched = Array.isArray(body.models) ? (body.models as ModelOption[]) : [];
        if (provider === "copilot") {
          if (!fetched.some((item) => item.id === "auto")) fetched.unshift(COPILOT_FALLBACK[0]);
          const next = fetched.length ? fetched : COPILOT_FALLBACK;
          setModels(next);
          setModel((current) => (next.some((item) => item.id === current) ? current : "auto"));
          setReasoningEffort("");
          return;
        }

        setModels(fetched);
        const preferred = fetched.find((item) => item.isDefault) ?? fetched[0];
        if (preferred) {
          setModel(preferred.id);
          setReasoningEffort(preferred.defaultReasoningEffort || preferred.reasoningEfforts?.[0]?.id || "");
        }
      })
      .catch(() => {
        if (provider === "copilot") setModels(COPILOT_FALLBACK);
        else setModels([]);
      });
  }, [session?.authenticated, provider, chatGPT.status]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcripts, activity]);

  const filteredAgents = useMemo(() => {
    const needle = agentFilter.trim().toLowerCase();
    if (!needle) return agents;
    return agents.filter(
      (agent) =>
        agent.displayName.toLowerCase().includes(needle) ||
        agent.description.toLowerCase().includes(needle),
    );
  }, [agentFilter, agents]);

  const selectedModel = models.find((item) => item.id === model);
  const reasoningOptions = selectedModel?.reasoningEfforts ?? [];
  const activeCount = agents.filter((agent) => agent.status === "active" || agent.status === "selected").length;
  const usedCount = agents.filter((agent) => agent.status !== "idle").length;
  const canRun = Boolean(prompt.trim()) && !running && (provider === "copilot" || chatGPT.status === "connected");

  function resetRunState() {
    setTranscripts([]);
    setActivity([]);
    setDiffStat("");
    setPrUrl("");
    setError("");
    agentIdToName.current = { supervisor: "supervisor" };
    setAgents((current) => current.map((agent) => ({ ...agent, status: "idle", model: undefined, tool: undefined })));
  }

  function updateAgent(name: string, patch: Partial<AgentRuntime>) {
    setAgents((current) => current.map((agent) => (agent.name === name ? { ...agent, ...patch } : agent)));
  }

  function displayNameFor(name: string) {
    return agents.find((agent) => agent.name === name)?.displayName ?? name.replaceAll("_", " ");
  }

  function addActivity(label: string, detail?: string, tone: Activity["tone"] = "neutral") {
    setActivity((current) => [
      ...current.slice(-39),
      { id: `${Date.now()}-${Math.random()}`, label, detail, tone },
    ]);
  }

  async function connectChatGPT() {
    setConnectingChatGPT(true);
    setError("");
    try {
      const response = await fetch("/api/chatgpt/login", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo iniciar el login de ChatGPT");
      setChatGPT(body as ChatGPTState);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : String(connectError));
    } finally {
      setConnectingChatGPT(false);
    }
  }

  async function disconnectChatGPT() {
    await fetch("/api/chatgpt/logout", { method: "POST" }).catch(() => undefined);
    setChatGPT({ status: "disconnected" });
    if (provider === "chatgpt") {
      setModels([]);
      setModel("");
      setReasoningEffort("");
    }
  }

  function changeModel(nextModel: string) {
    setModel(nextModel);
    const option = models.find((item) => item.id === nextModel);
    if (provider === "chatgpt") {
      setReasoningEffort(option?.defaultReasoningEffort || option?.reasoningEfforts?.[0]?.id || "");
    }
  }

  function handleEvent(event: StreamEvent) {
    const data = event.data ?? {};
    const agentId = event.agentId || "supervisor";

    if (event.type === "control.status") {
      const message = asString(data.message);
      if (message) setStatus(message);
      return;
    }

    if (event.type === "team.loaded") {
      addActivity("Equipo cargado", `${String(data.count ?? agents.length)} agentes disponibles`);
      return;
    }

    if (event.type === "run.started") {
      updateAgent("supervisor", { status: "active", model: model || undefined });
      addActivity("Supervisor inició la ejecución", provider === "chatgpt" ? "ChatGPT / Codex" : "GitHub Copilot", "good");
      return;
    }

    if (event.type === "subagent.selected") {
      const name = asString(data.agentName);
      if (name) {
        updateAgent(name, { status: "selected" });
        addActivity(`${displayNameFor(name)} seleccionado`, asString(data.agentDisplayName));
      }
      return;
    }

    if (event.type === "subagent.started") {
      const name = asString(data.agentName) || agentId;
      if (event.agentId) agentIdToName.current[event.agentId] = name;
      updateAgent(name, { status: "active", model: asString(data.model) || model || undefined, tool: undefined });
      addActivity(`${displayNameFor(name)} empezó a trabajar`, asString(data.model) || model || undefined, "good");
      return;
    }

    if (event.type === "subagent.completed") {
      const name = asString(data.agentName) || agentIdToName.current[agentId] || agentId;
      updateAgent(name, {
        status: "done",
        durationMs: asNumber(data.durationMs),
        totalTokens: asNumber(data.totalTokens),
        totalToolCalls: asNumber(data.totalToolCalls),
        tool: undefined,
      });
      addActivity(`${displayNameFor(name)} terminó`, prettyDuration(asNumber(data.durationMs)), "good");
      return;
    }

    if (event.type === "subagent.failed") {
      const name = asString(data.agentName) || agentIdToName.current[agentId] || agentId;
      updateAgent(name, { status: "failed", tool: undefined });
      addActivity(`${displayNameFor(name)} falló`, asString(data.error), "bad");
      return;
    }

    if (event.type === "tool.started") {
      const name = agentIdToName.current[agentId] || agentId;
      const toolName = asString(data.toolName);
      updateAgent(name, { status: "active", tool: toolName || "tool" });
      addActivity(`${displayNameFor(name)} usa ${toolName || "una herramienta"}`);
      return;
    }

    if (event.type === "tool.completed") {
      const name = agentIdToName.current[agentId] || agentId;
      updateAgent(name, { tool: undefined });
      if (data.success === false) addActivity(`Herramienta de ${displayNameFor(name)} falló`, asString(data.error), "bad");
      return;
    }

    if (event.type === "agent.delta" || event.type === "agent.message") {
      const name = agentIdToName.current[agentId] || agentId;
      const chunk = asString(data.content);
      if (!chunk) return;
      const messageId = asString(data.messageId);
      const id = `message-${messageId || agentId}`;
      setTranscripts((current) => {
        const index = current.findIndex((message) => message.id === id);
        if (index === -1) {
          return [
            ...current,
            {
              id,
              agent: name,
              displayName: displayNameFor(name),
              text: chunk,
              streaming: event.type === "agent.delta",
            },
          ];
        }
        const next = [...current];
        const previous = next[index];
        next[index] = {
          ...previous,
          agent: name,
          displayName: displayNameFor(name),
          text: event.type === "agent.message" ? chunk : previous.text + chunk,
          streaming: event.type === "agent.delta",
        };
        return next;
      });
      return;
    }

    if (event.type === "workspace.diff") {
      setDiffStat(asString(data.diffStat));
      addActivity("Cambios preparados", asString(data.diffStat) || asString(data.changed), "good");
      return;
    }

    if (event.type === "run.completed") {
      updateAgent("supervisor", { status: "done", tool: undefined, totalTokens: asNumber(data.totalTokens) });
      addActivity("Supervisor cerró la ejecución", undefined, "good");
      return;
    }

    if (event.type === "control.done") {
      setStatus("Ejecución completada");
      setPrUrl(asString(data.prUrl));
      setDiffStat(asString(data.diffStat) || diffStat);
      return;
    }

    if (event.type === "control.error" || event.type === "run.failed") {
      const message = asString(data.message) || "La ejecución falló";
      setError(message);
      setStatus("Ejecución detenida");
      addActivity("Error de ejecución", message, "bad");
    }
  }

  async function startRun(event: FormEvent) {
    event.preventDefault();
    if (!canRun) return;
    resetRunState();
    setRunning(true);
    setStatus("Preparando ejecución…");

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, branch, provider, model, reasoningEffort, prompt }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const valueLine of lines) {
          if (!valueLine.trim()) continue;
          handleEvent(JSON.parse(valueLine) as StreamEvent);
        }
        if (done) break;
      }
      if (buffer.trim()) handleEvent(JSON.parse(buffer) as StreamEvent);
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setError(message);
      setStatus("Ejecución detenida");
    } finally {
      setRunning(false);
    }
  }

  if (session === null) {
    return (
      <main className="loading-screen">
        <div className="brand-mark">AI</div>
        <p>Inicializando Control Room…</p>
      </main>
    );
  }

  if (!session.authenticated) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="eyebrow">AI PRODUCT TEAM</div>
          <h1>Tu equipo de agentes, programando con Copilot o con tu ChatGPT.</h1>
          <p className="lead">
            Conectá GitHub para acceder a tus repositorios. Después elegí GitHub Copilot o ChatGPT / Codex,
            seleccioná el modelo y mirá cómo el equipo se delega trabajo sobre un repositorio real.
          </p>
          <a className="github-button" href="/api/auth/github">
            <span className="github-icon">⌘</span>
            Continuar con GitHub
          </a>
          <div className="security-note">
            <strong>Tu suscripción, tus permisos.</strong> Las credenciales quedan del lado servidor y la ejecución ocurre dentro de Vercel Sandbox.
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark small">AI</div>
          <div>
            <strong>Product Team</strong>
            <span>Control Room</span>
          </div>
        </div>
        <div className="top-status">
          <span className={`live-dot ${running ? "is-live" : ""}`} />
          {running ? `${activeCount || 1} trabajando` : status}
        </div>
        <div className="user-menu">
          {session.user?.avatarUrl ? <img src={session.user.avatarUrl} alt="" /> : <span className="avatar-fallback">GH</span>}
          <span>@{session.user?.login}</span>
          <form action="/api/auth/logout" method="post">
            <button className="ghost-button" type="submit">Salir</button>
          </form>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="control-panel">
          <div className="panel-heading">
            <span className="step-index">01</span>
            <div><strong>Trabajo</strong><small>Definí qué tiene que construir el equipo.</small></div>
          </div>

          <form onSubmit={startRun} className="run-form">
            <div className="provider-switch" role="group" aria-label="Proveedor de inteligencia artificial">
              <button type="button" className={provider === "copilot" ? "active" : ""} onClick={() => setProvider("copilot")} disabled={running}>
                <strong>GitHub Copilot</strong><small>Tu suscripción Copilot</small>
              </button>
              <button type="button" className={provider === "chatgpt" ? "active" : ""} onClick={() => setProvider("chatgpt")} disabled={running}>
                <strong>ChatGPT / Codex</strong><small>Tu plan de ChatGPT</small>
              </button>
            </div>

            {provider === "chatgpt" && (
              <div className={`provider-account provider-${chatGPT.status}`}>
                <div>
                  <strong>{chatGPT.status === "connected" ? "ChatGPT conectado" : chatGPT.status === "pending" ? "Esperando autorización" : "Conectá tu ChatGPT"}</strong>
                  <small>
                    {chatGPT.status === "connected"
                      ? `${chatGPT.planType || "Plan ChatGPT"}${chatGPT.email ? ` · ${chatGPT.email}` : ""}`
                      : "Codex usa tu acceso de ChatGPT; no necesitás OPENAI_API_KEY."}
                  </small>
                </div>
                {chatGPT.status === "connected" ? (
                  <button type="button" className="ghost-button" onClick={disconnectChatGPT} disabled={running}>Desconectar</button>
                ) : chatGPT.status === "pending" ? (
                  <div className="device-code-box">
                    <code>{chatGPT.userCode}</code>
                    {chatGPT.verificationUrl && <a href={chatGPT.verificationUrl} target="_blank" rel="noreferrer">Abrir ChatGPT ↗</a>}
                  </div>
                ) : (
                  <button type="button" className="connect-provider-button" onClick={connectChatGPT} disabled={connectingChatGPT || running}>
                    {connectingChatGPT ? "Conectando…" : "Conectar ChatGPT"}
                  </button>
                )}
                {(chatGPT.status === "failed" || chatGPT.status === "expired") && chatGPT.error && <p className="provider-error">{chatGPT.error}</p>}
              </div>
            )}

            <label>
              Repositorio
              <input value={repo} onChange={(event) => setRepo(event.target.value)} disabled={running} />
            </label>
            <label>
              Rama base
              <input value={branch} onChange={(event) => setBranch(event.target.value)} disabled={running} />
            </label>
            <label>
              Modelo {provider === "chatgpt" ? "ChatGPT / Codex" : "Copilot"}
              <select value={model} onChange={(event) => changeModel(event.target.value)} disabled={running || !models.length}>
                {!models.length && <option value="">Conectá ChatGPT para ver modelos</option>}
                {models.map((item) => (
                  <option key={item.id} value={item.id}>{item.displayName || item.name || item.id}</option>
                ))}
              </select>
            </label>
            {provider === "chatgpt" && reasoningOptions.length > 0 && (
              <label>
                Razonamiento
                <select value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value)} disabled={running}>
                  {reasoningOptions.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
                </select>
              </label>
            )}
            <label className="task-field">
              Objetivo
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ej: creá el onboarding completo, implementalo, probalo y dejá un PR listo para revisar…"
                disabled={running}
              />
            </label>
            <button className="run-button" type="submit" disabled={!canRun}>
              {running ? <><span className="spinner" /> Ejecutando equipo</> : <>▶ Iniciar equipo</>}
            </button>
          </form>

          <div className="execution-policy">
            <span>Sandbox aislado</span>
            <span>PR automático</span>
            <span>Sin merge automático</span>
          </div>

          {(diffStat || prUrl || error) && (
            <div className={`result-card ${error ? "error" : ""}`}>
              <strong>{error ? "La ejecución se detuvo" : prUrl ? "PR listo para revisar" : "Cambios detectados"}</strong>
              {error && <p>{error}</p>}
              {diffStat && <pre>{diffStat}</pre>}
              {prUrl && <a href={prUrl} target="_blank" rel="noreferrer">Abrir Pull Request ↗</a>}
            </div>
          )}
        </aside>

        <section className="conversation-panel">
          <div className="conversation-heading">
            <div>
              <span className="step-index">02</span>
              <div><strong>Conversación del equipo</strong><small>Texto, herramientas y handoffs emitidos por {provider === "chatgpt" ? "Codex" : "Copilot"}.</small></div>
            </div>
            <div className="run-metrics">
              <span>{usedCount}<small>participaron</small></span>
              <span>{agents.length}<small>disponibles</small></span>
            </div>
          </div>

          <div className="conversation-stream">
            {!transcripts.length && !activity.length ? (
              <div className="empty-state">
                <div className="empty-orbit"><span>S</span></div>
                <h2>El equipo está esperando un objetivo.</h2>
                <p>Cuando ejecutes una tarea vas a ver qué agente fue elegido, qué hace y cómo entrega su trabajo al supervisor.</p>
              </div>
            ) : (
              <>
                {activity.map((item) => (
                  <div className={`activity-row ${item.tone ?? "neutral"}`} key={item.id}>
                    <span className="activity-node" />
                    <div><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</div>
                  </div>
                ))}
                {transcripts.map((message) => (
                  <article className={`agent-message ${message.agent === "supervisor" ? "supervisor-message" : ""}`} key={message.id}>
                    <div className="message-meta">
                      <span className="agent-avatar">{message.displayName.slice(0, 1).toUpperCase()}</span>
                      <div><strong>{message.displayName}</strong><small>{message.agent === "supervisor" ? "coordina e integra" : "agente especialista"}</small></div>
                      {message.streaming && <span className="speaking-pill">hablando…</span>}
                    </div>
                    <MessageResponse>{message.text}</MessageResponse>
                  </article>
                ))}
                <div ref={transcriptEnd} />
              </>
            )}
          </div>
        </section>

        <aside className="team-panel">
          <div className="panel-heading compact">
            <span className="step-index">03</span>
            <div><strong>Equipo</strong><small>{activeCount ? `${activeCount} activos ahora` : `${agents.length} perfiles`}</small></div>
          </div>
          <input
            className="agent-search"
            value={agentFilter}
            onChange={(event) => setAgentFilter(event.target.value)}
            placeholder="Buscar agente…"
          />
          <div className="agent-list">
            {filteredAgents.map((agent) => (
              <article className={`agent-card status-${agent.status}`} key={agent.name}>
                <div className="agent-card-top">
                  <span className="agent-avatar">{agent.displayName.slice(0, 1)}</span>
                  <div><strong>{agent.displayName}</strong><small>{agent.supervisor ? "orquestador" : agent.status === "idle" ? "en espera" : agent.status}</small></div>
                  <span className="agent-status-dot" title={agent.status} />
                </div>
                <p>{agent.description}</p>
                {(agent.model || agent.tool || agent.durationMs !== undefined) && (
                  <div className="agent-runtime-meta">
                    {agent.model && <span>{agent.model}</span>}
                    {agent.tool && <span>↳ {agent.tool}</span>}
                    {agent.durationMs !== undefined && <span>{prettyDuration(agent.durationMs)}</span>}
                    {agent.totalToolCalls !== undefined && <span>{agent.totalToolCalls} tools</span>}
                    {agent.totalTokens !== undefined && <span>{agent.totalTokens} tokens</span>}
                  </div>
                )}
              </article>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
