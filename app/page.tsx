"use client";

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import s from "./page.module.css";

type Provider = "chatgpt" | "copilot";
type ChatMode = "chat" | "draft" | "pr";
type ChatFilter = "all" | "running" | "error" | "pr" | "repo" | "copilot" | "chatgpt";

type SessionState = {
  authenticated: boolean;
  mode?: "guest" | "github";
  githubConnected?: boolean;
  githubConfigured?: boolean;
  user?: { login: string; avatarUrl?: string | null };
};
type ReasoningOption = { id: string; description?: string };
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
type AgentDefinition = { name: string; displayName: string; description: string; supervisor?: boolean };
type GitHubRepo = {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  owner: string;
  ownerAvatar?: string | null;
  canPush: boolean;
};
type StreamEvent = { type: string; agentId?: string; data?: Record<string, unknown> };
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
  mode: ChatMode;
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
type TimelineItem =
  | { type: "message"; id: string; message: ChatMessage }
  | { type: "tools"; id: string; messages: ChatMessage[] };

const STORAGE_KEY = "epia_control_room_chats_v3";
const ACTIVE_KEY = "epia_control_room_active_chat_v3";
const COPILOT_FALLBACK: ModelOption[] = [{ id: "auto", displayName: "Auto · Copilot decide" }];
const FILTERS: { id: ChatFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "running", label: "Activos" },
  { id: "error", label: "Con error" },
  { id: "pr", label: "Con PR" },
  { id: "repo", label: "Repos" },
  { id: "copilot", label: "Copilot" },
  { id: "chatgpt", label: "ChatGPT" },
];

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}
function titleFromPrompt(prompt: string) {
  const clean = prompt.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean || "Nuevo chat";
}
function time(ts: number) {
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(ts);
}
function defaultChat(): ChatThread {
  const now = Date.now();
  return {
    id: id("chat"), title: "Nuevo chat", createdAt: now, updatedAt: now,
    mode: "chat", provider: "chatgpt", repo: "", branch: "main", model: "", reasoningEffort: "",
    draft: "", status: "Listo para trabajar", running: false, messages: [], usedAgents: [], diffStat: "", prUrl: "", error: "",
  };
}
function preview(chat: ChatThread) {
  if (chat.running) return chat.status || "El equipo está trabajando…";
  if (chat.error) return chat.error;
  const last = [...chat.messages].reverse().find((m) => m.text);
  return last?.text || "Sin mensajes todavía";
}
function modeLabel(mode: ChatMode) {
  if (mode === "pr") return "Repo + PR";
  if (mode === "draft") return "Repo · borrador";
  return "Solo chat";
}
function isToolMessage(message: ChatMessage) {
  return message.kind === "system" && (message.text.includes(" usa ") || message.text.startsWith("Herramienta de "));
}
function toolOwner(text: string) {
  if (text.includes(" usa ")) return text.split(" usa ")[0];
  const match = text.match(/^Herramienta de (.+?) falló/);
  return match?.[1] || "Equipo";
}
function buildTimeline(messages: ChatMessage[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let bucket: ChatMessage[] = [];
  const flush = () => {
    if (!bucket.length) return;
    items.push({ type: "tools", id: `tools-${bucket[0].id}`, messages: bucket });
    bucket = [];
  };
  for (const message of messages) {
    if (isToolMessage(message)) {
      bucket.push(message);
      continue;
    }
    flush();
    items.push({ type: "message", id: message.id, message });
  }
  flush();
  return items;
}

export default function Home() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [chatGPT, setChatGPT] = useState<ChatGPTState>({ status: "disconnected" });
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [chatGPTModels, setChatGPTModels] = useState<ModelOption[]>([]);
  const [copilotModels, setCopilotModels] = useState<ModelOption[]>(COPILOT_FALLBACK);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState("");
  const [createRepoOpen, setCreateRepoOpen] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [creatingRepo, setCreatingRepo] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [connectingChatGPT, setConnectingChatGPT] = useState(false);
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [activeId, setActiveId] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newChatWizard, setNewChatWizard] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const agentMaps = useRef<Record<string, Record<string, string>>>({});

  useEffect(() => {
    Promise.all([
      fetch("/api/session", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/agents", { cache: "no-store" }).then((r) => r.json()),
    ]).then(([sessionBody, agentsBody]) => {
      setSession(sessionBody as SessionState);
      setAgents((agentsBody as { agents?: AgentDefinition[] }).agents ?? []);
    }).catch(() => setSession({ authenticated: true, mode: "guest", githubConnected: false }));
  }, []);

  useEffect(() => {
    if (window.matchMedia("(max-width: 840px)").matches) setMobileListOpen(true);
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as ChatThread[];
      const restored = saved.filter((chat) => chat?.id).slice(0, 30).map((chat) => ({
        ...defaultChat(), ...chat, running: false,
        mode: chat.mode || (chat.repo ? "pr" : "chat"),
        messages: (chat.messages || []).map((m) => ({ ...m, streaming: false })),
      }));
      const next = restored.length ? restored : [defaultChat()];
      setChats(next);
      const wanted = localStorage.getItem(ACTIVE_KEY);
      setActiveId(next.some((chat) => chat.id === wanted) ? wanted! : next[0].id);
    } catch {
      const first = defaultChat();
      setChats([first]); setActiveId(first.id);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const safe = chats.slice(0, 30).map((chat) => ({
      ...chat, running: false,
      messages: chat.messages.slice(-160).map((m) => ({ ...m, streaming: false })),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [chats, activeId, hydrated]);

  useEffect(() => {
    if (!session?.authenticated) return;
    fetch("/api/chatgpt/status", { cache: "no-store" }).then((r) => r.json()).then((body) => setChatGPT(body as ChatGPTState)).catch(() => undefined);
  }, [session?.authenticated]);

  useEffect(() => {
    if (chatGPT.status !== "pending") return;
    const timer = window.setInterval(() => {
      fetch("/api/chatgpt/status", { cache: "no-store" }).then((r) => r.json()).then((body) => setChatGPT(body as ChatGPTState)).catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [chatGPT.status]);

  useEffect(() => {
    if (chatGPT.status !== "connected") { setChatGPTModels([]); return; }
    fetch("/api/chatgpt/models", { cache: "no-store" }).then((r) => r.json()).then((body) => {
      setChatGPTModels(Array.isArray(body.models) ? body.models as ModelOption[] : []);
    }).catch(() => setChatGPTModels([]));
  }, [chatGPT.status]);

  useEffect(() => {
    if (!session?.githubConnected) { setCopilotModels(COPILOT_FALLBACK); setRepos([]); return; }
    void syncRepos();
    fetch("/api/models", { cache: "no-store" }).then((r) => r.json()).then((body) => {
      const models = Array.isArray(body.models) ? body.models as ModelOption[] : [];
      if (!models.some((m) => m.id === "auto")) models.unshift(COPILOT_FALLBACK[0]);
      setCopilotModels(models.length ? models : COPILOT_FALLBACK);
    }).catch(() => setCopilotModels(COPILOT_FALLBACK));
  }, [session?.githubConnected]);

  useEffect(() => {
    if (!chatGPTModels.length) return;
    setChats((current) => current.map((chat) => {
      if (chat.provider !== "chatgpt" || chatGPTModels.some((m) => m.id === chat.model)) return chat;
      const preferred = chatGPTModels.find((m) => m.isDefault) ?? chatGPTModels[0];
      return { ...chat, model: preferred.id, reasoningEffort: preferred.defaultReasoningEffort || preferred.reasoningEfforts?.[0]?.id || "" };
    }));
  }, [chatGPTModels]);

  useEffect(() => {
    if (!session?.githubConnected || !copilotModels.length) return;
    const preferred = copilotModels.find((m) => m.isDefault) ?? copilotModels[0];
    setChats((current) => current.map((chat) => {
      if (chat.provider !== "copilot" || copilotModels.some((m) => m.id === chat.model)) return chat;
      return { ...chat, model: preferred.id, reasoningEffort: preferred.defaultReasoningEffort || preferred.reasoningEfforts?.[0]?.id || "" };
    }));
  }, [session?.githubConnected, copilotModels]);

  useEffect(() => {
    if (!session?.githubConnected || chatGPT.status === "connected" || !copilotModels.length) return;
    const preferred = copilotModels.find((m) => m.isDefault) ?? copilotModels[0];
    setChats((current) => current.map((chat) => {
      if (chat.provider !== "chatgpt" || chat.messages.length || chat.title !== "Nuevo chat") return chat;
      return {
        ...chat,
        provider: "copilot",
        model: preferred.id,
        reasoningEffort: preferred.defaultReasoningEffort || preferred.reasoningEfforts?.[0]?.id || "",
      };
    }));
  }, [session?.githubConnected, chatGPT.status, copilotModels]);

  const active = useMemo(() => chats.find((chat) => chat.id === activeId) ?? chats[0], [chats, activeId]);
  const runningCount = chats.filter((chat) => chat.running).length;
  const visibleChats = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...chats]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((chat) => !needle || `${chat.title} ${preview(chat)} ${chat.repo} ${chat.provider}`.toLowerCase().includes(needle))
      .filter((chat) => {
        if (filter === "running") return chat.running;
        if (filter === "error") return Boolean(chat.error);
        if (filter === "pr") return Boolean(chat.prUrl) || chat.mode === "pr";
        if (filter === "repo") return chat.mode !== "chat";
        if (filter === "copilot") return chat.provider === "copilot";
        if (filter === "chatgpt") return chat.provider === "chatgpt";
        return true;
      });
  }, [chats, search, filter]);
  const activeModels = active?.provider === "copilot" ? copilotModels : chatGPTModels;
  const selectedModel = activeModels.find((m) => m.id === active?.model);
  const reasoning = selectedModel?.reasoningEfforts ?? [];
  const selectedRepo = repos.find((repo) => repo.fullName === active?.repo);
  const timeline = useMemo(() => buildTimeline(active?.messages ?? []), [active?.messages]);
  const canSend = Boolean(active && active.draft.trim() && !active.running && (
    active.provider === "chatgpt" ? chatGPT.status === "connected" : session?.githubConnected
  ) && (active.mode === "chat" || Boolean(active.repo)) && (active.mode !== "pr" || session?.githubConnected));

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [active?.messages.length, active?.id]);

  function updateChat(chatId: string, fn: (chat: ChatThread) => ChatThread) {
    setChats((current) => current.map((chat) => chat.id === chatId ? fn(chat) : chat));
  }
  function append(chatId: string, message: ChatMessage) {
    updateChat(chatId, (chat) => ({ ...chat, messages: [...chat.messages, message].slice(-200), updatedAt: Date.now() }));
  }
  function system(chatId: string, text: string, tone: ChatMessage["tone"] = "neutral", runId?: string) {
    append(chatId, { id: id(runId ? `${runId}-sys` : "sys"), kind: "system", text, tone, at: Date.now() });
  }
  function displayName(name: string) {
    return agents.find((agent) => agent.name === name)?.displayName ?? name.replaceAll("_", " ");
  }

  async function syncRepos() {
    setRepoLoading(true); setRepoError("");
    try {
      const response = await fetch("/api/github/repos", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudieron sincronizar los repos");
      setRepos(Array.isArray(body.repos) ? body.repos as GitHubRepo[] : []);
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : String(error));
    } finally { setRepoLoading(false); }
  }

  async function createRepository() {
    if (!newRepoName.trim()) return;
    setCreatingRepo(true); setRepoError("");
    try {
      const response = await fetch("/api/github/repos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newRepoName.trim(), private: newRepoPrivate }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo crear el repo");
      const repo = body.repo as GitHubRepo;
      setRepos((current) => [repo, ...current.filter((item) => item.id !== repo.id)]);
      if (active) updateChat(active.id, (chat) => ({ ...chat, repo: repo.fullName, branch: repo.defaultBranch, updatedAt: Date.now() }));
      setNewRepoName(""); setCreateRepoOpen(false);
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : String(error));
    } finally { setCreatingRepo(false); }
  }

  async function connectChatGPT() {
    setConnectingChatGPT(true); setConnectionError("");
    try {
      const response = await fetch("/api/chatgpt/login", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo iniciar el login");
      setChatGPT(body as ChatGPTState);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : String(error));
    } finally { setConnectingChatGPT(false); }
  }

  async function switchGitHubAccount() {
    await fetch("/api/auth/logout", { method: "POST", redirect: "follow" }).catch(() => undefined);
    window.location.href = "/api/auth/github";
  }

  async function disconnectGitHub() {
    await fetch("/api/auth/logout", { method: "POST", redirect: "follow" }).catch(() => undefined);
    window.location.reload();
  }

  function createChat() {
    const chat = defaultChat();
    const useCopilot = Boolean(session?.githubConnected && chatGPT.status !== "connected");
    const catalog = useCopilot ? copilotModels : chatGPTModels;
    chat.provider = useCopilot ? "copilot" : "chatgpt";
    if (catalog.length) {
      const preferred = catalog.find((m) => m.isDefault) ?? catalog[0];
      chat.model = preferred.id;
      chat.reasoningEffort = preferred.defaultReasoningEffort || preferred.reasoningEfforts?.[0]?.id || "";
    } else if (useCopilot) {
      chat.model = "auto";
    }
    setChats((current) => [chat, ...current]);
    setActiveId(chat.id);
    setNewChatWizard(true);
    setSettingsOpen(true);
    setMobileListOpen(false);
  }
  function openChat(chatId: string) {
    setActiveId(chatId); setMobileListOpen(false); setSettingsOpen(false); setNewChatWizard(false);
  }
  function deleteChat(chatId: string) {
    const target = chats.find((chat) => chat.id === chatId);
    if (target?.running) return;
    const next = chats.filter((chat) => chat.id !== chatId);
    if (!next.length) {
      const fresh = defaultChat(); setChats([fresh]); setActiveId(fresh.id); return;
    }
    setChats(next); if (activeId === chatId) setActiveId(next[0].id);
  }
  function changeMode(mode: ChatMode) {
    if (!active || active.running) return;
    updateChat(active.id, (chat) => ({
      ...chat, mode,
      provider: chat.provider === "copilot" && !session?.githubConnected ? "chatgpt" : chat.provider,
      repo: mode === "chat" ? "" : chat.repo,
      branch: mode === "chat" ? "main" : chat.branch,
      updatedAt: Date.now(),
    }));
  }
  function changeProvider(provider: Provider) {
    if (!active || active.running) return;
    if (provider === "copilot" && !session?.githubConnected) return;
    const catalog = provider === "copilot" ? copilotModels : chatGPTModels;
    const preferred = catalog.find((m) => m.isDefault) ?? catalog[0];
    updateChat(active.id, (chat) => ({
      ...chat, provider, model: preferred?.id || (provider === "copilot" ? "auto" : ""),
      reasoningEffort: preferred?.defaultReasoningEffort || preferred?.reasoningEfforts?.[0]?.id || "",
    }));
  }
  function changeModel(modelId: string) {
    if (!active) return;
    const option = activeModels.find((m) => m.id === modelId);
    updateChat(active.id, (chat) => ({
      ...chat, model: modelId,
      reasoningEffort: option?.defaultReasoningEffort || option?.reasoningEfforts?.[0]?.id || "",
    }));
  }
  function changeRepo(fullName: string) {
    if (!active) return;
    const repo = repos.find((item) => item.fullName === fullName);
    updateChat(active.id, (chat) => ({ ...chat, repo: fullName, branch: repo?.defaultBranch || "main", updatedAt: Date.now() }));
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
    if (event.type === "team.loaded") { system(chatId, `Equipo cargado · ${String(data.count ?? agents.length)} agentes disponibles`, "good", runId); return; }
    if (event.type === "run.started") {
      updateChat(chatId, (chat) => ({ ...chat, usedAgents: chat.usedAgents.includes("supervisor") ? chat.usedAgents : [...chat.usedAgents, "supervisor"] }));
      system(chatId, `Supervisor inició · ${provider === "chatgpt" ? "ChatGPT / Codex" : "GitHub Copilot"} · ${model || "auto"}`, "good", runId);
      return;
    }
    if (event.type === "subagent.started" || event.type === "subagent.selected") {
      const name = asString(data.agentName) || agentId;
      if (event.agentId) map[event.agentId] = name;
      updateChat(chatId, (chat) => ({ ...chat, usedAgents: chat.usedAgents.includes(name) ? chat.usedAgents : [...chat.usedAgents, name] }));
      if (event.type === "subagent.started") system(chatId, `${displayName(name)} empezó a trabajar`, "neutral", runId);
      return;
    }
    if (event.type === "subagent.completed") { const name = asString(data.agentName) || map[agentId] || agentId; system(chatId, `${displayName(name)} terminó`, "good", runId); return; }
    if (event.type === "subagent.failed") { const name = asString(data.agentName) || map[agentId] || agentId; system(chatId, `${displayName(name)} falló`, "bad", runId); return; }
    if (event.type === "tool.started") { const name = map[agentId] || agentId; system(chatId, `${displayName(name)} usa ${asString(data.toolName) || "una herramienta"}`, "neutral", runId); return; }
    if (event.type === "tool.completed" && data.success === false) { const name = map[agentId] || agentId; system(chatId, `Herramienta de ${displayName(name)} falló`, "bad", runId); return; }
    if (event.type === "agent.delta" || event.type === "agent.message") {
      const name = map[agentId] || agentId;
      const chunk = asString(data.content); if (!chunk) return;
      const messageId = `${runId}:${asString(data.messageId) || agentId}`;
      updateChat(chatId, (chat) => {
        const index = chat.messages.findIndex((m) => m.id === messageId);
        if (index < 0) {
          const next: ChatMessage = { id: messageId, kind: "agent", text: chunk, at: Date.now(), agent: name, displayName: displayName(name), streaming: event.type === "agent.delta" };
          return { ...chat, messages: [...chat.messages, next].slice(-200), updatedAt: Date.now() };
        }
        const messages = [...chat.messages];
        const previous = messages[index];
        messages[index] = { ...previous, text: event.type === "agent.message" ? chunk : previous.text + chunk, streaming: event.type === "agent.delta", agent: name, displayName: displayName(name) };
        return { ...chat, messages, updatedAt: Date.now() };
      });
      return;
    }
    if (event.type === "workspace.diff") {
      const diffStat = asString(data.diffStat);
      updateChat(chatId, (chat) => ({ ...chat, diffStat, updatedAt: Date.now() }));
      system(chatId, diffStat ? `Cambios preparados · ${diffStat.replace(/\n/g, " · ")}` : "Cambios preparados", "good", runId);
      return;
    }
    if (event.type === "run.completed") { system(chatId, "Supervisor cerró la ejecución", "good", runId); return; }
    if (event.type === "control.done") {
      const prUrl = asString(data.prUrl);
      const diffStat = asString(data.diffStat);
      updateChat(chatId, (chat) => ({ ...chat, running: false, status: "Ejecución completada", prUrl: prUrl || chat.prUrl, diffStat: diffStat || chat.diffStat, error: "", updatedAt: Date.now() }));
      system(chatId, prUrl ? "Ejecución completada · PR listo para revisar" : "Ejecución completada", "good", runId);
      return;
    }
    if (event.type === "control.error" || event.type === "run.failed") {
      const message = asString(data.message) || "La ejecución falló";
      updateChat(chatId, (chat) => ({ ...chat, running: false, status: "Ejecución detenida", error: message, updatedAt: Date.now() }));
      system(chatId, message, "bad", runId);
    }
  }

  async function startRun(chatId: string) {
    const thread = chats.find((chat) => chat.id === chatId);
    if (!thread || thread.running || !thread.draft.trim()) return;
    if (thread.provider === "chatgpt" && chatGPT.status !== "connected") return;
    if (thread.provider === "copilot" && !session?.githubConnected) return;
    if (thread.mode !== "chat" && !thread.repo) return;
    if (thread.mode === "pr" && !session?.githubConnected) return;

    const prompt = thread.draft.trim();
    const runId = id("run");
    agentMaps.current[chatId] = { supervisor: "supervisor" };
    const context = thread.messages.filter((m) => m.kind === "user" || m.kind === "agent").slice(-12)
      .map((m) => `${m.kind === "user" ? "USUARIO" : m.displayName || "AGENTE"}: ${m.text}`).join("\n\n");
    const requestPrompt = context ? `CONTEXTO DEL CHAT:\n${context}\n\nNUEVO PEDIDO DEL USUARIO:\n${prompt}` : prompt;

    updateChat(chatId, (chat) => ({
      ...chat, title: chat.title === "Nuevo chat" ? titleFromPrompt(prompt) : chat.title,
      draft: "", running: true, status: "Preparando ejecución…", error: "", diffStat: "", prUrl: "", updatedAt: Date.now(),
      messages: [...chat.messages, { id: `${runId}:user`, kind: "user", text: prompt, at: Date.now() } as ChatMessage].slice(-200),
    }));

    try {
      const endpoint = thread.mode === "pr"
        ? "/api/run"
        : thread.provider === "copilot"
          ? "/api/copilot-run"
          : "/api/chat-run";
      const payload = thread.mode === "pr"
        ? { repo: thread.repo, branch: thread.branch, provider: thread.provider, model: thread.model, reasoningEffort: thread.reasoningEffort, prompt: requestPrompt }
        : { mode: thread.mode, repo: thread.repo, branch: thread.branch, model: thread.model, reasoningEffort: thread.reasoningEffort, prompt: requestPrompt };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) if (raw.trim()) handleEvent(chatId, runId, thread.provider, thread.model, JSON.parse(raw) as StreamEvent);
        if (done) break;
      }
      if (buffer.trim()) handleEvent(chatId, runId, thread.provider, thread.model, JSON.parse(buffer) as StreamEvent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateChat(chatId, (chat) => ({ ...chat, running: false, status: "Ejecución detenida", error: message, updatedAt: Date.now() }));
      system(chatId, message, "bad", runId);
    } finally {
      updateChat(chatId, (chat) => chat.running ? { ...chat, running: false, updatedAt: Date.now() } : chat);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (active && canSend) void startRun(active.id);
    }
  }

  if (!hydrated || !session) return <main className="loading-screen"><div className="brand-mark">AI</div><p>Inicializando chats…</p></main>;
  if (!active) return null;

  const chatGPTConnected = chatGPT.status === "connected";
  const githubConnected = Boolean(session.githubConnected);
  const repoMode = active.mode !== "chat";
  const copilotAvailable = githubConnected;

  return (
    <main className={`${s.app} ${mobileListOpen ? s.showList : ""}`}>
      <aside className={s.sidebar}>
        <div className={s.sidebarTop}>
          <div className={s.listHeader}>
            <button className={s.circleButton} onClick={() => { setNewChatWizard(false); setSettingsOpen(true); }} aria-label="Cuenta y conexiones">•••</button>
            <h1>Chats</h1>
            <div className={s.listHeaderActions}>
              <button className={`${s.connectionDot} ${githubConnected || chatGPTConnected ? s.connectionDotOn : ""}`} onClick={() => { setNewChatWizard(false); setSettingsOpen(true); }} aria-label="Conexiones">◎</button>
              <button className={s.addChatButton} onClick={createChat} aria-label="Nuevo chat">＋</button>
            </div>
          </div>
          <label className={s.search}><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar chats o preguntar" /></label>
          <div className={s.filters}>
            {FILTERS.map((item) => <button key={item.id} className={filter === item.id ? s.filterActive : ""} onClick={() => setFilter(item.id)}>{item.label}</button>)}
          </div>
        </div>

        <div className={s.threadList}>
          {!visibleChats.length && <div className={s.emptyList}><strong>No hay chats acá</strong><span>Probá otro filtro o empezá una conversación nueva.</span><button onClick={createChat}>＋ Nuevo chat</button></div>}
          {visibleChats.map((chat) => {
            const meta = [chat.provider === "copilot" ? "Copilot" : "ChatGPT", modeLabel(chat.mode), chat.repo].filter(Boolean).join(" · ");
            return (
              <div className={`${s.thread} ${chat.id === active.id ? s.threadActive : ""}`} key={chat.id}>
                <button className={s.threadMain} onClick={() => openChat(chat.id)}>
                  <span className={`${s.threadAvatar} ${chat.provider === "copilot" ? s.avatarCopilot : s.avatarGpt}`}>{chat.provider === "copilot" ? "GH" : "GPT"}</span>
                  <span className={s.threadBody}>
                    <span className={s.threadTitleRow}><strong>{chat.title}</strong><time>{time(chat.updatedAt)}</time></span>
                    <span className={s.threadPreview}>{chat.running && <span className={s.spinner} />}<span>{preview(chat)}</span></span>
                    <span className={s.threadMeta}>{meta}</span>
                  </span>
                  {(chat.running || chat.error || chat.prUrl) && <span className={`${s.threadState} ${chat.error ? s.stateError : chat.running ? s.stateRunning : s.stateDone}`}>{chat.error ? "!" : chat.running ? "●" : "PR"}</span>}
                </button>
                {!chat.running && chats.length > 1 && <button className={s.threadDelete} onClick={() => deleteChat(chat.id)} aria-label="Eliminar chat">×</button>}
              </div>
            );
          })}
        </div>

        <div className={s.accountBar}>
          <button className={s.accountButton} onClick={() => { setNewChatWizard(false); setSettingsOpen(true); }}>
            {session.user?.avatarUrl ? <img src={session.user.avatarUrl} alt="" /> : <span className={s.accountFallback}>AI</span>}
            <span><strong>{githubConnected ? `@${session.user?.login}` : "Conexiones"}</strong><small>{githubConnected && chatGPTConnected ? "GitHub + ChatGPT" : githubConnected ? "Copilot disponible" : chatGPTConnected ? "ChatGPT conectado" : "Configurar cuentas"}</small></span>
          </button>
          <button className={s.tabActive}>Chats{runningCount ? <b>{runningCount}</b> : null}</button>
        </div>
      </aside>

      <section className={s.main}>
        <header className={s.header}>
          <button className={s.mobileBack} onClick={() => setMobileListOpen(true)} aria-label="Volver a chats">‹</button>
          <span className={`${s.chatAvatar} ${active.provider === "copilot" ? s.avatarCopilot : s.avatarGpt}`}>{active.provider === "copilot" ? "GH" : "GPT"}</span>
          <button className={s.headerCopy} onClick={() => { setNewChatWizard(false); setSettingsOpen(true); }}>
            <strong>{active.title}</strong>
            <span>{active.running ? active.status : active.repo || `${active.usedAgents.length || 1} agente${active.usedAgents.length === 1 ? "" : "s"} · ${active.provider === "copilot" ? "Copilot" : "ChatGPT"}`}</span>
          </button>
          <div className={s.headerActions}>
            <button className={s.iconButton} onClick={() => { setNewChatWizard(false); setSettingsOpen(true); }} aria-label="Configurar chat">⚙</button>
            <button className={s.iconButton} onClick={createChat} aria-label="Nuevo chat">＋</button>
          </div>
        </header>

        <div className={s.contextBar}>
          <button className={s.contextChip} onClick={() => { setNewChatWizard(false); setSettingsOpen(true); }}><strong>{modeLabel(active.mode)}</strong></button>
          <button className={s.contextChip} onClick={() => { setNewChatWizard(false); setSettingsOpen(true); }}>{active.provider === "chatgpt" ? "ChatGPT" : "Copilot"} · <strong>{selectedModel?.displayName || selectedModel?.name || active.model || "modelo"}</strong></button>
          {active.reasoningEffort && <button className={s.contextChip} onClick={() => { setNewChatWizard(false); setSettingsOpen(true); }}>esfuerzo · <strong>{active.reasoningEffort}</strong></button>}
          {repoMode && <button className={s.contextChip} onClick={() => { setNewChatWizard(false); setSettingsOpen(true); }}>repo · <strong>{active.repo || "elegir"}</strong></button>}
        </div>

        <div className={s.messages}>
          {!active.messages.length ? (
            <div className={s.welcome}>
              <div className={`${s.welcomeMark} ${active.provider === "copilot" ? s.avatarCopilot : s.avatarGpt}`}>{active.provider === "copilot" ? "GH" : "GPT"}</div>
              <h1>Empezá una conversación</h1>
              <p>Pedile al equipo que analice, diseñe o construya. La configuración técnica queda guardada dentro de este chat.</p>
              <div className={s.quickPrompts}>
                <button onClick={() => updateChat(active.id, (chat) => ({ ...chat, draft: "Revisá el proyecto y proponé las mejoras de mayor impacto." }))}>Revisar proyecto</button>
                <button onClick={() => updateChat(active.id, (chat) => ({ ...chat, draft: "Analizá la UX actual y proponé una experiencia más simple y clara." }))}>Mejorar UX</button>
                <button onClick={() => updateChat(active.id, (chat) => ({ ...chat, draft: "Implementá el próximo cambio prioritario, validalo y resumí el resultado." }))}>Implementar cambio</button>
              </div>
            </div>
          ) : (
            <div className={s.stack}>
              {timeline.map((item) => {
                if (item.type === "tools") {
                  const owners = Array.from(new Set(item.messages.map((m) => toolOwner(m.text))));
                  const failed = item.messages.some((m) => m.tone === "bad" || m.text.includes("falló"));
                  const label = owners.length === 1 ? `${owners[0]} usó ${item.messages.length} herramienta${item.messages.length === 1 ? "" : "s"}` : `${owners.length} agentes usaron ${item.messages.length} herramientas`;
                  return <details className={`${s.toolGroup} ${failed ? s.toolGroupError : ""}`} key={item.id}><summary><span>⌘</span><strong>{label}</strong><small>Ver detalle</small></summary><div>{item.messages.map((message) => <p key={message.id}>{message.text}</p>)}</div></details>;
                }
                const message = item.message;
                if (message.kind === "system") return <div key={message.id} className={`${s.system} ${message.tone === "good" ? s.systemGood : message.tone === "bad" ? s.systemBad : ""}`}>{message.text}</div>;
                if (message.kind === "user") return <div className={`${s.row} ${s.userRow}`} key={message.id}><article className={`${s.bubble} ${s.userBubble}`}><div>{message.text}</div><time>{time(message.at)} ✓✓</time></article></div>;
                return <div className={`${s.row} ${s.agentRow}`} key={message.id}><span className={s.messageAvatar}>{(message.displayName || "A")[0].toUpperCase()}</span><article className={`${s.bubble} ${s.agentBubble}`}><div className={s.author}><strong>{message.displayName || message.agent}</strong>{message.streaming && <span className={s.typing}>escribiendo…</span>}</div><div className={s.aiResponse}><MessageResponse>{message.text}</MessageResponse></div><time>{time(message.at)}</time></article></div>;
              })}
              {(active.prUrl || active.diffStat) && <div className={s.delivery}><div><strong>{active.prUrl ? "Pull Request listo" : active.mode === "draft" ? "Borrador listo" : "Cambios preparados"}</strong><span>{active.prUrl ? "El equipo terminó la entrega. Revisá el diff antes de mergear." : "El trabajo quedó preparado dentro del contexto de este chat."}</span></div>{active.diffStat && <pre>{active.diffStat}</pre>}{active.prUrl && <a href={active.prUrl} target="_blank" rel="noreferrer">Abrir Pull Request ↗</a>}</div>}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <footer className={s.composerShell}>
          {active.running && <div className={s.running}><span className={s.spinner} /><span><strong>El equipo está trabajando</strong><small>{active.status}</small></span><button onClick={createChat}>Otro chat</button></div>}
          {active.error && !active.running && <div className={s.errorBanner}><span>!</span><div><strong>La última ejecución se detuvo</strong><small>{active.error}</small></div></div>}
          {active.provider === "chatgpt" && !chatGPTConnected && <div className={s.warning}>Conectá ChatGPT desde ⚙ o elegí GitHub Copilot.</div>}
          {active.provider === "copilot" && !githubConnected && <div className={s.warning}>Conectá GitHub desde ⚙ para usar Copilot.</div>}
          {repoMode && !active.repo && <div className={s.warning}>Elegí o creá un repositorio desde ⚙.</div>}
          <div className={s.composer}>
            <button className={s.plus} onClick={() => { setNewChatWizard(false); setSettingsOpen(true); }} aria-label="Acciones del chat">＋</button>
            <textarea value={active.draft} onChange={(e) => updateChat(active.id, (chat) => ({ ...chat, draft: e.target.value }))} onKeyDown={keyDown} placeholder={active.running ? "Este chat está trabajando…" : "Escribí un objetivo…"} disabled={active.running} rows={1} />
            <button className={s.send} onClick={() => void startRun(active.id)} disabled={!canSend} aria-label="Enviar">➤</button>
          </div>
        </footer>

        {settingsOpen && <>
          <button className={s.settingsBackdrop} onClick={() => { setSettingsOpen(false); setNewChatWizard(false); }} aria-label="Cerrar configuración" />
          <aside className={s.settings}>
            <div className={s.sheetHandle} />
            <div className={s.settingsHeader}><div><strong>{newChatWizard ? "Nuevo chat" : "Configuración del chat"}</strong><span>{newChatWizard ? "Elegí cómo querés trabajar. Después sólo conversás." : "Proveedor, modelo, repo y entrega viven dentro de esta conversación."}</span></div><button className={s.iconButton} onClick={() => { setSettingsOpen(false); setNewChatWizard(false); }}>×</button></div>

            <section className={s.section}>
              <div className={s.sectionTitle}><strong>Modo de trabajo</strong></div>
              <div className={s.modeGrid}>
                <button className={`${s.modeCard} ${active.mode === "chat" ? s.modeCardActive : ""}`} onClick={() => changeMode("chat")}><span className={s.modeIcon}>💬</span><strong>Solo chat</strong><span>Conversación con el equipo. Sin repo y sin PR.</span></button>
                <button className={`${s.modeCard} ${active.mode === "draft" ? s.modeCardActive : ""}`} onClick={() => changeMode("draft")}><span className={s.modeIcon}>📝</span><strong>Repo · borrador</strong><span>Trabaja en Sandbox y no publica en GitHub.</span></button>
                <button className={`${s.modeCard} ${active.mode === "pr" ? s.modeCardActive : ""}`} onClick={() => changeMode("pr")}><span className={s.modeIcon}>⑂</span><strong>Repo + PR</strong><span>Implementa y publica branch + Pull Request.</span></button>
              </div>
            </section>

            <section className={s.section}>
              <div className={s.sectionTitle}><strong>IA</strong></div>
              <div className={s.grid}>
                <label className={s.field}>Proveedor<select value={active.provider} onChange={(e) => changeProvider(e.target.value as Provider)} disabled={active.running}><option value="chatgpt">ChatGPT / Codex</option><option value="copilot" disabled={!copilotAvailable}>GitHub Copilot{!copilotAvailable ? " · conectá GitHub" : ""}</option></select></label>
                <label className={s.field}>Modelo<select value={active.model} onChange={(e) => changeModel(e.target.value)} disabled={!activeModels.length || active.running}>{!activeModels.length && <option value="">Sin modelos disponibles</option>}{activeModels.map((model) => <option value={model.id} key={model.id}>{model.displayName || model.name || model.id}</option>)}</select></label>
                {reasoning.length > 0 && <label className={s.field}>Esfuerzo<select value={active.reasoningEffort} onChange={(e) => updateChat(active.id, (chat) => ({ ...chat, reasoningEffort: e.target.value }))} disabled={active.running}>{reasoning.map((item) => <option value={item.id} key={item.id}>{item.id}</option>)}</select></label>}
              </div>
            </section>

            {repoMode && <section className={s.section}>
              <div className={s.sectionTitle}><strong>Repositorio</strong>{githubConnected && <button onClick={() => setCreateRepoOpen((value) => !value)}>＋ Crear repo</button>}</div>
              <div className={s.repoRow}>
                {githubConnected ? <select className={s.repoControl} value={active.repo} onChange={(e) => changeRepo(e.target.value)} disabled={active.running || repoLoading}><option value="">Elegí un repositorio…</option>{repos.map((repo) => <option value={repo.fullName} key={repo.id}>{repo.private ? "🔒 " : ""}{repo.fullName}</option>)}</select> : <input className={s.repoControl} value={active.repo} onChange={(e) => updateChat(active.id, (chat) => ({ ...chat, repo: e.target.value }))} placeholder="owner/repo público" />}
                {githubConnected && <button className={s.smallButton} onClick={() => void syncRepos()} disabled={repoLoading}>↻</button>}
              </div>
              {active.repo && <div className={s.grid} style={{ marginTop: 9 }}><label className={s.field}>Rama base<input value={active.branch} onChange={(e) => updateChat(active.id, (chat) => ({ ...chat, branch: e.target.value }))} disabled={active.running} /></label></div>}
              {selectedRepo && <div className={s.repoMeta}><span>{selectedRepo.private ? "privado" : "público"}</span><span>{selectedRepo.canPush ? "push habilitado" : "solo lectura"}</span><span>default: {selectedRepo.defaultBranch}</span></div>}
              {active.mode === "pr" && selectedRepo && !selectedRepo.canPush && <div className={s.statusError}>Esta cuenta no tiene permiso de push sobre ese repo; elegí otro o usá Repo · borrador.</div>}
              {createRepoOpen && <div className={s.createRepo}><h4>Crear repositorio en @{session.user?.login}</h4><label className={s.field}>Nombre<input value={newRepoName} onChange={(e) => setNewRepoName(e.target.value)} placeholder="mi-nuevo-proyecto" /></label><label className={s.checkbox}><input type="checkbox" checked={newRepoPrivate} onChange={(e) => setNewRepoPrivate(e.target.checked)} /> Crear como privado</label><div className={s.createRepoActions}><button className={s.smallButton} onClick={() => setCreateRepoOpen(false)}>Cancelar</button><button className={s.primaryButton} onClick={() => void createRepository()} disabled={creatingRepo || !newRepoName.trim()}>{creatingRepo ? "Creando…" : "Crear y usar"}</button></div></div>}
            </section>}

            <section className={s.section}>
              <div className={s.sectionTitle}><strong>Conexiones</strong></div>
              <div className={s.connectionsGrid}>
                <div className={s.connection}><span className={`${s.connectionLogo} ${s.avatarGpt}`}>GPT</span><div className={s.connectionCopy}><strong>{chatGPTConnected ? "ChatGPT conectado" : chatGPT.status === "pending" ? "Esperando autorización" : "ChatGPT"}</strong><span>{chatGPTConnected ? `${chatGPT.planType || "Plan ChatGPT"}${chatGPT.email ? ` · ${chatGPT.email}` : ""}` : "Opcional si preferís trabajar con Copilot."}</span></div>{chatGPTConnected ? <button className={s.smallButton} onClick={() => fetch("/api/chatgpt/logout", { method: "POST" }).then(() => { setChatGPT({ status: "disconnected" }); setChatGPTModels([]); })}>Salir</button> : chatGPT.status === "pending" ? <a className={s.primaryButton} href={chatGPT.verificationUrl || "https://auth.openai.com/codex/device"} target="_blank" rel="noreferrer">{chatGPT.userCode || "Autorizar"}</a> : <button className={s.primaryButton} onClick={() => void connectChatGPT()} disabled={connectingChatGPT}>{connectingChatGPT ? "…" : "Conectar"}</button>}</div>
                <div className={s.connection}><span className={`${s.connectionLogo} ${s.avatarCopilot}`}>GH</span><div className={s.connectionCopy}><strong>{githubConnected ? `@${session.user?.login}` : "GitHub"}</strong><span>{githubConnected ? `${repos.length} repos · Copilot disponible` : "Conectá para repos y GitHub Copilot."}</span></div>{githubConnected ? <button className={s.smallButton} onClick={() => void switchGitHubAccount()}>Cambiar</button> : <a className={s.primaryButton} href="/api/auth/github">Conectar</a>}</div>
              </div>
              {connectionError && <div className={s.statusError}>{connectionError}</div>}
              {repoError && <div className={s.statusError}>{repoError}</div>}
              {githubConnected && <button className={s.disconnectLink} onClick={() => void disconnectGitHub()}>Desconectar GitHub</button>}
            </section>

            {newChatWizard && <div className={s.newWizardFooter}><div><strong>Todo listo</strong><span>Podés cambiar estos datos después desde el encabezado del chat.</span></div><button className={s.primaryButton} onClick={() => { setSettingsOpen(false); setNewChatWizard(false); }}>Empezar chat</button></div>}
          </aside>
        </>}
      </section>
    </main>
  );
}
