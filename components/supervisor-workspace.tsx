"use client";

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import s from "./supervisor-workspace.module.css";

type Provider = "chatgpt" | "copilot";
type ChatMode = "chat" | "draft" | "pr";
type ChatFilter = "all" | "running" | "error" | "pr" | "repo" | "copilot" | "chatgpt";
type ThreadStatus = "idle" | "running" | "completed" | "error";

type SessionState = {
  authenticated: boolean;
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
type QueuedPrompt = { id: string; text: string; at: number };
type AgentThread = {
  name: string;
  displayName: string;
  description: string;
  status: ThreadStatus;
  draft: string;
  messages: ChatMessage[];
  updatedAt: number;
  unread: number;
  error: string;
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
  agentThreads: Record<string, AgentThread>;
  queuedSupervisor: QueuedPrompt[];
  diffStat: string;
  prUrl: string;
  error: string;
};
type TimelineItem =
  | { type: "message"; id: string; message: ChatMessage }
  | { type: "tools"; id: string; messages: ChatMessage[] };

type ToolArgs = Record<string, unknown>;

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

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}
function asRecord(value: unknown): ToolArgs {
  if (value && typeof value === "object") return value as ToolArgs;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" ? parsed as ToolArgs : {};
    } catch {
      return {};
    }
  }
  return {};
}
function titleFromPrompt(prompt: string) {
  const clean = prompt.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean || "Nuevo chat";
}
function time(ts: number) {
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(ts);
}
function modeLabel(mode: ChatMode) {
  if (mode === "pr") return "Repo + PR";
  if (mode === "draft") return "Repo · borrador";
  return "Solo chat";
}
function defaultAgentThread(name: string, displayName?: string, description = ""): AgentThread {
  return {
    name,
    displayName: displayName || name.replaceAll("_", " "),
    description,
    status: "idle",
    draft: "",
    messages: [],
    updatedAt: Date.now(),
    unread: 0,
    error: "",
  };
}
function defaultChat(): ChatThread {
  const now = Date.now();
  return {
    id: makeId("chat"),
    title: "Nuevo chat",
    createdAt: now,
    updatedAt: now,
    mode: "chat",
    provider: "chatgpt",
    repo: "",
    branch: "main",
    model: "",
    reasoningEffort: "",
    draft: "",
    status: "Listo para trabajar",
    running: false,
    messages: [],
    usedAgents: [],
    agentThreads: {},
    queuedSupervisor: [],
    diffStat: "",
    prUrl: "",
    error: "",
  };
}
function normalizeChat(input: Partial<ChatThread>): ChatThread {
  const base = { ...defaultChat(), ...input } as ChatThread;
  const agentThreads: Record<string, AgentThread> = { ...(input.agentThreads || {}) };
  const supervisorMessages: ChatMessage[] = [];
  for (const message of input.messages || []) {
    if (message.kind === "agent" && message.agent && message.agent !== "supervisor") {
      const name = message.agent;
      const existing = agentThreads[name] || defaultAgentThread(name, message.displayName);
      agentThreads[name] = {
        ...existing,
        messages: [...(existing.messages || []), { ...message, streaming: false }].slice(-100),
        updatedAt: Math.max(existing.updatedAt || 0, message.at || 0),
      };
    } else {
      supervisorMessages.push({ ...message, streaming: false });
    }
  }
  for (const [name, thread] of Object.entries(agentThreads)) {
    agentThreads[name] = {
      ...defaultAgentThread(name, thread.displayName, thread.description),
      ...thread,
      status: thread.status === "running" ? "idle" : thread.status,
      messages: (thread.messages || []).slice(-100).map((message) => ({ ...message, streaming: false })),
    };
  }
  return {
    ...base,
    running: false,
    messages: supervisorMessages.slice(-180),
    agentThreads,
    queuedSupervisor: input.queuedSupervisor || [],
  };
}
function preview(chat: ChatThread) {
  if (chat.running) return chat.status || "Supervisor está trabajando…";
  if (chat.error) return chat.error;
  const last = [...chat.messages].reverse().find((message) => message.text);
  return last?.text || "Sin mensajes todavía";
}
function isToolMessage(message: ChatMessage) {
  return message.kind === "system" && (message.text.includes(" usa ") || message.text.startsWith("Herramienta de "));
}
function toolOwner(text: string) {
  if (text.includes(" usa ")) return text.split(" usa ")[0];
  const match = text.match(/^Herramienta de (.+?) falló/);
  return match?.[1] || "Supervisor";
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
    if (isToolMessage(message)) bucket.push(message);
    else {
      flush();
      items.push({ type: "message", id: message.id, message });
    }
  }
  flush();
  return items;
}

export default function SupervisorWorkspace() {
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
  const [mobileAgentsOpen, setMobileAgentsOpen] = useState(false);
  const [selectedAgentName, setSelectedAgentName] = useState("");

  const endRef = useRef<HTMLDivElement>(null);
  const agentEndRef = useRef<HTMLDivElement>(null);
  const agentMaps = useRef<Record<string, Record<string, string>>>({});
  const chatsRef = useRef<ChatThread[]>([]);
  const selectedAgentRef = useRef("");
  const queueLocks = useRef(new Set<string>());

  useEffect(() => { chatsRef.current = chats; }, [chats]);
  useEffect(() => { selectedAgentRef.current = selectedAgentName; }, [selectedAgentName]);

  useEffect(() => {
    Promise.all([
      fetch("/api/session", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/agents", { cache: "no-store" }).then((response) => response.json()),
    ]).then(([sessionBody, agentsBody]) => {
      setSession(sessionBody as SessionState);
      setAgents((agentsBody as { agents?: AgentDefinition[] }).agents ?? []);
    }).catch(() => setSession({ authenticated: true, githubConnected: false }));
  }, []);

  useEffect(() => {
    if (window.matchMedia("(max-width: 940px)").matches) setMobileListOpen(true);
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as Partial<ChatThread>[];
      const restored = saved.filter((chat) => chat?.id).slice(0, 30).map(normalizeChat);
      const next = restored.length ? restored : [defaultChat()];
      setChats(next);
      const wanted = localStorage.getItem(ACTIVE_KEY);
      setActiveId(next.some((chat) => chat.id === wanted) ? wanted! : next[0].id);
    } catch {
      const first = defaultChat();
      setChats([first]);
      setActiveId(first.id);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const safe = chats.slice(0, 30).map((chat) => ({
      ...chat,
      running: false,
      messages: chat.messages.slice(-180).map((message) => ({ ...message, streaming: false })),
      agentThreads: Object.fromEntries(Object.entries(chat.agentThreads).map(([name, thread]) => [name, {
        ...thread,
        status: thread.status === "running" ? "idle" : thread.status,
        messages: thread.messages.slice(-100).map((message) => ({ ...message, streaming: false })),
      }])),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [chats, activeId, hydrated]);

  useEffect(() => {
    if (!session?.authenticated) return;
    fetch("/api/chatgpt/status", { cache: "no-store" }).then((response) => response.json()).then((body) => setChatGPT(body as ChatGPTState)).catch(() => undefined);
  }, [session?.authenticated]);

  useEffect(() => {
    if (chatGPT.status !== "pending") return;
    const timer = window.setInterval(() => {
      fetch("/api/chatgpt/status", { cache: "no-store" }).then((response) => response.json()).then((body) => setChatGPT(body as ChatGPTState)).catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [chatGPT.status]);

  useEffect(() => {
    if (chatGPT.status !== "connected") {
      setChatGPTModels([]);
      return;
    }
    fetch("/api/chatgpt/models", { cache: "no-store" }).then((response) => response.json()).then((body) => {
      setChatGPTModels(Array.isArray(body.models) ? body.models as ModelOption[] : []);
    }).catch(() => setChatGPTModels([]));
  }, [chatGPT.status]);

  useEffect(() => {
    if (!session?.githubConnected) {
      setCopilotModels(COPILOT_FALLBACK);
      setRepos([]);
      return;
    }
    void syncRepos();
    fetch("/api/models", { cache: "no-store" }).then((response) => response.json()).then((body) => {
      const models = Array.isArray(body.models) ? body.models as ModelOption[] : [];
      if (!models.some((model) => model.id === "auto")) models.unshift(COPILOT_FALLBACK[0]);
      setCopilotModels(models.length ? models : COPILOT_FALLBACK);
    }).catch(() => setCopilotModels(COPILOT_FALLBACK));
  }, [session?.githubConnected]);

  useEffect(() => {
    if (!chatGPTModels.length) return;
    setChats((current) => current.map((chat) => {
      if (chat.provider !== "chatgpt" || chatGPTModels.some((model) => model.id === chat.model)) return chat;
      const preferred = chatGPTModels.find((model) => model.isDefault) ?? chatGPTModels[0];
      return { ...chat, model: preferred.id, reasoningEffort: preferred.defaultReasoningEffort || preferred.reasoningEfforts?.[0]?.id || "" };
    }));
  }, [chatGPTModels]);

  useEffect(() => {
    if (!session?.githubConnected || !copilotModels.length) return;
    const preferred = copilotModels.find((model) => model.isDefault) ?? copilotModels[0];
    setChats((current) => current.map((chat) => {
      if (chat.provider !== "copilot" || copilotModels.some((model) => model.id === chat.model)) return chat;
      return { ...chat, model: preferred.id, reasoningEffort: preferred.defaultReasoningEffort || preferred.reasoningEfforts?.[0]?.id || "" };
    }));
  }, [session?.githubConnected, copilotModels]);

  useEffect(() => {
    if (!session?.githubConnected || chatGPT.status === "connected" || !copilotModels.length) return;
    const preferred = copilotModels.find((model) => model.isDefault) ?? copilotModels[0];
    setChats((current) => current.map((chat) => {
      if (chat.provider !== "chatgpt" || chat.messages.length || chat.title !== "Nuevo chat") return chat;
      return { ...chat, provider: "copilot", model: preferred.id, reasoningEffort: preferred.defaultReasoningEffort || preferred.reasoningEfforts?.[0]?.id || "" };
    }));
  }, [session?.githubConnected, chatGPT.status, copilotModels]);

  useEffect(() => {
    setSelectedAgentName("");
    setMobileAgentsOpen(false);
  }, [activeId]);

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
  const selectedModel = activeModels.find((model) => model.id === active?.model);
  const reasoning = selectedModel?.reasoningEfforts ?? [];
  const selectedRepo = repos.find((repo) => repo.fullName === active?.repo);
  const timeline = useMemo(() => buildTimeline(active?.messages ?? []), [active?.messages]);
  const parallelThreads = useMemo(() => active ? Object.values(active.agentThreads).sort((a, b) => b.updatedAt - a.updatedAt) : [], [active]);
  const selectedAgentThread = selectedAgentName && active ? active.agentThreads[selectedAgentName] : undefined;
  const chatGPTConnected = chatGPT.status === "connected";
  const githubConnected = Boolean(session?.githubConnected);
  const repoMode = active?.mode !== "chat";
  const canSendSupervisor = Boolean(active?.draft.trim() && (
    active.provider === "chatgpt" ? chatGPTConnected : githubConnected
  ) && (active.mode === "chat" || Boolean(active.repo)) && (active.mode !== "pr" || githubConnected));

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [active?.messages.length, active?.id]);
  useEffect(() => { agentEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [selectedAgentThread?.messages.length, selectedAgentName]);

  useEffect(() => {
    for (const chat of chats) {
      if (chat.running || !chat.queuedSupervisor.length || queueLocks.current.has(chat.id)) continue;
      const queued = chat.queuedSupervisor[0];
      queueLocks.current.add(chat.id);
      setChats((current) => current.map((item) => item.id === chat.id ? { ...item, queuedSupervisor: item.queuedSupervisor.slice(1) } : item));
      window.setTimeout(() => {
        void startSupervisorRun(chat.id, queued.text, true).finally(() => queueLocks.current.delete(chat.id));
      }, 50);
      break;
    }
  }, [chats]);

  function displayName(name: string) {
    return agents.find((agent) => agent.name === name)?.displayName ?? name.replaceAll("_", " ");
  }
  function agentDescription(name: string) {
    return agents.find((agent) => agent.name === name)?.description ?? "Especialista del equipo";
  }
  function updateChat(chatId: string, fn: (chat: ChatThread) => ChatThread) {
    setChats((current) => current.map((chat) => chat.id === chatId ? fn(chat) : chat));
  }
  function appendSupervisor(chatId: string, message: ChatMessage) {
    updateChat(chatId, (chat) => ({ ...chat, messages: [...chat.messages, message].slice(-200), updatedAt: Date.now() }));
  }
  function system(chatId: string, text: string, tone: ChatMessage["tone"] = "neutral", prefix = "sys") {
    appendSupervisor(chatId, { id: makeId(prefix), kind: "system", text, tone, at: Date.now() });
  }
  function updateAgentThread(chatId: string, name: string, fn: (thread: AgentThread) => AgentThread, metadata?: { description?: string; displayName?: string }) {
    setChats((current) => current.map((chat) => {
      if (chat.id !== chatId) return chat;
      const existing = chat.agentThreads[name] || defaultAgentThread(name, metadata?.displayName || displayName(name), metadata?.description || agentDescription(name));
      const next = fn({
        ...existing,
        displayName: metadata?.displayName || existing.displayName || displayName(name),
        description: metadata?.description || existing.description || agentDescription(name),
      });
      return {
        ...chat,
        usedAgents: chat.usedAgents.includes(name) ? chat.usedAgents : [...chat.usedAgents, name],
        agentThreads: { ...chat.agentThreads, [name]: next },
        updatedAt: Date.now(),
      };
    }));
  }
  function appendAgent(chatId: string, name: string, message: ChatMessage, unread = false) {
    updateAgentThread(chatId, name, (thread) => ({
      ...thread,
      messages: [...thread.messages, message].slice(-120),
      updatedAt: Date.now(),
      unread: unread && selectedAgentRef.current !== name ? thread.unread + 1 : thread.unread,
    }));
  }
  function updateAgentMessage(chatId: string, name: string, messageId: string, chunk: string, streaming: boolean, replace = false) {
    updateAgentThread(chatId, name, (thread) => {
      const index = thread.messages.findIndex((message) => message.id === messageId);
      if (index < 0) {
        return {
          ...thread,
          messages: [...thread.messages, {
            id: messageId,
            kind: "agent",
            text: chunk,
            at: Date.now(),
            agent: name,
            displayName: displayName(name),
            streaming,
          }].slice(-120),
          updatedAt: Date.now(),
          unread: selectedAgentRef.current === name ? thread.unread : thread.unread + 1,
        };
      }
      const messages = [...thread.messages];
      const previous = messages[index];
      messages[index] = { ...previous, text: replace ? chunk : previous.text + chunk, streaming };
      return { ...thread, messages, updatedAt: Date.now() };
    });
  }
  function openAgent(name: string) {
    setSelectedAgentName(name);
    setMobileAgentsOpen(true);
    updateAgentThread(active.id, name, (thread) => ({ ...thread, unread: 0 }));
  }

  async function syncRepos() {
    setRepoLoading(true);
    setRepoError("");
    try {
      const response = await fetch("/api/github/repos", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudieron sincronizar los repos");
      setRepos(Array.isArray(body.repos) ? body.repos as GitHubRepo[] : []);
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : String(error));
    } finally {
      setRepoLoading(false);
    }
  }

  async function createRepository() {
    if (!newRepoName.trim()) return;
    setCreatingRepo(true);
    setRepoError("");
    try {
      const response = await fetch("/api/github/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newRepoName.trim(), private: newRepoPrivate }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo crear el repo");
      const repo = body.repo as GitHubRepo;
      setRepos((current) => [repo, ...current.filter((item) => item.id !== repo.id)]);
      if (active) updateChat(active.id, (chat) => ({ ...chat, repo: repo.fullName, branch: repo.defaultBranch, updatedAt: Date.now() }));
      setNewRepoName("");
      setCreateRepoOpen(false);
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingRepo(false);
    }
  }

  async function connectChatGPT() {
    setConnectingChatGPT(true);
    setConnectionError("");
    try {
      const response = await fetch("/api/chatgpt/login", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo iniciar el login");
      setChatGPT(body as ChatGPTState);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : String(error));
    } finally {
      setConnectingChatGPT(false);
    }
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
      const preferred = catalog.find((model) => model.isDefault) ?? catalog[0];
      chat.model = preferred.id;
      chat.reasoningEffort = preferred.defaultReasoningEffort || preferred.reasoningEfforts?.[0]?.id || "";
    } else if (useCopilot) chat.model = "auto";
    setChats((current) => [chat, ...current]);
    setActiveId(chat.id);
    setNewChatWizard(true);
    setSettingsOpen(true);
    setMobileListOpen(false);
  }
  function openChat(chatId: string) {
    setActiveId(chatId);
    setMobileListOpen(false);
    setMobileAgentsOpen(false);
    setSettingsOpen(false);
    setNewChatWizard(false);
  }
  function deleteChat(chatId: string) {
    const target = chats.find((chat) => chat.id === chatId);
    if (target?.running) return;
    const next = chats.filter((chat) => chat.id !== chatId);
    if (!next.length) {
      const fresh = defaultChat();
      setChats([fresh]);
      setActiveId(fresh.id);
      return;
    }
    setChats(next);
    if (activeId === chatId) setActiveId(next[0].id);
  }
  function changeMode(mode: ChatMode) {
    if (!active || active.running) return;
    updateChat(active.id, (chat) => ({ ...chat, mode, repo: mode === "chat" ? "" : chat.repo, branch: mode === "chat" ? "main" : chat.branch, updatedAt: Date.now() }));
  }
  function changeProvider(provider: Provider) {
    if (!active || active.running || (provider === "copilot" && !session?.githubConnected)) return;
    const catalog = provider === "copilot" ? copilotModels : chatGPTModels;
    const preferred = catalog.find((model) => model.isDefault) ?? catalog[0];
    updateChat(active.id, (chat) => ({
      ...chat,
      provider,
      model: preferred?.id || (provider === "copilot" ? "auto" : ""),
      reasoningEffort: preferred?.defaultReasoningEffort || preferred?.reasoningEfforts?.[0]?.id || "",
    }));
  }
  function changeModel(modelId: string) {
    if (!active) return;
    const option = activeModels.find((model) => model.id === modelId);
    updateChat(active.id, (chat) => ({ ...chat, model: modelId, reasoningEffort: option?.defaultReasoningEffort || option?.reasoningEfforts?.[0]?.id || "" }));
  }
  function changeRepo(fullName: string) {
    if (!active) return;
    const repo = repos.find((item) => item.fullName === fullName);
    updateChat(active.id, (chat) => ({ ...chat, repo: fullName, branch: repo?.defaultBranch || "main", updatedAt: Date.now() }));
  }

  function taskAssignment(data: Record<string, unknown>) {
    const toolName = asString(data.toolName).toLowerCase();
    if (toolName !== "task") return null;
    const args = asRecord(data.arguments);
    const name = asString(args.agent_type) || asString(args.agentType) || asString(args.agent_name) || asString(args.agentName) || asString(args.agent);
    const assignment = asString(args.prompt) || asString(args.task) || asString(args.message) || asString(args.description);
    return name ? { name, assignment } : null;
  }

  function handleSupervisorEvent(chatId: string, runId: string, provider: Provider, model: string, event: StreamEvent) {
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
      system(chatId, `Equipo cargado · ${String(data.count ?? agents.length)} agentes disponibles`, "good", runId);
      return;
    }
    if (event.type === "run.started") {
      updateChat(chatId, (chat) => ({ ...chat, usedAgents: chat.usedAgents.includes("supervisor") ? chat.usedAgents : [...chat.usedAgents, "supervisor"] }));
      system(chatId, `Supervisor inició · ${provider === "chatgpt" ? "ChatGPT / Codex" : "GitHub Copilot"} · ${model || "auto"}`, "good", runId);
      return;
    }
    if (event.type === "subagent.started" || event.type === "subagent.selected") {
      const name = asString(data.agentName) || agentId;
      if (event.agentId) map[event.agentId] = name;
      updateAgentThread(chatId, name, (thread) => ({ ...thread, status: "running", error: "", updatedAt: Date.now() }), {
        displayName: asString(data.agentDisplayName) || displayName(name),
        description: asString(data.agentDescription) || agentDescription(name),
      });
      if (event.type === "subagent.started") system(chatId, `Supervisor delegó trabajo a ${displayName(name)}`, "neutral", runId);
      return;
    }
    if (event.type === "subagent.completed") {
      const name = asString(data.agentName) || map[agentId] || agentId;
      updateAgentThread(chatId, name, (thread) => ({ ...thread, status: "completed", updatedAt: Date.now() }));
      appendAgent(chatId, name, { id: makeId("agent-done"), kind: "system", text: "Trabajo entregado al Supervisor", tone: "good", at: Date.now() });
      system(chatId, `${displayName(name)} terminó su tarea`, "good", runId);
      return;
    }
    if (event.type === "subagent.failed") {
      const name = asString(data.agentName) || map[agentId] || agentId;
      const error = asString(data.error) || "El especialista falló";
      updateAgentThread(chatId, name, (thread) => ({ ...thread, status: "error", error, updatedAt: Date.now() }));
      appendAgent(chatId, name, { id: makeId("agent-error"), kind: "system", text: error, tone: "bad", at: Date.now() }, true);
      system(chatId, `${displayName(name)} encontró un error`, "bad", runId);
      return;
    }
    if (event.type === "tool.started") {
      const assignment = taskAssignment(data);
      if (assignment && assignment.name !== "supervisor") {
        updateAgentThread(chatId, assignment.name, (thread) => ({ ...thread, status: "running", updatedAt: Date.now() }));
        if (assignment.assignment) {
          appendAgent(chatId, assignment.name, {
            id: makeId("assignment"),
            kind: "system",
            text: `Supervisor → ${assignment.assignment}`,
            at: Date.now(),
          });
        }
        system(chatId, `Supervisor abrió un frente con ${displayName(assignment.name)}`, "neutral", runId);
        return;
      }
      const name = map[agentId] || agentId;
      const text = `${displayName(name)} usa ${asString(data.toolName) || "una herramienta"}`;
      if (name === "supervisor") system(chatId, text, "neutral", runId);
      else appendAgent(chatId, name, { id: makeId("tool"), kind: "system", text, at: Date.now() });
      return;
    }
    if (event.type === "tool.completed" && data.success === false) {
      const name = map[agentId] || agentId;
      const text = `Herramienta de ${displayName(name)} falló`;
      if (name === "supervisor") system(chatId, text, "bad", runId);
      else appendAgent(chatId, name, { id: makeId("tool-error"), kind: "system", text, tone: "bad", at: Date.now() }, true);
      return;
    }
    if (event.type === "agent.delta" || event.type === "agent.message") {
      const name = map[agentId] || agentId;
      const chunk = asString(data.content);
      if (!chunk) return;
      const messageId = `${runId}:${asString(data.messageId) || agentId}`;
      if (name !== "supervisor") {
        updateAgentMessage(chatId, name, messageId, chunk, event.type === "agent.delta", event.type === "agent.message");
        return;
      }
      updateChat(chatId, (chat) => {
        const index = chat.messages.findIndex((message) => message.id === messageId);
        if (index < 0) {
          const next: ChatMessage = { id: messageId, kind: "agent", text: chunk, at: Date.now(), agent: "supervisor", displayName: "Supervisor", streaming: event.type === "agent.delta" };
          return { ...chat, messages: [...chat.messages, next].slice(-200), updatedAt: Date.now() };
        }
        const messages = [...chat.messages];
        const previous = messages[index];
        messages[index] = { ...previous, text: event.type === "agent.message" ? chunk : previous.text + chunk, streaming: event.type === "agent.delta", agent: "supervisor", displayName: "Supervisor" };
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
    if (event.type === "run.completed") {
      system(chatId, "Supervisor cerró el turno", "good", runId);
      return;
    }
    if (event.type === "control.done") {
      const prUrl = asString(data.prUrl);
      const diffStat = asString(data.diffStat);
      updateChat(chatId, (chat) => ({ ...chat, running: false, status: "Turno completado", prUrl: prUrl || chat.prUrl, diffStat: diffStat || chat.diffStat, error: "", updatedAt: Date.now() }));
      system(chatId, prUrl ? "Supervisor terminó · PR listo para revisar" : "Supervisor terminó el turno", "good", runId);
      return;
    }
    if (event.type === "control.error" || event.type === "run.failed") {
      const message = asString(data.message) || "La ejecución falló";
      updateChat(chatId, (chat) => ({ ...chat, running: false, status: "Turno detenido", error: message, updatedAt: Date.now() }));
      system(chatId, message, "bad", runId);
    }
  }

  function specialistContext(chat: ChatThread) {
    const blocks = Object.values(chat.agentThreads)
      .filter((thread) => thread.messages.some((message) => message.kind === "user" || message.kind === "agent"))
      .slice(0, 10)
      .map((thread) => {
        const lines = thread.messages.filter((message) => message.kind === "user" || message.kind === "agent").slice(-8).map((message) => `${message.kind === "user" ? "USUARIO" : thread.displayName}: ${message.text}`);
        return `HILO ${thread.displayName}:\n${lines.join("\n")}`;
      });
    return blocks.join("\n\n").slice(0, 16_000);
  }

  async function startSupervisorRun(chatId: string, explicitPrompt?: string, alreadyAppended = false) {
    const thread = chatsRef.current.find((chat) => chat.id === chatId);
    if (!thread || thread.running) return;
    const prompt = (explicitPrompt ?? thread.draft).trim();
    if (!prompt) return;
    if (thread.provider === "chatgpt" && chatGPT.status !== "connected") return;
    if (thread.provider === "copilot" && !session?.githubConnected) return;
    if (thread.mode !== "chat" && !thread.repo) return;
    if (thread.mode === "pr" && !session?.githubConnected) return;

    const runId = makeId("run");
    agentMaps.current[chatId] = { supervisor: "supervisor" };
    const historyMessages = thread.messages.filter((message) => message.kind === "user" || message.kind === "agent");
    const history = (alreadyAppended ? historyMessages.slice(0, -1) : historyMessages).slice(-12)
      .map((message) => `${message.kind === "user" ? "USUARIO" : "SUPERVISOR"}: ${message.text}`).join("\n\n");
    const specialists = specialistContext(thread);
    const requestPrompt = [
      history ? `CONTEXTO DEL CHAT CON SUPERVISOR:\n${history}` : "",
      specialists ? `INTERVENCIONES DIRECTAS CON ESPECIALISTAS (incorporalas si son relevantes):\n${specialists}` : "",
      `NUEVO PEDIDO DEL USUARIO:\n${prompt}`,
    ].filter(Boolean).join("\n\n");

    updateChat(chatId, (chat) => ({
      ...chat,
      title: chat.title === "Nuevo chat" ? titleFromPrompt(prompt) : chat.title,
      draft: "",
      running: true,
      status: "Supervisor está preparando el turno…",
      error: "",
      diffStat: "",
      prUrl: "",
      updatedAt: Date.now(),
      messages: alreadyAppended ? chat.messages : [...chat.messages, { id: `${runId}:user`, kind: "user", text: prompt, at: Date.now() } as ChatMessage].slice(-200),
    }));

    try {
      const endpoint = thread.mode === "pr" ? "/api/run" : thread.provider === "copilot" ? "/api/copilot-run" : "/api/chat-run";
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
        for (const raw of lines) if (raw.trim()) handleSupervisorEvent(chatId, runId, thread.provider, thread.model, JSON.parse(raw) as StreamEvent);
        if (done) break;
      }
      if (buffer.trim()) handleSupervisorEvent(chatId, runId, thread.provider, thread.model, JSON.parse(buffer) as StreamEvent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateChat(chatId, (chat) => ({ ...chat, running: false, status: "Turno detenido", error: message, updatedAt: Date.now() }));
      system(chatId, message, "bad", runId);
    } finally {
      updateChat(chatId, (chat) => chat.running ? { ...chat, running: false, updatedAt: Date.now() } : chat);
    }
  }

  function sendSupervisor() {
    if (!active || !active.draft.trim() || !canSendSupervisor) return;
    const text = active.draft.trim();
    if (active.running) {
      const queued: QueuedPrompt = { id: makeId("queued"), text, at: Date.now() };
      updateChat(active.id, (chat) => ({
        ...chat,
        draft: "",
        queuedSupervisor: [...chat.queuedSupervisor, queued],
        messages: [...chat.messages, { id: queued.id, kind: "user", text, at: queued.at } as ChatMessage, { id: makeId("queue-note"), kind: "system", text: "Mensaje en cola · Supervisor lo toma cuando cierre el turno actual", at: Date.now() } as ChatMessage].slice(-200),
        updatedAt: Date.now(),
      }));
      return;
    }
    void startSupervisorRun(active.id, text, false);
  }

  function handleDirectAgentEvent(chatId: string, name: string, runId: string, event: StreamEvent) {
    const data = event.data ?? {};
    if (event.type === "control.status") {
      const message = asString(data.message);
      if (message) updateAgentThread(chatId, name, (thread) => ({ ...thread, status: "running", error: "", updatedAt: Date.now() }));
      return;
    }
    if (event.type === "tool.started") {
      appendAgent(chatId, name, { id: makeId("direct-tool"), kind: "system", text: `${displayName(name)} usa ${asString(data.toolName) || "una herramienta"}`, at: Date.now() });
      return;
    }
    if (event.type === "tool.completed" && data.success === false) {
      appendAgent(chatId, name, { id: makeId("direct-tool-error"), kind: "system", text: `Herramienta de ${displayName(name)} falló`, tone: "bad", at: Date.now() }, true);
      return;
    }
    if (event.type === "agent.delta" || event.type === "agent.message") {
      const chunk = asString(data.content);
      if (!chunk) return;
      const messageId = `${runId}:${asString(data.messageId) || name}`;
      updateAgentMessage(chatId, name, messageId, chunk, event.type === "agent.delta", event.type === "agent.message");
      return;
    }
    if (event.type === "control.done" || event.type === "run.completed") {
      updateAgentThread(chatId, name, (thread) => ({ ...thread, status: "completed", error: "", updatedAt: Date.now() }));
      return;
    }
    if (event.type === "control.error" || event.type === "run.failed") {
      const message = asString(data.message) || "El especialista no pudo responder";
      updateAgentThread(chatId, name, (thread) => ({ ...thread, status: "error", error: message, updatedAt: Date.now() }));
      appendAgent(chatId, name, { id: makeId("direct-error"), kind: "system", text: message, tone: "bad", at: Date.now() }, true);
    }
  }

  async function startAgentRun(chatId: string, name: string) {
    const parent = chatsRef.current.find((chat) => chat.id === chatId);
    const thread = parent?.agentThreads[name];
    if (!parent || !thread || thread.running || !thread.draft.trim()) return;
    if (parent.provider === "chatgpt" && chatGPT.status !== "connected") return;
    if (parent.provider === "copilot" && !session?.githubConnected) return;

    const prompt = thread.draft.trim();
    const runId = makeId("agent-run");
    const supervisorContext = parent.messages.filter((message) => message.kind === "user" || message.kind === "agent").slice(-8)
      .map((message) => `${message.kind === "user" ? "USUARIO" : "SUPERVISOR"}: ${message.text}`).join("\n\n");
    const directHistory = thread.messages.filter((message) => message.kind === "user" || message.kind === "agent").slice(-10)
      .map((message) => `${message.kind === "user" ? "USUARIO" : thread.displayName}: ${message.text}`).join("\n\n");
    const requestPrompt = [
      supervisorContext ? `CONTEXTO DEL SUPERVISOR:\n${supervisorContext}` : "",
      directHistory ? `HISTORIAL DE ESTE HILO:\n${directHistory}` : "",
      `NUEVO AJUSTE DEL USUARIO:\n${prompt}`,
    ].filter(Boolean).join("\n\n");

    updateAgentThread(chatId, name, (current) => ({
      ...current,
      draft: "",
      status: "running",
      error: "",
      unread: 0,
      messages: [...current.messages, { id: `${runId}:user`, kind: "user", text: prompt, at: Date.now() } as ChatMessage].slice(-120),
      updatedAt: Date.now(),
    }));

    let failed = false;
    try {
      const response = await fetch("/api/agent-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: parent.provider,
          agentName: name,
          prompt: requestPrompt,
          repo: parent.repo,
          branch: parent.branch,
          model: parent.model,
          reasoningEffort: parent.reasoningEffort,
        }),
      });
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
        for (const raw of lines) {
          if (!raw.trim()) continue;
          const event = JSON.parse(raw) as StreamEvent;
          if (event.type === "control.error" || event.type === "run.failed") failed = true;
          handleDirectAgentEvent(chatId, name, runId, event);
        }
        if (done) break;
      }
      if (buffer.trim()) {
        const event = JSON.parse(buffer) as StreamEvent;
        if (event.type === "control.error" || event.type === "run.failed") failed = true;
        handleDirectAgentEvent(chatId, name, runId, event);
      }
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      updateAgentThread(chatId, name, (current) => ({ ...current, status: "error", error: message, updatedAt: Date.now() }));
      appendAgent(chatId, name, { id: makeId("agent-network-error"), kind: "system", text: message, tone: "bad", at: Date.now() }, true);
    } finally {
      updateAgentThread(chatId, name, (current) => current.status === "running" ? { ...current, status: failed ? "error" : "completed", updatedAt: Date.now() } : current);
      if (!failed) system(chatId, `Intervención con ${displayName(name)} actualizada · Supervisor la recibe en su próximo turno`, "good", "agent-sync");
    }
  }

  function supervisorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSendSupervisor) sendSupervisor();
    }
  }
  function agentKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, name: string) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void startAgentRun(active.id, name);
    }
  }

  if (!hydrated || !session) return <main className={s.loading}><div>S</div><p>Inicializando Supervisor…</p></main>;
  if (!active) return null;

  return (
    <main className={`${s.app} ${mobileListOpen ? s.showList : ""} ${mobileAgentsOpen ? s.showAgents : ""}`}>
      <aside className={s.sidebar}>
        <div className={s.listHeader}>
          <button className={s.circleButton} onClick={() => { setNewChatWizard(false); setSettingsOpen(true); }} aria-label="Cuenta y conexiones">•••</button>
          <h1>Chats</h1>
          <button className={s.addChatButton} onClick={createChat} aria-label="Nuevo chat">＋</button>
        </div>
        <label className={s.search}><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar chats" /></label>
        <div className={s.filters}>{FILTERS.map((item) => <button key={item.id} className={filter === item.id ? s.filterActive : ""} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
        <div className={s.threadList}>
          {!visibleChats.length && <div className={s.emptyList}><strong>No hay chats</strong><span>Probá otro filtro o empezá uno nuevo.</span><button onClick={createChat}>＋ Nuevo chat</button></div>}
          {visibleChats.map((chat) => (
            <div className={`${s.thread} ${chat.id === active.id ? s.threadActive : ""}`} key={chat.id}>
              <button className={s.threadMain} onClick={() => openChat(chat.id)}>
                <span className={s.threadAvatar}>S</span>
                <span className={s.threadBody}>
                  <span className={s.threadTitle}><strong>{chat.title}</strong><time>{time(chat.updatedAt)}</time></span>
                  <span className={s.threadPreview}>{chat.running && <span className={s.spinner} />}<span>{preview(chat)}</span></span>
                  <span className={s.threadMeta}>Supervisor · {chat.provider === "copilot" ? "Copilot" : "ChatGPT"}{chat.repo ? ` · ${chat.repo}` : ""}</span>
                </span>
                {(chat.running || chat.error || chat.prUrl) && <span className={`${s.threadState} ${chat.error ? s.stateError : chat.running ? s.stateRunning : s.stateDone}`}>{chat.error ? "!" : chat.running ? "●" : "PR"}</span>}
              </button>
              {!chat.running && chats.length > 1 && <button className={s.threadDelete} onClick={() => deleteChat(chat.id)} aria-label="Eliminar chat">×</button>}
            </div>
          ))}
        </div>
        <div className={s.accountBar}>
          <button className={s.accountButton} onClick={() => { setNewChatWizard(false); setSettingsOpen(true); }}>
            {session.user?.avatarUrl ? <img src={session.user.avatarUrl} alt="" /> : <span>ME</span>}
            <span><strong>{githubConnected ? `@${session.user?.login}` : "Conexiones"}</strong><small>{githubConnected ? "Copilot disponible" : chatGPTConnected ? "ChatGPT conectado" : "Configurar cuentas"}</small></span>
          </button>
          <span>{runningCount ? `${runningCount} trabajando` : ""}</span>
        </div>
      </aside>

      <section className={s.supervisorPane}>
        <header className={s.chatHeader}>
          <button className={s.mobileBack} onClick={() => setMobileListOpen(true)} aria-label="Volver a chats">‹</button>
          <span className={s.supervisorAvatar}>S</span>
          <div className={s.headerCopy}><strong>Supervisor</strong><span>{active.title} · {active.running ? active.status : "listo"}</span></div>
          <button className={s.agentToggle} onClick={() => setMobileAgentsOpen(true)}>{parallelThreads.length ? `${parallelThreads.length} agentes` : "Agentes"}</button>
          <button className={s.iconButton} onClick={() => { setNewChatWizard(false); setSettingsOpen(true); }} aria-label="Configurar">⚙</button>
        </header>

        <div className={s.contextBar}>
          <span>{modeLabel(active.mode)}</span>
          <span>{active.provider === "copilot" ? "Copilot" : "ChatGPT"} · {selectedModel?.displayName || selectedModel?.name || active.model || "modelo"}</span>
          {active.reasoningEffort && <span>esfuerzo · {active.reasoningEffort}</span>}
          {active.repo && <span>repo · {active.repo}</span>}
          {active.queuedSupervisor.length > 0 && <span className={s.queueChip}>{active.queuedSupervisor.length} en cola</span>}
        </div>

        <div className={s.messages}>
          {!active.messages.length ? (
            <div className={s.welcome}><div className={s.welcomeAvatar}>S</div><h1>Hablá con Supervisor</h1><p>Supervisor coordina el equipo. Cada especialista que active aparece como un chat paralelo a la derecha.</p><div><button onClick={() => updateChat(active.id, (chat) => ({ ...chat, draft: "Revisá el proyecto, armá un plan y delegá en paralelo a los especialistas que hagan falta." }))}>Coordinar proyecto</button><button onClick={() => updateChat(active.id, (chat) => ({ ...chat, draft: "Analizá la UX y delegá investigación, diseño y QA en paralelo." }))}>Rediseñar UX</button></div></div>
          ) : (
            <div className={s.stack}>
              {timeline.map((item) => {
                if (item.type === "tools") {
                  const owners = Array.from(new Set(item.messages.map((message) => toolOwner(message.text))));
                  const failed = item.messages.some((message) => message.tone === "bad" || message.text.includes("falló"));
                  return <details className={`${s.toolGroup} ${failed ? s.toolGroupError : ""}`} key={item.id}><summary><span>⌘</span><strong>{owners.length === 1 ? `${owners[0]} usó ${item.messages.length} herramientas` : `${item.messages.length} herramientas`}</strong><small>Ver</small></summary><div>{item.messages.map((message) => <p key={message.id}>{message.text}</p>)}</div></details>;
                }
                const message = item.message;
                if (message.kind === "system") return <div key={message.id} className={`${s.system} ${message.tone === "good" ? s.systemGood : message.tone === "bad" ? s.systemBad : ""}`}>{message.text}</div>;
                if (message.kind === "user") return <div className={`${s.row} ${s.userRow}`} key={message.id}><article className={`${s.bubble} ${s.userBubble}`}><div>{message.text}</div><time>{time(message.at)} ✓✓</time></article></div>;
                return <div className={`${s.row} ${s.agentRow}`} key={message.id}><span className={s.messageAvatar}>S</span><article className={`${s.bubble} ${s.agentBubble}`}><div className={s.author}><strong>Supervisor</strong>{message.streaming && <span>escribiendo…</span>}</div><div className={s.aiResponse}><MessageResponse>{message.text}</MessageResponse></div><time>{time(message.at)}</time></article></div>;
              })}
              {(active.prUrl || active.diffStat) && <div className={s.delivery}><strong>{active.prUrl ? "Pull Request listo" : "Cambios preparados"}</strong>{active.diffStat && <pre>{active.diffStat}</pre>}{active.prUrl && <a href={active.prUrl} target="_blank" rel="noreferrer">Abrir Pull Request ↗</a>}</div>}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <footer className={s.composerShell}>
          {active.running && <div className={s.runningBanner}><span className={s.spinner} /><div><strong>Supervisor está trabajando</strong><small>{active.status}</small></div>{active.queuedSupervisor.length > 0 && <b>{active.queuedSupervisor.length} en cola</b>}</div>}
          {active.error && !active.running && <div className={s.errorBanner}>! <span>{active.error}</span></div>}
          {active.provider === "chatgpt" && !chatGPTConnected && <div className={s.warning}>Conectá ChatGPT desde ⚙ o elegí Copilot.</div>}
          {active.provider === "copilot" && !githubConnected && <div className={s.warning}>Conectá GitHub desde ⚙ para usar Copilot.</div>}
          {repoMode && !active.repo && <div className={s.warning}>Elegí un repositorio desde ⚙.</div>}
          <div className={s.composer}>
            <button className={s.plus} onClick={() => { setNewChatWizard(false); setSettingsOpen(true); }}>＋</button>
            <textarea value={active.draft} onChange={(event) => updateChat(active.id, (chat) => ({ ...chat, draft: event.target.value }))} onKeyDown={supervisorKeyDown} placeholder={active.running ? "Escribí otra instrucción; queda en cola…" : "Mensaje a Supervisor…"} rows={1} />
            <button className={s.send} onClick={sendSupervisor} disabled={!canSendSupervisor} aria-label={active.running ? "Encolar mensaje" : "Enviar"}>➤</button>
          </div>
        </footer>
      </section>

      <aside className={s.agentRail}>
        <div className={s.agentRailHeader}>
          {selectedAgentThread ? <button onClick={() => setSelectedAgentName("")}>‹</button> : <span className={s.railMark}>⇶</span>}
          <div><strong>{selectedAgentThread ? selectedAgentThread.displayName : "Chats paralelos"}</strong><span>{selectedAgentThread ? "Especialista · solo lectura" : `${parallelThreads.length} especialistas activos`}</span></div>
          <button className={s.mobileAgentClose} onClick={() => setMobileAgentsOpen(false)}>×</button>
        </div>

        {!selectedAgentThread ? (
          <div className={s.agentList}>
            {!parallelThreads.length && <div className={s.agentEmpty}><div>⇶</div><strong>Todavía no hay especialistas</strong><p>Cuando Supervisor delegue trabajo, cada agente aparece acá como un chat independiente.</p></div>}
            {parallelThreads.map((thread) => {
              const last = [...thread.messages].reverse().find((message) => message.text);
              return <button className={s.agentListItem} key={thread.name} onClick={() => openAgent(thread.name)}><span className={s.agentAvatar}>{thread.displayName[0]?.toUpperCase() || "A"}</span><span><strong>{thread.displayName}</strong><small>{last?.text || thread.description}</small></span><span className={`${s.agentStatus} ${thread.status === "running" ? s.agentRunning : thread.status === "error" ? s.agentError : thread.status === "completed" ? s.agentDone : ""}`}>{thread.status === "running" ? "●" : thread.status === "error" ? "!" : thread.status === "completed" ? "✓" : ""}{thread.unread > 0 && <b>{thread.unread}</b>}</span></button>;
            })}
          </div>
        ) : (
          <div className={s.agentConversation}>
            <div className={s.agentNotice}>Este hilo no modifica archivos. Tus ajustes se agregan al contexto del próximo turno de Supervisor.</div>
            <div className={s.agentMessages}>
              {!selectedAgentThread.messages.length && <div className={s.agentEmpty}><strong>Chat con {selectedAgentThread.displayName}</strong><p>{selectedAgentThread.description}</p></div>}
              {selectedAgentThread.messages.map((message) => {
                if (message.kind === "system") return <div key={message.id} className={`${s.agentSystem} ${message.tone === "bad" ? s.agentSystemBad : ""}`}>{message.text}</div>;
                if (message.kind === "user") return <div key={message.id} className={s.agentUserBubble}>{message.text}<time>{time(message.at)}</time></div>;
                return <div key={message.id} className={s.agentReply}><strong>{selectedAgentThread.displayName}</strong><MessageResponse>{message.text}</MessageResponse><time>{time(message.at)}</time></div>;
              })}
              <div ref={agentEndRef} />
            </div>
            <div className={s.agentComposer}>
              <textarea value={selectedAgentThread.draft} onChange={(event) => updateAgentThread(active.id, selectedAgentThread.name, (thread) => ({ ...thread, draft: event.target.value }))} onKeyDown={(event) => agentKeyDown(event, selectedAgentThread.name)} placeholder={`Ajustar pedido a ${selectedAgentThread.displayName}…`} disabled={selectedAgentThread.status === "running"} rows={1} />
              <button onClick={() => void startAgentRun(active.id, selectedAgentThread.name)} disabled={!selectedAgentThread.draft.trim() || selectedAgentThread.status === "running"}>➤</button>
            </div>
          </div>
        )}
      </aside>

      {settingsOpen && <>
        <button className={s.settingsBackdrop} onClick={() => { setSettingsOpen(false); setNewChatWizard(false); }} aria-label="Cerrar configuración" />
        <aside className={s.settings}>
          <div className={s.sheetHandle} />
          <div className={s.settingsHeader}><div><strong>{newChatWizard ? "Nuevo chat con Supervisor" : "Configuración"}</strong><span>Supervisor conserva proveedor, modelo, repo y forma de entrega.</span></div><button className={s.iconButton} onClick={() => { setSettingsOpen(false); setNewChatWizard(false); }}>×</button></div>
          <section className={s.section}><div className={s.sectionTitle}>Modo de trabajo</div><div className={s.modeGrid}><button className={active.mode === "chat" ? s.modeActive : ""} onClick={() => changeMode("chat")}><strong>💬 Solo chat</strong><span>Sin repo ni PR.</span></button><button className={active.mode === "draft" ? s.modeActive : ""} onClick={() => changeMode("draft")}><strong>📝 Repo · borrador</strong><span>Sandbox privado.</span></button><button className={active.mode === "pr" ? s.modeActive : ""} onClick={() => changeMode("pr")}><strong>⑂ Repo + PR</strong><span>Entrega a GitHub.</span></button></div></section>
          <section className={s.section}><div className={s.sectionTitle}>IA de Supervisor</div><div className={s.grid}><label>Proveedor<select value={active.provider} onChange={(event) => changeProvider(event.target.value as Provider)} disabled={active.running}><option value="chatgpt">ChatGPT / Codex</option><option value="copilot" disabled={!githubConnected}>GitHub Copilot</option></select></label><label>Modelo<select value={active.model} onChange={(event) => changeModel(event.target.value)} disabled={!activeModels.length || active.running}>{!activeModels.length && <option value="">Sin modelos</option>}{activeModels.map((model) => <option key={model.id} value={model.id}>{model.displayName || model.name || model.id}</option>)}</select></label>{reasoning.length > 0 && <label>Esfuerzo<select value={active.reasoningEffort} onChange={(event) => updateChat(active.id, (chat) => ({ ...chat, reasoningEffort: event.target.value }))}>{reasoning.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>}</div></section>
          {repoMode && <section className={s.section}><div className={s.sectionHeading}><div className={s.sectionTitle}>Repositorio</div>{githubConnected && <button onClick={() => setCreateRepoOpen((value) => !value)}>＋ Crear repo</button>}</div><div className={s.repoRow}>{githubConnected ? <select value={active.repo} onChange={(event) => changeRepo(event.target.value)} disabled={active.running || repoLoading}><option value="">Elegí un repo…</option>{repos.map((repo) => <option key={repo.id} value={repo.fullName}>{repo.private ? "🔒 " : ""}{repo.fullName}</option>)}</select> : <input value={active.repo} onChange={(event) => updateChat(active.id, (chat) => ({ ...chat, repo: event.target.value }))} placeholder="owner/repo público" />}<button onClick={() => void syncRepos()} disabled={!githubConnected || repoLoading}>↻</button></div>{active.repo && <label className={s.branchField}>Rama base<input value={active.branch} onChange={(event) => updateChat(active.id, (chat) => ({ ...chat, branch: event.target.value }))} disabled={active.running} /></label>}{selectedRepo && <div className={s.repoMeta}><span>{selectedRepo.private ? "privado" : "público"}</span><span>{selectedRepo.canPush ? "push habilitado" : "solo lectura"}</span><span>{selectedRepo.defaultBranch}</span></div>}{createRepoOpen && <div className={s.createRepo}><label>Nombre<input value={newRepoName} onChange={(event) => setNewRepoName(event.target.value)} placeholder="mi-proyecto" /></label><label className={s.check}><input type="checkbox" checked={newRepoPrivate} onChange={(event) => setNewRepoPrivate(event.target.checked)} /> Privado</label><div><button onClick={() => setCreateRepoOpen(false)}>Cancelar</button><button onClick={() => void createRepository()} disabled={creatingRepo || !newRepoName.trim()}>{creatingRepo ? "Creando…" : "Crear y usar"}</button></div></div>}{repoError && <div className={s.formError}>{repoError}</div>}</section>}
          <section className={s.section}><div className={s.sectionTitle}>Conexiones</div><div className={s.connection}><span className={s.gptLogo}>GPT</span><div><strong>{chatGPTConnected ? "ChatGPT conectado" : "ChatGPT"}</strong><small>{chatGPTConnected ? chatGPT.planType || "Conectado" : "Opcional si usás Copilot"}</small></div>{chatGPTConnected ? <button onClick={() => fetch("/api/chatgpt/logout", { method: "POST" }).then(() => { setChatGPT({ status: "disconnected" }); setChatGPTModels([]); })}>Salir</button> : chatGPT.status === "pending" ? <a href={chatGPT.verificationUrl || "https://auth.openai.com/codex/device"} target="_blank" rel="noreferrer">{chatGPT.userCode || "Autorizar"}</a> : <button onClick={() => void connectChatGPT()} disabled={connectingChatGPT}>{connectingChatGPT ? "…" : "Conectar"}</button>}</div><div className={s.connection}><span className={s.ghLogo}>GH</span><div><strong>{githubConnected ? `@${session.user?.login}` : "GitHub"}</strong><small>{githubConnected ? `${repos.length} repos · Copilot disponible` : "Repos + Copilot"}</small></div>{githubConnected ? <button onClick={() => void switchGitHubAccount()}>Cambiar</button> : <a href="/api/auth/github">Conectar</a>}</div>{githubConnected && <button className={s.disconnect} onClick={() => void disconnectGitHub()}>Desconectar GitHub</button>}{connectionError && <div className={s.formError}>{connectionError}</div>}</section>
          {newChatWizard && <div className={s.wizardFooter}><span><strong>Todo listo</strong><small>Después sólo hablás con Supervisor.</small></span><button onClick={() => { setSettingsOpen(false); setNewChatWizard(false); }}>Empezar</button></div>}
        </aside>
      </>}
    </main>
  );
}
