"use client";

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";

type Provider = "copilot" | "chatgpt";

type SessionState = {
  authenticated: boolean;
  mode?: "guest" | "github";
  githubConnected?: boolean;
  githubConfigured?: boolean;
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

type StreamEvent = {
  type: string;
  agentId?: string;
  at?: string;
  data?: Record<string, unknown>;
};

type ChatMessage = {
  id: string;
  kind: "user" | "agent" | "system";
  text: string;
  at: number;
  agent?: string;
  displayName?: string;
  streaming?: boolean;
  tone?: "neutral" | "good" | "bad";
};

type ChatThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  provider: Provider;
  repo: string;
  branch: string;
  model: string;
  reasoningEffort: string;
  draft: string;
  status: string;
  running: boolean;
  messages: ChatMessage[];
  usedAgents: string[];
  diffStat: string;
  prUrl: string;
  error: string;
};

const STORAGE_KEY = "epia_control_room_chats_v2";
const ACTIVE_CHAT_KEY = "epia_control_room_active_chat_v2";
const COPILOT_FALLBACK: ModelOption[] = [{ id: "auto", displayName: "Auto · Copilot decide" }];

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function titleFromPrompt(prompt: string) {
  const clean = prompt.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean || "Nuevo chat";
}

function defaultThread(provider: Provider = "chatgpt"): ChatThread {
  const now = Date.now();
  return {
    id: nowId("chat"),
    title: "Nuevo chat",
    createdAt: now,
    updatedAt: now,
    provider,
    repo: "rodrico16/equipo-producto-ia",
    branch: "main",
    model: provider === "copilot" ? "auto" : "",
    reasoningEffort: "",
    draft: "",
    status: "Listo para trabajar",
    running: false,
    messages: [],
    usedAgents: [],
    diffStat: "",
    prUrl: "",
    error: "",
  };
}

function chatPreview(chat: ChatThread) {
  const last = [...chat.messages].reverse().find((message) => message.kind !== "system" || message.text);
  if (chat.running) return chat.status || "El equipo está trabajando…";
  if (chat.error) return chat.error;
  return last?.text || "Sin mensajes todavía";
}

function compactTime(timestamp: number) {
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

export default function Home() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [chatGPT, setChatGPT] = useState<ChatGPTState>({ status: "disconnected" });
  const [connectingChatGPT, setConnectingChatGPT] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [copilotModels, setCopilotModels] = useState<ModelOption[]>(COPILOT_FALLBACK);
  const [chatGPTModels, setChatGPTModels] = useState<ModelOption[]>([]);
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [activeChatId, setActiveChatId] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const agentMaps = useRef<Record<string, Record<string, string>>>({});
  const persistTimer = useRef<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/session", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/agents", { cache: "no-store" }).then((response) => response.json()),
    ])
      .then(([sessionData, agentsData]) => {
        setSession(sessionData as SessionState);
        setAgents((agentsData as { agents?: AgentDefinition[] }).agents ?? []);
      })
      .catch(() => setSession({ authenticated: false }));
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const saved = raw ? (JSON.parse(raw) as ChatThread[]) : [];
      const restored = saved
        .filter((chat) => chat && typeof chat.id === "string")
        .slice(0, 30)
        .map((chat) => ({
          ...chat,
          running: false,
          status: chat.running ? "Sesión recuperada · lista para continuar" : chat.status || "Listo para trabajar",
          messages: (chat.messages ?? []).map((message) => ({ ...message, streaming: false })),
        }));
      const next = restored.length ? restored : [defaultThread("chatgpt")];
      setChats(next);
      const requested = window.localStorage.getItem(ACTIVE_CHAT_KEY);
      setActiveChatId(next.some((chat) => chat.id === requested) ? requested! : next[0].id);
    } catch {
      const first = defaultThread("chatgpt");
      setChats([first]);
      setActiveChatId(first.id);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      const safe = chats.slice(0, 30).map((chat) => ({
        ...chat,
        running: false,
        messages: chat.messages.slice(-140).map((message) => ({ ...message, streaming: false })),
      }));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
      if (activeChatId) window.localStorage.setItem(ACTIVE_CHAT_KEY, activeChatId);
    }, 250);
    return () => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
    };
  }, [chats, activeChatId, hydrated]);

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
    if (!session?.authenticated || !session.githubConnected) {
      setCopilotModels(COPILOT_FALLBACK);
      return;
    }
    fetch("/api/models", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        const fetched = Array.isArray(body.models) ? (body.models as ModelOption[]) : [];
        if (!fetched.some((item) => item.id === "auto")) fetched.unshift(COPILOT_FALLBACK[0]);
        setCopilotModels(fetched.length ? fetched : COPILOT_FALLBACK);
      })
      .catch(() => setCopilotModels(COPILOT_FALLBACK));
  }, [session?.authenticated, session?.githubConnected]);

  useEffect(() => {
    if (chatGPT.status !== "connected") {
      setChatGPTModels([]);
      return;
    }
    fetch("/api/chatgpt/models", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => setChatGPTModels(Array.isArray(body.models) ? (body.models as ModelOption[]) : []))
      .catch(() => setChatGPTModels([]));
  }, [chatGPT.status]);

  useEffect(() => {
    setChats((current) => {
      let changed = false;
      const next = current.map((chat) => {
        const catalog = chat.provider === "chatgpt" ? chatGPTModels : copilotModels;
        if (!catalog.length || catalog.some((item) => item.id === chat.model)) return chat;
        const preferred = catalog.find((item) => item.isDefault) ?? catalog[0];
        if (!preferred) return chat;
        changed = true;
        return {
          ...chat,
          model: preferred.id,
          reasoningEffort:
            chat.provider === "chatgpt"
              ? preferred.defaultReasoningEffort || preferred.reasoningEfforts?.[0]?.id || ""
              : "",
        };
      });
      return changed ? next : current;
    });
  }, [chatGPTModels, copilotModels]);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? chats[0],
    [chats, activeChatId],
  );
  const runningCount = chats.filter((chat) => chat.running).length;
  const visibleChats = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!needle) return sorted;
    return sorted.filter(
      (chat) =>
        chat.title.toLowerCase().includes(needle) ||
        chatPreview(chat).toLowerCase().includes(needle) ||
        chat.repo.toLowerCase().includes(needle),
    );
  }, [chats, search]);

  const activeModels = activeChat?.provider === "chatgpt" ? chatGPTModels : copilotModels;
  const selectedModel = activeModels.find((item) => item.id === activeChat?.model);
  const reasoningOptions = selectedModel?.reasoningEfforts ?? [];
  const canSend = Boolean(
    activeChat &&
      activeChat.draft.trim() &&
      !activeChat.running &&
      (activeChat.provider === "copilot" ? session?.githubConnected : chatGPT.status === "connected"),
  );

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeChat?.messages.length, activeChat?.id]);

  function updateChat(id: string, updater: (chat: ChatThread) => ChatThread) {
    setChats((current) => current.map((chat) => (chat.id === id ? updater(chat) : chat)));
  }

  function appendMessage(chatId: string, message: ChatMessage) {
    updateChat(chatId, (chat) => ({
      ...chat,
      messages: [...chat.messages, message].slice(-180),
      updatedAt: Date.now(),
    }));
  }

  function displayNameFor(name: string) {
    return agents.find((agent) => agent.name === name)?.displayName ?? name.replaceAll("_", " ");
  }

  function systemMessage(chatId: string, text: string, tone: ChatMessage["tone"] = "neutral", runId?: string) {
    appendMessage(chatId, {
      id: nowId(runId ? `${runId}-system` : "system"),
      kind: "system",
      text,
      tone,
      at: Date.now(),
    });
  }

  function createChat() {
    const provider: Provider = chatGPT.status === "connected" ? "chatgpt" : session?.githubConnected ? "copilot" : "chatgpt";
    const chat = defaultThread(provider);
    const catalog = provider === "chatgpt" ? chatGPTModels : copilotModels;
    const preferred = catalog.find((item) => item.isDefault) ?? catalog[0];
    if (preferred) {
      chat.model = preferred.id;
      chat.reasoningEffort = preferred.defaultReasoningEffort || preferred.reasoningEfforts?.[0]?.id || "";
    }
    setChats((current) => [chat, ...current]);
    setActiveChatId(chat.id);
    setSettingsOpen(false);
    setMobileListOpen(false);
  }

  function openChat(id: string) {
    setActiveChatId(id);
    setSettingsOpen(false);
    setMobileListOpen(false);
  }

  function deleteChat(id: string) {
    const target = chats.find((chat) => chat.id === id);
    if (target?.running) return;
    const remaining = chats.filter((chat) => chat.id !== id);
    if (!remaining.length) {
      const fresh = defaultThread(chatGPT.status === "connected" ? "chatgpt" : "copilot");
      setChats([fresh]);
      setActiveChatId(fresh.id);
      return;
    }
    setChats(remaining);
    if (activeChatId === id) setActiveChatId(remaining[0].id);
  }

  async function connectChatGPT() {
    setConnectingChatGPT(true);
    setConnectionError("");
    try {
      const response = await fetch("/api/chatgpt/login", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo iniciar el login de ChatGPT");
      setChatGPT(body as ChatGPTState);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : String(error));
    } finally {
      setConnectingChatGPT(false);
    }
  }

  async function disconnectChatGPT() {
    if (runningCount) return;
    await fetch("/api/chatgpt/logout", { method: "POST" }).catch(() => undefined);
    setChatGPT({ status: "disconnected" });
    setChatGPTModels([]);
  }

  function changeProvider(provider: Provider) {
    if (!activeChat || activeChat.running) return;
    if (provider === "copilot" && !session?.githubConnected) return;
    const catalog = provider === "chatgpt" ? chatGPTModels : copilotModels;
    const preferred = catalog.find((item) => item.isDefault) ?? catalog[0];
    updateChat(activeChat.id, (chat) => ({
      ...chat,
      provider,
      model: preferred?.id || (provider === "copilot" ? "auto" : ""),
      reasoningEffort:
        provider === "chatgpt"
          ? preferred?.defaultReasoningEffort || preferred?.reasoningEfforts?.[0]?.id || ""
          : "",
      updatedAt: Date.now(),
    }));
  }

  function changeModel(modelId: string) {
    if (!activeChat) return;
    const option = activeModels.find((item) => item.id === modelId);
    updateChat(activeChat.id, (chat) => ({
      ...chat,
      model: modelId,
      reasoningEffort:
        chat.provider === "chatgpt"
          ? option?.defaultReasoningEffort || option?.reasoningEfforts?.[0]?.id || ""
          : "",
    }));
  }

  function handleEvent(chatId: string, runId: string, provider: Provider, model: string, event: StreamEvent) {
    const data = event.data ?? {};
    const agentId = event.agentId || "supervisor";
    if (!agentMaps.current[chatId]) agentMaps.current[chatId] = { supervisor: "supervisor" };
    const map = agentMaps.current[chatId];

    if (event.type === "control.status") {
      const message = asString(data.message);
      if (message) updateChat(chatId, (chat) => ({ ...chat, status: message, updatedAt: Date.now() }));
      return;
    }

    if (event.type === "team.loaded") {
      systemMessage(chatId, `Equipo cargado · ${String(data.count ?? agents.length)} agentes disponibles`, "good", runId);
      return;
    }

    if (event.type === "run.started") {
      if (!map.supervisor) map.supervisor = "supervisor";
      updateChat(chatId, (chat) => ({
        ...chat,
        usedAgents: chat.usedAgents.includes("supervisor") ? chat.usedAgents : [...chat.usedAgents, "supervisor"],
      }));
      systemMessage(chatId, `Supervisor inició · ${provider === "chatgpt" ? "ChatGPT / Codex" : "GitHub Copilot"} · ${model || "auto"}`, "good", runId);
      return;
    }

    if (event.type === "subagent.selected" || event.type === "subagent.started") {
      const name = asString(data.agentName) || agentId;
      if (event.agentId) map[event.agentId] = name;
      updateChat(chatId, (chat) => ({
        ...chat,
        usedAgents: chat.usedAgents.includes(name) ? chat.usedAgents : [...chat.usedAgents, name],
      }));
      if (event.type === "subagent.started") {
        systemMessage(chatId, `${displayNameFor(name)} empezó a trabajar`, "neutral", runId);
      }
      return;
    }

    if (event.type === "subagent.completed") {
      const name = asString(data.agentName) || map[agentId] || agentId;
      systemMessage(chatId, `${displayNameFor(name)} terminó`, "good", runId);
      return;
    }

    if (event.type === "subagent.failed") {
      const name = asString(data.agentName) || map[agentId] || agentId;
      systemMessage(chatId, `${displayNameFor(name)} falló${asString(data.error) ? ` · ${asString(data.error)}` : ""}`, "bad", runId);
      return;
    }

    if (event.type === "tool.started") {
      const name = map[agentId] || agentId;
      systemMessage(chatId, `${displayNameFor(name)} usa ${asString(data.toolName) || "una herramienta"}`, "neutral", runId);
      return;
    }

    if (event.type === "tool.completed" && data.success === false) {
      const name = map[agentId] || agentId;
      systemMessage(chatId, `Herramienta de ${displayNameFor(name)} falló`, "bad", runId);
      return;
    }

    if (event.type === "agent.delta" || event.type === "agent.message") {
      const name = map[agentId] || agentId;
      const chunk = asString(data.content);
      if (!chunk) return;
      const serverMessageId = asString(data.messageId) || agentId;
      const messageId = `${runId}:message:${serverMessageId}`;
      updateChat(chatId, (chat) => {
        const index = chat.messages.findIndex((message) => message.id === messageId);
        if (index === -1) {
          return {
            ...chat,
            messages: [
              ...chat.messages,
              {
                id: messageId,
                kind: "agent",
                text: chunk,
                at: Date.now(),
                agent: name,
                displayName: displayNameFor(name),
                streaming: event.type === "agent.delta",
              },
            ].slice(-180),
            updatedAt: Date.now(),
          };
        }
        const messages = [...chat.messages];
        const previous = messages[index];
        messages[index] = {
          ...previous,
          agent: name,
          displayName: displayNameFor(name),
          text: event.type === "agent.message" ? chunk : previous.text + chunk,
          streaming: event.type === "agent.delta",
        };
        return { ...chat, messages, updatedAt: Date.now() };
      });
      return;
    }

    if (event.type === "workspace.diff") {
      const diffStat = asString(data.diffStat);
      updateChat(chatId, (chat) => ({ ...chat, diffStat, updatedAt: Date.now() }));
      systemMessage(chatId, diffStat ? `Cambios preparados · ${diffStat.replace(/\n/g, " · ")}` : "Cambios preparados", "good", runId);
      return;
    }

    if (event.type === "run.completed") {
      systemMessage(chatId, "Supervisor cerró la ejecución", "good", runId);
      return;
    }

    if (event.type === "control.done") {
      const prUrl = asString(data.prUrl);
      const diffStat = asString(data.diffStat);
      const branch = asString(data.branch);
      updateChat(chatId, (chat) => ({
        ...chat,
        status: "Ejecución completada",
        running: false,
        prUrl: prUrl || chat.prUrl,
        diffStat: diffStat || chat.diffStat,
        branch: branch || chat.branch,
        error: "",
        updatedAt: Date.now(),
      }));
      systemMessage(chatId, prUrl ? "Ejecución completada · PR listo para revisar" : "Ejecución completada", "good", runId);
      return;
    }

    if (event.type === "control.error" || event.type === "run.failed") {
      const message = asString(data.message) || "La ejecución falló";
      updateChat(chatId, (chat) => ({
        ...chat,
        status: "Ejecución detenida",
        running: false,
        error: message,
        updatedAt: Date.now(),
      }));
      systemMessage(chatId, message, "bad", runId);
    }
  }

  async function startRun(chatId: string) {
    const thread = chats.find((chat) => chat.id === chatId);
    if (!thread || thread.running || !thread.draft.trim()) return;
    if (thread.provider === "chatgpt" && chatGPT.status !== "connected") return;
    if (thread.provider === "copilot" && !session?.githubConnected) return;

    const prompt = thread.draft.trim();
    const runId = nowId("run");
    agentMaps.current[chatId] = { supervisor: "supervisor" };
    const priorContext = thread.messages
      .filter((message) => message.kind === "user" || message.kind === "agent")
      .slice(-12)
      .map((message) => `${message.kind === "user" ? "USUARIO" : message.displayName || "AGENTE"}: ${message.text}`)
      .join("\n\n");
    const requestPrompt = priorContext
      ? `CONTEXTO DEL CHAT:\n${priorContext}\n\nNUEVO PEDIDO DEL USUARIO:\n${prompt}`
      : prompt;

    updateChat(chatId, (chat) => ({
      ...chat,
      title: chat.title === "Nuevo chat" ? titleFromPrompt(prompt) : chat.title,
      draft: "",
      running: true,
      status: "Preparando ejecución…",
      error: "",
      diffStat: "",
      prUrl: "",
      updatedAt: Date.now(),
      messages: [
        ...chat.messages,
        { id: `${runId}:user`, kind: "user", text: prompt, at: Date.now() } as ChatMessage,
      ].slice(-180),
    }));

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          repo: thread.repo,
          branch: thread.branch,
          provider: thread.provider,
          model: thread.model,
          reasoningEffort: thread.reasoningEffort,
          prompt: requestPrompt,
        }),
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
          handleEvent(chatId, runId, thread.provider, thread.model, JSON.parse(valueLine) as StreamEvent);
        }
        if (done) break;
      }
      if (buffer.trim()) handleEvent(chatId, runId, thread.provider, thread.model, JSON.parse(buffer) as StreamEvent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateChat(chatId, (chat) => ({
        ...chat,
        running: false,
        status: "Ejecución detenida",
        error: message,
        updatedAt: Date.now(),
      }));
      systemMessage(chatId, message, "bad", runId);
    } finally {
      updateChat(chatId, (chat) => (chat.running ? { ...chat, running: false, updatedAt: Date.now() } : chat));
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (activeChat && canSend) void startRun(activeChat.id);
    }
  }

  if (session === null || !hydrated) {
    return (
      <main className="loading-screen">
        <div className="brand-mark">AI</div>
        <p>Inicializando tus chats…</p>
      </main>
    );
  }

  if (!session.authenticated) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="eyebrow">AI PRODUCT TEAM</div>
          <h1>Tu equipo de agentes, en conversaciones separadas.</h1>
          <p className="lead">Entrá para ejecutar sesiones privadas con ChatGPT / Codex o GitHub Copilot.</p>
          <a className="github-button" href="/api/auth/github">Continuar con GitHub</a>
        </section>
      </main>
    );
  }

  if (!activeChat) return null;

  return (
    <main className={`chat-app ${mobileListOpen ? "mobile-list-open" : ""}`}>
      <aside className="chat-sidebar">
        <div className="chat-sidebar-top">
          <div className="chat-profile-row">
            <div className="brand-mark small">AI</div>
            <div className="chat-product-name">
              <strong>Product Team</strong>
              <span>{runningCount ? `${runningCount} chat${runningCount > 1 ? "s" : ""} trabajando` : "Control Room"}</span>
            </div>
            <button className="icon-button new-chat-button" type="button" onClick={createChat} aria-label="Nuevo chat">＋</button>
          </div>
          <div className="chat-search-wrap">
            <span>⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar chats" />
          </div>
        </div>

        <div className="thread-list">
          {visibleChats.map((chat) => (
            <div className={`thread-row ${chat.id === activeChat.id ? "active" : ""}`} key={chat.id}>
              <button className="thread-main" type="button" onClick={() => openChat(chat.id)}>
                <span className={`thread-avatar provider-${chat.provider}`}>{chat.provider === "chatgpt" ? "GPT" : "GH"}</span>
                <span className="thread-copy">
                  <span className="thread-line-1">
                    <strong>{chat.title}</strong>
                    <time>{compactTime(chat.updatedAt)}</time>
                  </span>
                  <span className="thread-line-2">
                    {chat.running && <span className="mini-spinner" />}
                    <span className={chat.error ? "thread-error" : ""}>{chatPreview(chat)}</span>
                  </span>
                </span>
              </button>
              {!chat.running && chats.length > 1 && (
                <button className="thread-delete" type="button" onClick={() => deleteChat(chat.id)} aria-label={`Eliminar ${chat.title}`}>×</button>
              )}
            </div>
          ))}
        </div>

        <div className="sidebar-account">
          <div className="sidebar-account-row">
            {session.user?.avatarUrl ? <img src={session.user.avatarUrl} alt="" /> : <span className="avatar-fallback">ME</span>}
            <div>
              <strong>{session.user?.login === "invitado" ? "Sesión privada" : `@${session.user?.login}`}</strong>
              <small>{chatGPT.status === "connected" ? `ChatGPT ${chatGPT.planType || "conectado"}` : "ChatGPT desconectado"}</small>
            </div>
          </div>
          <button className="sidebar-new-chat" type="button" onClick={createChat}>＋ Nuevo chat</button>
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-header">
          <button className="mobile-back" type="button" onClick={() => setMobileListOpen(true)} aria-label="Ver chats">‹</button>
          <span className={`chat-avatar provider-${activeChat.provider}`}>{activeChat.provider === "chatgpt" ? "GPT" : "GH"}</span>
          <div className="chat-heading-copy">
            <strong>{activeChat.title}</strong>
            <span>{activeChat.running ? activeChat.status : `${activeChat.usedAgents.length || 0} agentes participaron · ${activeChat.repo}`}</span>
          </div>
          <div className="chat-header-actions">
            {runningCount > 0 && <span className="parallel-badge">{runningCount} activos</span>}
            <button className={`icon-button ${settingsOpen ? "active" : ""}`} type="button" onClick={() => setSettingsOpen((value) => !value)} aria-label="Configurar chat">⚙</button>
            <button className="icon-button desktop-new" type="button" onClick={createChat} aria-label="Nuevo chat">＋</button>
          </div>
        </header>

        {settingsOpen && (
          <div className="chat-settings-panel">
            <div className="settings-title-row">
              <div><strong>Configuración de este chat</strong><small>Cada conversación conserva su propia configuración.</small></div>
              <button className="icon-button" type="button" onClick={() => setSettingsOpen(false)}>×</button>
            </div>

            <div className="provider-tabs">
              <button type="button" className={activeChat.provider === "chatgpt" ? "active" : ""} onClick={() => changeProvider("chatgpt")} disabled={activeChat.running}>
                ChatGPT / Codex
              </button>
              <button type="button" className={activeChat.provider === "copilot" ? "active" : ""} onClick={() => changeProvider("copilot")} disabled={activeChat.running || !session.githubConnected}>
                GitHub Copilot
              </button>
            </div>

            {activeChat.provider === "chatgpt" && (
              <div className={`connection-strip status-${chatGPT.status}`}>
                <div>
                  <strong>{chatGPT.status === "connected" ? "ChatGPT conectado" : chatGPT.status === "pending" ? "Esperando autorización" : "Conectar ChatGPT"}</strong>
                  <small>{chatGPT.status === "connected" ? `${chatGPT.planType || "Plan ChatGPT"}${chatGPT.email ? ` · ${chatGPT.email}` : ""}` : "La sesión se mantiene del lado servidor en Vercel."}</small>
                </div>
                {chatGPT.status === "connected" ? (
                  <button type="button" onClick={disconnectChatGPT} disabled={Boolean(runningCount)}>Desconectar</button>
                ) : chatGPT.status === "pending" ? (
                  <div className="device-code-inline"><code>{chatGPT.userCode}</code>{chatGPT.verificationUrl && <a href={chatGPT.verificationUrl} target="_blank" rel="noreferrer">Abrir ↗</a>}</div>
                ) : (
                  <button type="button" onClick={connectChatGPT} disabled={connectingChatGPT}>{connectingChatGPT ? "Conectando…" : "Conectar"}</button>
                )}
              </div>
            )}
            {connectionError && <div className="settings-error">{connectionError}</div>}

            <div className="settings-grid">
              <label>
                Repositorio
                <input value={activeChat.repo} onChange={(event) => updateChat(activeChat.id, (chat) => ({ ...chat, repo: event.target.value }))} disabled={activeChat.running} />
              </label>
              <label>
                Rama base
                <input value={activeChat.branch} onChange={(event) => updateChat(activeChat.id, (chat) => ({ ...chat, branch: event.target.value }))} disabled={activeChat.running} />
              </label>
              <label>
                Modelo
                <select value={activeChat.model} onChange={(event) => changeModel(event.target.value)} disabled={activeChat.running || !activeModels.length}>
                  {!activeModels.length && <option value="">Sin modelos disponibles</option>}
                  {activeModels.map((item) => <option key={item.id} value={item.id}>{item.displayName || item.name || item.id}</option>)}
                </select>
              </label>
              {activeChat.provider === "chatgpt" && reasoningOptions.length > 0 && (
                <label>
                  Razonamiento
                  <select value={activeChat.reasoningEffort} onChange={(event) => updateChat(activeChat.id, (chat) => ({ ...chat, reasoningEffort: event.target.value }))} disabled={activeChat.running}>
                    {reasoningOptions.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="settings-policy"><span>Sandbox aislado</span><span>Chats paralelos</span><span>Sin merge automático</span></div>
          </div>
        )}

        <div className="messages-scroll">
          {!activeChat.messages.length ? (
            <div className="chat-welcome">
              <div className="welcome-icon">AI</div>
              <h1>Nuevo chat</h1>
              <p>Escribí un objetivo. El supervisor va a convocar los agentes necesarios y vas a ver la conversación como un chat.</p>
              <div className="welcome-pills"><span>{agents.length} agentes disponibles</span><span>{activeChat.provider === "chatgpt" ? "ChatGPT / Codex" : "GitHub Copilot"}</span></div>
            </div>
          ) : (
            <div className="message-stack">
              {activeChat.messages.map((message) => {
                if (message.kind === "system") {
                  return <div className={`system-bubble tone-${message.tone || "neutral"}`} key={message.id}>{message.text}</div>;
                }
                if (message.kind === "user") {
                  return (
                    <div className="bubble-row user-row" key={message.id}>
                      <article className="message-bubble user-bubble">
                        <div>{message.text}</div>
                        <time>{compactTime(message.at)}</time>
                      </article>
                    </div>
                  );
                }
                return (
                  <div className="bubble-row agent-row" key={message.id}>
                    <span className="message-avatar">{(message.displayName || "A").slice(0, 1).toUpperCase()}</span>
                    <article className={`message-bubble agent-bubble ${message.agent === "supervisor" ? "supervisor-bubble" : ""}`}>
                      <div className="bubble-author-row">
                        <strong>{message.displayName || message.agent}</strong>
                        {message.streaming && <span className="typing-label">escribiendo…</span>}
                      </div>
                      <MessageResponse>{message.text}</MessageResponse>
                      <time>{compactTime(message.at)}</time>
                    </article>
                  </div>
                );
              })}
              {(activeChat.prUrl || activeChat.diffStat) && (
                <div className="delivery-card">
                  <strong>{activeChat.prUrl ? "Entrega lista" : "Cambios preparados"}</strong>
                  {activeChat.diffStat && <pre>{activeChat.diffStat}</pre>}
                  {activeChat.prUrl && <a href={activeChat.prUrl} target="_blank" rel="noreferrer">Abrir Pull Request ↗</a>}
                </div>
              )}
              <div ref={transcriptEnd} />
            </div>
          )}
        </div>

        <footer className="composer-shell">
          {activeChat.running && (
            <div className="running-strip"><span className="mini-spinner" /><span>{activeChat.status}</span><button type="button" onClick={createChat}>Abrir otro chat</button></div>
          )}
          {activeChat.provider === "chatgpt" && chatGPT.status !== "connected" && (
            <div className="composer-warning">Conectá ChatGPT desde ⚙ para enviar mensajes en este chat.</div>
          )}
          {activeChat.provider === "copilot" && !session.githubConnected && (
            <div className="composer-warning">Conectá GitHub para usar Copilot en este chat.</div>
          )}
          <div className="composer">
            <button className="composer-plus" type="button" onClick={() => setSettingsOpen(true)} aria-label="Configuración">＋</button>
            <textarea
              value={activeChat.draft}
              onChange={(event) => updateChat(activeChat.id, (chat) => ({ ...chat, draft: event.target.value }))}
              onKeyDown={onComposerKeyDown}
              placeholder={activeChat.running ? "Este chat está trabajando. Podés abrir otro en paralelo…" : "Escribí un objetivo…"}
              disabled={activeChat.running}
              rows={1}
            />
            <button className="send-button" type="button" onClick={() => void startRun(activeChat.id)} disabled={!canSend} aria-label="Enviar">➤</button>
          </div>
          <div className="composer-footnote">Enter para enviar · Shift+Enter para nueva línea</div>
        </footer>
      </section>
    </main>
  );
}
