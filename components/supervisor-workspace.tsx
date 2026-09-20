"use client";

import { KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import s from "./supervisor-workspace.module.css";

type Provider = "chatgpt" | "copilot";
type ChatMode = "chat" | "draft" | "pr";
type ThreadStatus = "idle" | "running" | "completed" | "error";

type SessionState = {
  authenticated: boolean;
  githubConnected?: boolean;
  user?: { login: string; avatarUrl?: string | null };
};

type ModelOption = {
  id: string;
  displayName?: string;
  name?: string;
  isDefault?: boolean;
  defaultReasoningEffort?: string | null;
  reasoningEfforts?: { id: string }[];
};

type ChatGPTState = {
  status: "disconnected" | "pending" | "connected" | "failed" | "expired";
  verificationUrl?: string | null;
  userCode?: string | null;
  planType?: string | null;
};

type AgentDefinition = { name: string; displayName: string; description: string; supervisor?: boolean };
type GitHubRepo = { id: number; fullName: string; private: boolean; defaultBranch: string; canPush: boolean };
type StreamEvent = { type: string; agentId?: string; data?: Record<string, unknown> };
type ActiveRun = { controller: AbortController; reader?: ReadableStreamDefaultReader<Uint8Array> };

type ChatMessage = {
  id: string;
  kind: "user" | "agent" | "system" | "pr";
  text: string;
  at: number;
  agent?: string;
  displayName?: string;
  streaming?: boolean;
  tone?: "neutral" | "good" | "bad";
  tool?: { name: string; status: "running" | "success" | "error" };
  pullRequest?: PullRequestRecord;
};

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
  assignment?: string;
};

type PullRequestRecord = {
  url: string;
  repo?: string;
  branch?: string;
  number?: number;
  diffStat?: string;
  at: number;
};

type QueuedPrompt = { id: string; text: string; at: number };

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
  pullRequests: PullRequestRecord[];
  error: string;
};

type ToolArgs = Record<string, unknown>;

const STORAGE_KEY = "epia_control_room_chats_v3";
const ACTIVE_KEY = "epia_control_room_active_chat_v3";
const COPILOT_FALLBACK: ModelOption[] = [{ id: "auto", displayName: "Auto · Copilot decide" }];

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function asString(value: unknown) { return typeof value === "string" ? value : ""; }
function asRecord(value: unknown): ToolArgs {
  if (value && typeof value === "object") return value as ToolArgs;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" ? parsed as ToolArgs : {};
    } catch { return {}; }
  }
  return {};
}
function time(ts: number) {
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(ts);
}
function titleFrom(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean || "Nuevo chat";
}
function modeLabel(mode: ChatMode) {
  if (mode === "pr") return "Repo + PR";
  if (mode === "draft") return "Repo · borrador";
  return "Solo chat";
}
function defaultAgentThread(name: string, displayName?: string, description = ""): AgentThread {
  return { name, displayName: displayName || name.replaceAll("_", " "), description, status: "idle", draft: "", messages: [], updatedAt: Date.now(), unread: 0, error: "" };
}
function defaultChat(): ChatThread {
  const now = Date.now();
  return {
    id: uid("chat"), title: "Nuevo chat", createdAt: now, updatedAt: now,
    mode: "chat", provider: "chatgpt", repo: "", branch: "main", model: "", reasoningEffort: "",
    draft: "", status: "Listo", running: false, messages: [], usedAgents: [], agentThreads: {}, queuedSupervisor: [],
    diffStat: "", prUrl: "", pullRequests: [], error: "",
  };
}
function normalizeChat(input: Partial<ChatThread>): ChatThread {
  const base = { ...defaultChat(), ...input } as ChatThread;
  const threads: Record<string, AgentThread> = { ...(input.agentThreads || {}) };
  const supervisorMessages: ChatMessage[] = [];
  for (const message of input.messages || []) {
    if (message.kind === "agent" && message.agent && message.agent !== "supervisor") {
      const name = message.agent;
      const thread = threads[name] || defaultAgentThread(name, message.displayName);
      threads[name] = { ...thread, messages: [...thread.messages, { ...message, streaming: false }].slice(-120), updatedAt: Math.max(thread.updatedAt || 0, message.at || 0) };
    } else supervisorMessages.push({ ...message, streaming: false });
  }
  for (const [name, thread] of Object.entries(threads)) {
    threads[name] = { ...defaultAgentThread(name, thread.displayName, thread.description), ...thread, status: thread.status === "running" ? "idle" : thread.status, messages: thread.messages.slice(-120).map((m) => ({ ...m, streaming: false })) };
  }
  const legacyPr = input.prUrl ? [{ url: input.prUrl, diffStat: input.diffStat || undefined, at: input.updatedAt || Date.now() }] : [];
  const pullRequests = [...(input.pullRequests || []), ...legacyPr].filter((pr, index, all) => pr?.url && all.findIndex((item) => item.url === pr.url) === index).slice(-30);
  const knownPrs = new Set(supervisorMessages.filter((message) => message.kind === "pr" && message.pullRequest?.url).map((message) => message.pullRequest!.url));
  for (const pr of pullRequests) if (!knownPrs.has(pr.url)) supervisorMessages.push({ id: `pr:${pr.url}`, kind: "pr", text: "Pull Request creado", at: pr.at, agent: "supervisor", displayName: "Supervisor", pullRequest: pr });
  supervisorMessages.sort((a, b) => a.at - b.at);
  return { ...base, running: false, messages: supervisorMessages.slice(-200), agentThreads: threads, queuedSupervisor: input.queuedSupervisor || [], pullRequests };
}

export default function SupervisorWorkspace() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [chatGPT, setChatGPT] = useState<ChatGPTState>({ status: "disconnected" });
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [chatGPTModels, setChatGPTModels] = useState<ModelOption[]>([]);
  const [copilotModels, setCopilotModels] = useState<ModelOption[]>(COPILOT_FALLBACK);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [activeId, setActiveId] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [mobileAgentsOpen, setMobileAgentsOpen] = useState(false);
  const [selectedAgentName, setSelectedAgentName] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [prQuickOpen, setPrQuickOpen] = useState(false);

  const chatsRef = useRef<ChatThread[]>([]);
  const selectedAgentRef = useRef("");
  const agentMaps = useRef<Record<string, Record<string, string>>>({});
  const queueLocks = useRef(new Set<string>());
  const activeRunsRef = useRef(new Map<string, ActiveRun>());
  const endRef = useRef<HTMLDivElement>(null);
  const agentEndRef = useRef<HTMLDivElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { chatsRef.current = chats; }, [chats]);
  useEffect(() => {
    const cancelActiveRuns = () => {
      for (const { controller, reader } of activeRunsRef.current.values()) {
        controller.abort();
        void reader?.cancel();
      }
    };
    window.addEventListener("pagehide", cancelActiveRuns);
    return () => {
      window.removeEventListener("pagehide", cancelActiveRuns);
      cancelActiveRuns();
    };
  }, []);
  useEffect(() => { selectedAgentRef.current = selectedAgentName; }, [selectedAgentName]);
  useEffect(() => {
    if (!settingsOpen) return;
    settingsCloseRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setSettingsOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);
  useEffect(() => { if (!settingsOpen) settingsTriggerRef.current?.focus(); }, [settingsOpen]);

  useEffect(() => {
    Promise.all([
      fetch("/api/session", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/agents", { cache: "no-store" }).then((r) => r.json()),
    ]).then(([sessionBody, agentsBody]) => {
      setSession(sessionBody as SessionState);
      setAgents((agentsBody as { agents?: AgentDefinition[] }).agents ?? []);
    }).catch(() => setSession({ authenticated: true, githubConnected: false }));
    fetch("/api/chatgpt/status", { cache: "no-store" }).then((r) => r.json()).then((body) => setChatGPT(body as ChatGPTState)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(max-width: 940px)").matches) setMobileListOpen(true);
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as Partial<ChatThread>[];
      const restored = saved.filter((chat) => chat?.id).slice(0, 30).map(normalizeChat);
      const next = restored.length ? restored : [defaultChat()];
      setChats(next);
      const wanted = localStorage.getItem(ACTIVE_KEY);
      setActiveId(next.some((chat) => chat.id === wanted) ? wanted! : next[0].id);
    } catch {
      const first = defaultChat();
      setChats([first]); setActiveId(first.id);
    } finally { setHydrated(true); }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const safe = chats.slice(0, 30).map((chat) => ({
      ...chat,
      running: false,
      messages: chat.messages.slice(-200).map((m) => ({ ...m, streaming: false })),
      agentThreads: Object.fromEntries(Object.entries(chat.agentThreads).map(([name, thread]) => [name, { ...thread, status: thread.status === "running" ? "idle" : thread.status, messages: thread.messages.slice(-120).map((m) => ({ ...m, streaming: false })) }])),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [chats, activeId, hydrated]);

  useEffect(() => {
    if (chatGPT.status === "pending") {
      const timer = window.setInterval(() => {
        fetch("/api/chatgpt/status", { cache: "no-store" }).then((r) => r.json()).then((body) => setChatGPT(body as ChatGPTState)).catch(() => undefined);
      }, 2000);
      return () => clearInterval(timer);
    }
  }, [chatGPT.status]);

  useEffect(() => {
    if (chatGPT.status !== "connected") { setChatGPTModels([]); return; }
    fetch("/api/chatgpt/models", { cache: "no-store" }).then((r) => r.json()).then((body) => setChatGPTModels(Array.isArray(body.models) ? body.models as ModelOption[] : [])).catch(() => setChatGPTModels([]));
  }, [chatGPT.status]);

  useEffect(() => {
    if (!session?.githubConnected) { setRepos([]); setCopilotModels(COPILOT_FALLBACK); return; }
    fetch("/api/github/repos", { cache: "no-store" }).then((r) => r.json()).then((body) => setRepos(Array.isArray(body.repos) ? body.repos as GitHubRepo[] : [])).catch(() => setRepos([]));
    fetch("/api/models", { cache: "no-store" }).then((r) => r.json()).then((body) => {
      const models = Array.isArray(body.models) ? body.models as ModelOption[] : [];
      if (!models.some((m) => m.id === "auto")) models.unshift(COPILOT_FALLBACK[0]);
      setCopilotModels(models.length ? models : COPILOT_FALLBACK);
    }).catch(() => setCopilotModels(COPILOT_FALLBACK));
  }, [session?.githubConnected]);

  const active = useMemo(() => chats.find((chat) => chat.id === activeId) ?? chats[0], [chats, activeId]);
  const visibleChats = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...chats].sort((a, b) => b.updatedAt - a.updatedAt).filter((chat) => !q || `${chat.title} ${chat.repo}`.toLowerCase().includes(q));
  }, [chats, search]);
  const parallelThreads = useMemo(() => active ? Object.values(active.agentThreads).sort((a, b) => b.updatedAt - a.updatedAt) : [], [active]);
  const selectedAgentThread = selectedAgentName && active ? active.agentThreads[selectedAgentName] : undefined;
  const models = active?.provider === "copilot" ? copilotModels : chatGPTModels;
  const selectedModel = models.find((m) => m.id === active?.model);
  const githubConnected = Boolean(session?.githubConnected);
  const chatGPTConnected = chatGPT.status === "connected";
  const canSendSupervisor = Boolean(active?.draft.trim() && (active.provider === "copilot" ? githubConnected : chatGPTConnected) && (active.mode === "chat" || active.repo) && (active.mode !== "pr" || githubConnected));
  const sendHint = !active?.draft.trim()
    ? "Escribí un mensaje para continuar."
    : active.provider === "copilot" && !githubConnected
      ? "Conectá GitHub para usar Copilot."
      : active.provider === "chatgpt" && !chatGPTConnected
        ? "Conectá ChatGPT para enviar el mensaje."
        : active.mode !== "chat" && !active.repo
          ? "Elegí un repositorio para este modo."
          : active.mode === "pr" && !githubConnected
            ? "Conectá GitHub para crear un Pull Request."
            : "";

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [active?.messages.length, active?.id]);
  useEffect(() => { agentEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [selectedAgentThread?.messages.length, selectedAgentName]);
  useEffect(() => { setSelectedAgentName(""); setMobileAgentsOpen(false); setPrQuickOpen(false); }, [activeId]);

  useEffect(() => {
    for (const chat of chats) {
      if (chat.running || !chat.queuedSupervisor.length || queueLocks.current.has(chat.id)) continue;
      const next = chat.queuedSupervisor[0];
      queueLocks.current.add(chat.id);
      setChats((current) => current.map((item) => item.id === chat.id ? { ...item, queuedSupervisor: item.queuedSupervisor.slice(1) } : item));
      window.setTimeout(() => {
        void startSupervisorRun(chat.id, next.text, true).finally(() => queueLocks.current.delete(chat.id));
      }, 50);
      break;
    }
  }, [chats]);

  function displayName(name: string) { return agents.find((a) => a.name === name)?.displayName ?? name.replaceAll("_", " "); }
  function description(name: string) { return agents.find((a) => a.name === name)?.description ?? "Especialista del equipo"; }
  function updateChat(chatId: string, fn: (chat: ChatThread) => ChatThread) { setChats((current) => current.map((chat) => chat.id === chatId ? fn(chat) : chat)); }
  function appendSupervisor(chatId: string, message: ChatMessage) { updateChat(chatId, (chat) => ({ ...chat, messages: [...chat.messages, message].slice(-220), updatedAt: Date.now() })); }
  function system(chatId: string, text: string, tone: ChatMessage["tone"] = "neutral") { appendSupervisor(chatId, { id: uid("sys"), kind: "system", text, tone, at: Date.now() }); }

  function updateAgentThread(chatId: string, name: string, fn: (thread: AgentThread) => AgentThread) {
    setChats((current) => current.map((chat) => {
      if (chat.id !== chatId) return chat;
      const existing = chat.agentThreads[name] || defaultAgentThread(name, displayName(name), description(name));
      const next = fn(existing);
      return { ...chat, usedAgents: chat.usedAgents.includes(name) ? chat.usedAgents : [...chat.usedAgents, name], agentThreads: { ...chat.agentThreads, [name]: next }, updatedAt: Date.now() };
    }));
  }
  function appendAgent(chatId: string, name: string, message: ChatMessage, unread = false) {
    updateAgentThread(chatId, name, (thread) => ({ ...thread, messages: [...thread.messages, message].slice(-140), updatedAt: Date.now(), unread: unread && selectedAgentRef.current !== name ? thread.unread + 1 : thread.unread }));
  }
  function upsertAgentReply(chatId: string, name: string, messageId: string, chunk: string, streaming: boolean, replace: boolean) {
    updateAgentThread(chatId, name, (thread) => {
      const index = thread.messages.findIndex((m) => m.id === messageId);
      if (index < 0) {
        const nextMessage: ChatMessage = { id: messageId, kind: "agent", text: chunk, at: Date.now(), agent: name, displayName: displayName(name), streaming };
        return { ...thread, messages: [...thread.messages, nextMessage].slice(-140), updatedAt: Date.now(), unread: selectedAgentRef.current === name ? thread.unread : thread.unread + 1 };
      }
      const messages = [...thread.messages];
      messages[index] = { ...messages[index], text: replace ? chunk : messages[index].text + chunk, streaming };
      return { ...thread, messages, updatedAt: Date.now() };
    });
  }

  function upsertPullRequest(chatId: string, data: Record<string, unknown>) {
    const url = asString(data.prUrl).trim(); if (!url) return;
    const record: PullRequestRecord = { url, repo: asString(data.repo) || undefined, branch: asString(data.branch) || undefined, number: typeof data.prNumber === "number" ? data.prNumber : undefined, diffStat: asString(data.diffStat) || undefined, at: Date.now() };
    updateChat(chatId, (chat) => {
      const pullRequests = [...chat.pullRequests.filter((item) => item.url !== url), record].slice(-30);
      const messages = chat.messages.some((message) => message.kind === "pr" && message.pullRequest?.url === url)
        ? chat.messages.map((message) => message.kind === "pr" && message.pullRequest?.url === url ? { ...message, pullRequest: record, at: record.at } : message)
        : [...chat.messages, { id: `pr:${url}`, kind: "pr", text: "Pull Request creado", at: record.at, agent: "supervisor", displayName: "Supervisor", pullRequest: record } as ChatMessage];
      return { ...chat, prUrl: url, pullRequests, messages: messages.sort((a, b) => a.at - b.at).slice(-220), updatedAt: Date.now() };
    });
  }

  function taskAssignment(data: Record<string, unknown>) {
    if (asString(data.toolName).toLowerCase() !== "task") return null;
    const args = asRecord(data.arguments);
    const name = asString(args.agent_type) || asString(args.agentType) || asString(args.agent_name) || asString(args.agentName) || asString(args.agent);
    const assignment = asString(args.prompt) || asString(args.task) || asString(args.message) || asString(args.description) || asString(args.instructions) || asString(args.objective);
    return name ? { name, assignment } : null;
  }

  function handleSupervisorEvent(chatId: string, runId: string, provider: Provider, model: string, event: StreamEvent) {
    const data = event.data ?? {};
    const agentId = event.agentId || "supervisor";
    if (!agentMaps.current[chatId]) agentMaps.current[chatId] = { supervisor: "supervisor" };
    const map = agentMaps.current[chatId];
    if (event.type === "control.status") {
      const message = asString(data.message); if (message) updateChat(chatId, (chat) => ({ ...chat, status: message, updatedAt: Date.now() })); return;
    }
    if (event.type === "team.loaded") { system(chatId, `Equipo cargado · ${String(data.count ?? agents.length)} agentes disponibles`, "good"); return; }
    if (event.type === "run.started") { system(chatId, `Supervisor inició · ${provider === "copilot" ? "GitHub Copilot" : "ChatGPT / Codex"} · ${model || "auto"}`, "good"); return; }
    if (event.type === "specialist.assigned" || event.type === "subagent.started" || event.type === "subagent.selected") {
      const name = asString(data.agentName) || asString(data.agentDisplayName) || agentId;
      const assignment = asString(data.assignment) || asString(data.objective) || asString(data.instructions);
      if (event.agentId) map[event.agentId] = name;
      updateAgentThread(chatId, name, (thread) => ({ ...thread, status: "running", assignment: assignment || thread.assignment, error: "", updatedAt: Date.now() }));
      if (assignment) appendAgent(chatId, name, { id: `assignment:${event.agentId || name}`, kind: "system", text: `Supervisor pidió: ${assignment}`, at: Date.now() });
      if (event.type !== "specialist.assigned") system(chatId, `Supervisor delegó trabajo a ${displayName(name)}`);
      return;
    }
    if (event.type === "subagent.completed" || event.type === "subagent.failed") {
      const name = asString(data.agentName) || map[agentId] || agentId;
      const failed = event.type === "subagent.failed";
      updateAgentThread(chatId, name, (thread) => ({ ...thread, status: failed ? "error" : "completed", error: failed ? asString(data.error) || "El especialista falló" : "", updatedAt: Date.now() }));
      appendAgent(chatId, name, { id: uid("agent-state"), kind: "system", text: failed ? "El especialista encontró un error" : "Trabajo entregado al Supervisor", tone: failed ? "bad" : "good", at: Date.now() }, true);
      return;
    }
    if (event.type === "tool.started") {
      const assignment = taskAssignment(data);
      if (assignment && assignment.name !== "supervisor") {
        updateAgentThread(chatId, assignment.name, (thread) => ({ ...thread, status: "running", updatedAt: Date.now() }));
        if (assignment.assignment) appendAgent(chatId, assignment.name, { id: uid("assignment"), kind: "system", text: `Supervisor → ${assignment.assignment}`, at: Date.now() });
        return;
      }
      const name = map[agentId] || agentId;
      const text = `${displayName(name)} usa ${asString(data.toolName) || "una herramienta"}`;
      if (name === "supervisor") updateChat(chatId, (chat) => ({ ...chat, messages: [...chat.messages, { id: uid("tool"), kind: "system", text, tool: { name: asString(data.toolName) || "una herramienta", status: "running" }, at: Date.now() } as ChatMessage].slice(-220), updatedAt: Date.now() }));
      else appendAgent(chatId, name, { id: uid("tool"), kind: "system", text, tool: { name: asString(data.toolName) || "una herramienta", status: "running" }, at: Date.now() });
      return;
    }
    if (event.type === "tool.completed") {
      const name = map[agentId] || agentId; const failed = data.success === false; const toolName = asString(data.toolName) || "una herramienta";
      const text = failed ? `Herramienta de ${displayName(name)} falló` : `${displayName(name)} terminó una herramienta`;
      const message: ChatMessage = { id: uid(failed ? "tool-error" : "tool-done"), kind: "system", text, tone: failed ? "bad" : "good", tool: { name: toolName, status: failed ? "error" : "success" }, at: Date.now() };
      if (name === "supervisor") updateChat(chatId, (chat) => ({ ...chat, messages: [...chat.messages, message].slice(-220), updatedAt: Date.now() }));
      else appendAgent(chatId, name, message, failed);
      return;
    }
    if (event.type === "agent.delta" || event.type === "agent.message") {
      const name = map[agentId] || agentId; const chunk = asString(data.content); if (!chunk) return;
      const messageId = `${runId}:${asString(data.messageId) || agentId}`;
      if (name !== "supervisor") { upsertAgentReply(chatId, name, messageId, chunk, event.type === "agent.delta", event.type === "agent.message"); return; }
      updateChat(chatId, (chat) => {
        const index = chat.messages.findIndex((m) => m.id === messageId);
        if (index < 0) {
          const message: ChatMessage = { id: messageId, kind: "agent", text: chunk, at: Date.now(), agent: "supervisor", displayName: "Supervisor", streaming: event.type === "agent.delta" };
          return { ...chat, messages: [...chat.messages, message].slice(-220), updatedAt: Date.now() };
        }
        const messages = [...chat.messages]; messages[index] = { ...messages[index], text: event.type === "agent.message" ? chunk : messages[index].text + chunk, streaming: event.type === "agent.delta" };
        return { ...chat, messages, updatedAt: Date.now() };
      });
      return;
    }
    if (event.type === "workspace.diff") { const diffStat = asString(data.diffStat); updateChat(chatId, (chat) => ({ ...chat, diffStat, updatedAt: Date.now() })); return; }
    if (event.type === "control.done") {
      const prUrl = asString(data.prUrl); const diffStat = asString(data.diffStat);
      if (prUrl) upsertPullRequest(chatId, data);
      updateChat(chatId, (chat) => ({ ...chat, running: false, status: "Turno completado", diffStat: diffStat || chat.diffStat, error: "", updatedAt: Date.now() })); return;
    }
    if (event.type === "control.error" || event.type === "run.failed") {
      const message = asString(data.message) || "La ejecución falló";
      updateChat(chatId, (chat) => ({ ...chat, running: false, status: "Turno detenido", error: message, updatedAt: Date.now() })); system(chatId, message, "bad");
    }
  }

  function specialistContext(chat: ChatThread) {
    return Object.values(chat.agentThreads).filter((thread) => thread.messages.some((m) => m.kind === "user" || m.kind === "agent")).slice(0, 10).map((thread) => {
      const lines = thread.messages.filter((m) => m.kind === "user" || m.kind === "agent").slice(-8).map((m) => `${m.kind === "user" ? "USUARIO" : thread.displayName}: ${m.text}`);
      return `HILO ${thread.displayName}:\n${lines.join("\n")}`;
    }).join("\n\n").slice(0, 16000);
  }

  async function startSupervisorRun(chatId: string, explicitPrompt?: string, alreadyAppended = false) {
    const thread = chatsRef.current.find((chat) => chat.id === chatId); if (!thread || thread.running) return;
    const prompt = (explicitPrompt ?? thread.draft).trim(); if (!prompt) return;
    const runId = uid("run");
    const controller = new AbortController();
    activeRunsRef.current.set(runId, { controller });
    agentMaps.current[chatId] = { supervisor: "supervisor" };
    const history = thread.messages.filter((m) => m.kind === "user" || m.kind === "agent").slice(-12).map((m) => `${m.kind === "user" ? "USUARIO" : "SUPERVISOR"}: ${m.text}`).join("\n\n");
    const specialist = specialistContext(thread);
    const requestPrompt = [history ? `CONTEXTO DEL CHAT CON SUPERVISOR:\n${history}` : "", specialist ? `INTERVENCIONES DIRECTAS CON ESPECIALISTAS:\n${specialist}` : "", `NUEVO PEDIDO DEL USUARIO:\n${prompt}`].filter(Boolean).join("\n\n");
    updateChat(chatId, (chat) => ({ ...chat, title: chat.title === "Nuevo chat" ? titleFrom(prompt) : chat.title, draft: "", running: true, status: "Supervisor está preparando el turno…", error: "", updatedAt: Date.now(), messages: alreadyAppended ? chat.messages : [...chat.messages, { id: `${runId}:user`, kind: "user", text: prompt, at: Date.now() } as ChatMessage].slice(-220) }));
    try {
      const endpoint = thread.mode === "pr" ? "/api/run" : thread.provider === "copilot" ? "/api/copilot-run" : "/api/chat-run";
      const payload = thread.mode === "pr"
        ? { repo: thread.repo, branch: thread.branch, provider: thread.provider, model: thread.model, reasoningEffort: thread.reasoningEffort, prompt: requestPrompt }
        : { mode: thread.mode, repo: thread.repo, branch: thread.branch, model: thread.model, reasoningEffort: thread.reasoningEffort, prompt: requestPrompt };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
      const reader = response.body.getReader();
      activeRunsRef.current.get(runId)!.reader = reader;
      const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (controller.signal.aborted) break;
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (controller.signal.aborted) break;
          if (raw.trim()) handleSupervisorEvent(chatId, runId, thread.provider, thread.model, JSON.parse(raw) as StreamEvent);
        }
        if (done || controller.signal.aborted) break;
      }
      if (!controller.signal.aborted && buffer.trim()) handleSupervisorEvent(chatId, runId, thread.provider, thread.model, JSON.parse(buffer) as StreamEvent);
    } catch (error) {
      const interrupted = controller.signal.aborted;
      const message = interrupted ? "La ejecución fue interrumpida." : error instanceof Error ? error.message : String(error);
      updateChat(chatId, (chat) => ({ ...chat, running: false, status: interrupted ? "Turno interrumpido" : "Turno detenido", error: message, updatedAt: Date.now() }));
      system(chatId, message, "bad");
    } finally {
      activeRunsRef.current.delete(runId);
      updateChat(chatId, (chat) => chat.running ? { ...chat, running: false, updatedAt: Date.now() } : chat);
    }
  }

  function sendSupervisor() {
    if (!active || !active.draft.trim() || !canSendSupervisor) return;
    const text = active.draft.trim();
    if (active.running) {
      const queued: QueuedPrompt = { id: uid("queued"), text, at: Date.now() };
      updateChat(active.id, (chat) => ({ ...chat, draft: "", queuedSupervisor: [...chat.queuedSupervisor, queued], messages: [...chat.messages, { id: queued.id, kind: "user", text, at: queued.at } as ChatMessage].slice(-220), updatedAt: Date.now() })); return;
    }
    void startSupervisorRun(active.id, text);
  }

  async function startAgentRun(chatId: string, name: string) {
    const parent = chatsRef.current.find((chat) => chat.id === chatId); const thread = parent?.agentThreads[name];
    if (!parent || !thread || thread.status === "running" || !thread.draft.trim()) return;
    const prompt = thread.draft.trim(); const runId = uid("agent-run");
    const controller = new AbortController();
    activeRunsRef.current.set(runId, { controller });
    const supervisorContext = parent.messages.filter((m) => m.kind === "user" || m.kind === "agent").slice(-8).map((m) => `${m.kind === "user" ? "USUARIO" : "SUPERVISOR"}: ${m.text}`).join("\n\n");
    const directHistory = thread.messages.filter((m) => m.kind === "user" || m.kind === "agent").slice(-10).map((m) => `${m.kind === "user" ? "USUARIO" : thread.displayName}: ${m.text}`).join("\n\n");
    const requestPrompt = [supervisorContext ? `CONTEXTO DEL SUPERVISOR:\n${supervisorContext}` : "", directHistory ? `HISTORIAL DE ESTE HILO:\n${directHistory}` : "", `NUEVO AJUSTE DEL USUARIO:\n${prompt}`].filter(Boolean).join("\n\n");
    updateAgentThread(chatId, name, (current) => ({ ...current, draft: "", status: "running", error: "", unread: 0, messages: [...current.messages, { id: `${runId}:user`, kind: "user", text: prompt, at: Date.now() } as ChatMessage].slice(-140), updatedAt: Date.now() }));
    try {
      const response = await fetch("/api/agent-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: parent.provider, agentName: name, prompt: requestPrompt, repo: parent.repo, branch: parent.branch, model: parent.model, reasoningEffort: parent.reasoningEffort }), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
      const reader = response.body.getReader();
      activeRunsRef.current.get(runId)!.reader = reader;
      const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (controller.signal.aborted) break;
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (controller.signal.aborted) break;
          if (raw.trim()) handleAgentEvent(chatId, name, runId, JSON.parse(raw) as StreamEvent);
        }
        if (done || controller.signal.aborted) break;
      }
      if (!controller.signal.aborted && buffer.trim()) handleAgentEvent(chatId, name, runId, JSON.parse(buffer) as StreamEvent);
      if (!controller.signal.aborted) {
        updateAgentThread(chatId, name, (current) => current.status === "running" ? { ...current, status: "completed", updatedAt: Date.now() } : current);
        system(chatId, `Intervención con ${displayName(name)} actualizada · Supervisor la incorpora en el próximo turno`, "good");
      }
    } catch (error) {
      const interrupted = controller.signal.aborted;
      const message = interrupted ? "La ejecución fue interrumpida." : error instanceof Error ? error.message : String(error);
      updateAgentThread(chatId, name, (current) => ({ ...current, status: "error", error: message, updatedAt: Date.now() }));
      appendAgent(chatId, name, { id: uid("agent-error"), kind: "system", text: message, tone: "bad", at: Date.now() }, true);
    } finally {
      activeRunsRef.current.delete(runId);
    }
  }

  function handleAgentEvent(chatId: string, name: string, runId: string, event: StreamEvent) {
    const data = event.data ?? {};
    if (event.type === "tool.started") { const toolName = asString(data.toolName) || "una herramienta"; appendAgent(chatId, name, { id: uid("direct-tool"), kind: "system", text: `${displayName(name)} usa ${toolName}`, tool: { name: toolName, status: "running" }, at: Date.now() }); return; }
    if (event.type === "tool.completed") { const failed = data.success === false; const toolName = asString(data.toolName) || "una herramienta"; appendAgent(chatId, name, { id: uid(failed ? "direct-tool-error" : "direct-tool-done"), kind: "system", text: failed ? `Herramienta de ${displayName(name)} falló` : `${displayName(name)} terminó ${toolName}`, tone: failed ? "bad" : "good", tool: { name: toolName, status: failed ? "error" : "success" }, at: Date.now() }, failed); return; }
    if (event.type === "agent.delta" || event.type === "agent.message") { const chunk = asString(data.content); if (!chunk) return; upsertAgentReply(chatId, name, `${runId}:${asString(data.messageId) || name}`, chunk, event.type === "agent.delta", event.type === "agent.message"); return; }
    if (event.type === "control.error" || event.type === "run.failed") { const message = asString(data.message) || "El especialista falló"; updateAgentThread(chatId, name, (thread) => ({ ...thread, status: "error", error: message, updatedAt: Date.now() })); }
  }

  function renderToolGroups(messages: ChatMessage[], actor: string, renderMessage: (message: ChatMessage) => ReactNode) {
    const rendered: ReactNode[] = [];
    for (let index = 0; index < messages.length;) {
      const message = messages[index];
      if (!message.tool) { rendered.push(renderMessage(message)); index += 1; continue; }
      const group: ChatMessage[] = [];
      while (index < messages.length && messages[index].tool) { group.push(messages[index]); index += 1; }
      const hasError = group.some((item) => item.tool?.status === "error");
      const running = group.some((item) => item.tool?.status === "running");
      rendered.push(<details className={`${s.toolGroup} ${hasError ? s.toolGroupError : ""}`} key={`tools-${group[0].id}`}>
        <summary><span className={running ? s.spinner : undefined} /><strong>{running ? `${actor} está trabajando…` : `${actor} trabajó`}</strong><small>{group.length} {group.length === 1 ? "acción" : "acciones"} · {hasError ? "con errores" : "ver detalles"}</small></summary>
        <div>{group.map((item) => <p key={item.id} className={item.tone === "bad" ? s.systemBad : item.tone === "good" ? s.systemGood : ""}>{item.tool?.status === "error" ? "✕" : item.tool?.status === "success" ? "✓" : "•"} {item.text}</p>)}</div>
      </details>);
    }
    return rendered;
  }

  function renderSupervisorMessage(message: ChatMessage) {
    if (message.kind === "system") return <div key={message.id} className={`${s.system} ${message.tone === "good" ? s.systemGood : message.tone === "bad" ? s.systemBad : ""}`}>{message.text}</div>;
    if (message.kind === "user") return <div className={`${s.row} ${s.userRow}`} key={message.id}><article className={`${s.bubble} ${s.userBubble}`}><div>{message.text}</div><time>{time(message.at)}</time></article></div>;
    if (message.kind === "pr" && message.pullRequest) return <div className={`${s.row} ${s.agentRow}`} key={message.id}><span className={s.messageAvatar}>S</span><article className={`${s.bubble} ${s.agentBubble} ${s.prMessage}`}><div className={s.author}><strong>Supervisor</strong><span>Pull Request</span></div><div>{message.text}</div><a href={message.pullRequest.url} target="_blank" rel="noreferrer">{message.pullRequest.repo || message.pullRequest.url} {message.pullRequest.number ? `#${message.pullRequest.number}` : "↗"}</a>{message.pullRequest.branch && <small>{message.pullRequest.branch}</small>}{message.pullRequest.diffStat && <pre>{message.pullRequest.diffStat}</pre>}<time>{time(message.at)}</time></article></div>;
    return <div className={`${s.row} ${s.agentRow}`} key={message.id}><span className={s.messageAvatar}>S</span><article className={`${s.bubble} ${s.agentBubble}`}><div className={s.author}><strong>Supervisor</strong></div><div className={s.aiResponse}><MessageResponse>{message.text}</MessageResponse></div><time>{time(message.at)}</time></article></div>;
  }

  function renderAgentMessage(message: ChatMessage, thread: AgentThread) {
    if (message.kind === "system") return <div key={message.id} className={`${s.agentSystem} ${message.tone === "bad" ? s.agentSystemBad : ""}`}>{message.text}</div>;
    if (message.kind === "user") return <div key={message.id} className={s.agentUserBubble}>{message.text}<time>{time(message.at)}</time></div>;
    return <div key={message.id} className={s.agentReply}><strong>{thread.displayName}</strong><MessageResponse>{message.text}</MessageResponse><time>{time(message.at)}</time></div>;
  }

  function createChat() {
    const chat = defaultChat(); const useCopilot = Boolean(githubConnected && !chatGPTConnected); chat.provider = useCopilot ? "copilot" : "chatgpt"; chat.model = useCopilot ? "auto" : "";
    setChats((current) => [chat, ...current]); setActiveId(chat.id); setMobileListOpen(false); setSettingsOpen(true);
  }
  function openAgent(name: string) { setSelectedAgentName(name); setMobileAgentsOpen(true); updateAgentThread(active.id, name, (thread) => ({ ...thread, unread: 0 })); }
  function setRepo(fullName: string) { const repo = repos.find((r) => r.fullName === fullName); updateChat(active.id, (chat) => ({ ...chat, repo: fullName, branch: repo?.defaultBranch || "main" })); }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendSupervisor(); } }

  if (!hydrated || !session || !active) return <main className={s.loading}><div>S</div><p>Inicializando Supervisor…</p></main>;

  return (
    <main className={`${s.app} ${mobileListOpen ? s.showList : ""} ${mobileAgentsOpen ? s.showAgents : ""}`}>
      <aside className={s.sidebar}>
        <div className={s.listHeader}><button aria-label="Abrir configuración" className={s.circleButton} onClick={() => setSettingsOpen(true)}>•••</button><h1>Chats</h1><button aria-label="Crear chat" className={s.addChatButton} onClick={createChat}>＋</button></div>
        <label className={s.search}><span>⌕</span><input aria-label="Buscar chats" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar chats" /></label>
        <div className={s.threadList}>{visibleChats.length === 0 ? <div className={s.emptyList} role="status"><strong>No hay chats que coincidan</strong><span>Probá con otro término de búsqueda.</span><button type="button" onClick={() => setSearch("")}>Limpiar búsqueda</button></div> : visibleChats.map((chat) => <div className={`${s.thread} ${chat.id === active.id ? s.threadActive : ""}`} key={chat.id}><button aria-label={`Abrir chat ${chat.title}`} aria-current={chat.id === active.id ? "page" : undefined} className={s.threadMain} onClick={() => { setActiveId(chat.id); setMobileListOpen(false); }}><span className={s.threadAvatar}>S</span><span className={s.threadBody}><span className={s.threadTitle}><strong>{chat.title}</strong><time>{time(chat.updatedAt)}</time></span><span className={s.threadPreview}>{chat.running && <span className={s.spinner} />}<span>{chat.error || chat.status}</span></span><span className={s.threadMeta}>Supervisor · {chat.provider === "copilot" ? "Copilot" : "ChatGPT"}{chat.repo ? ` · ${chat.repo}` : ""}</span></span></button></div>)}</div>
        <div className={s.accountBar}><button className={s.accountButton} onClick={() => setSettingsOpen(true)}>{session.user?.avatarUrl ? <img src={session.user.avatarUrl} alt="" /> : <span>ME</span>}<span><strong>{githubConnected ? `@${session.user?.login}` : "Conexiones"}</strong><small>{githubConnected ? "Copilot disponible" : chatGPTConnected ? "ChatGPT conectado" : "Configurar"}</small></span></button></div>
      </aside>

      <section className={s.supervisorPane}>
        <header className={s.chatHeader}><button aria-label="Volver a chats" className={s.mobileBack} onClick={() => setMobileListOpen(true)}>‹</button><span className={s.supervisorAvatar}>S</span><div className={s.headerCopy}><strong>Supervisor</strong><span>{active.title} · {active.running ? active.status : "listo"}</span></div><button aria-label="Abrir chats de agentes" className={s.agentToggle} onClick={() => setMobileAgentsOpen(true)}>{parallelThreads.length ? `${parallelThreads.length} agentes` : "Agentes"}</button><button ref={settingsTriggerRef} aria-label="Abrir configuración" aria-expanded={settingsOpen} aria-controls="supervisor-settings" className={s.iconButton} onClick={() => setSettingsOpen(true)}>⚙</button></header>
        <div className={s.contextBar}><span>{modeLabel(active.mode)}</span><span>{active.provider === "copilot" ? "Copilot" : "ChatGPT"} · {selectedModel?.displayName || selectedModel?.name || active.model || "modelo"}</span>{active.repo && <span>repo · {active.repo}</span>}{active.queuedSupervisor.length > 0 && <span className={s.queueChip}>{active.queuedSupervisor.length} en cola</span>}{active.pullRequests.length > 0 && <button type="button" className={s.prQuickButton} aria-label={`Abrir lista de ${active.pullRequests.length} Pull Requests`} aria-expanded={prQuickOpen} onClick={() => setPrQuickOpen((open) => !open)}>PRs · {active.pullRequests.length}</button>}</div>
        <div className={s.messages}><div className={s.stack}>{prQuickOpen && active.pullRequests.length > 0 && <section className={s.prQuickList} aria-label="Lista rápida de Pull Requests"><div className={s.prQuickHeader}><strong>Pull Requests del chat</strong><button type="button" aria-label="Cerrar lista de Pull Requests" onClick={() => setPrQuickOpen(false)}>×</button></div>{active.pullRequests.slice().reverse().map((pr) => <a className={s.prQuickItem} key={pr.url} href={pr.url} target="_blank" rel="noreferrer"><span>{pr.repo || pr.url} {pr.number ? `#${pr.number}` : "↗"}</span><small>{pr.branch || "Abrir en GitHub"}</small></a>)}</section>}{active.messages.length === 0 && <div className={s.welcome}><div className={s.welcomeAvatar}>S</div><h1>Hablá con Supervisor</h1><p>Supervisor coordina el equipo. Los especialistas aparecen a la derecha como chats paralelos.</p></div>}{renderToolGroups(active.messages, "Supervisor", renderSupervisorMessage)}{active.pullRequests.length === 0 && active.diffStat && <div className={s.delivery}><strong>Cambios preparados</strong><pre>{active.diffStat}</pre></div>}<div ref={endRef} /></div></div>
        <footer className={s.composerShell}>{active.running && <div className={s.runningBanner} role="status" aria-live="polite"><span className={s.spinner} /><div><strong>{parallelThreads.some((thread) => thread.status === "running") ? `Coordinando con ${parallelThreads.filter((thread) => thread.status === "running").map((thread) => thread.displayName).join(", ")}` : "Supervisor está pensando…"}</strong><small>{active.status}</small></div>{active.queuedSupervisor.length > 0 && <b>{active.queuedSupervisor.length} en cola</b>}</div>}{active.error && <div className={s.errorBanner} role="alert"><strong>Ocurrió un error:</strong> {active.error} <span>Tu contexto y borrador se conservaron; podés reintentar.</span></div>}<div className={s.composer}><button aria-label="Abrir configuración" className={s.plus} onClick={() => setSettingsOpen(true)}>＋</button><textarea aria-label="Mensaje a Supervisor" aria-describedby="supervisor-send-hint" value={active.draft} onChange={(e) => updateChat(active.id, (chat) => ({ ...chat, draft: e.target.value }))} onKeyDown={keyDown} placeholder={active.running ? "Escribí otra instrucción; queda en cola…" : "Mensaje a Supervisor…"} rows={1} /><button aria-label="Enviar mensaje" className={s.send} onClick={sendSupervisor} disabled={!canSendSupervisor}>➤</button>{sendHint && <small id="supervisor-send-hint" className={s.composerHint}>{sendHint}</small>}</div></footer>
      </section>

      <aside className={s.agentRail}>
        <div className={s.agentRailHeader}>{selectedAgentThread ? <button aria-label="Volver a la lista de especialistas" onClick={() => setSelectedAgentName("")}>‹</button> : <span className={s.railMark}>⇶</span>}<div><strong>{selectedAgentThread ? selectedAgentThread.displayName : "Chats paralelos"}</strong><span>{selectedAgentThread ? "Especialista · solo lectura" : `${parallelThreads.length} especialistas activos`}</span></div><button aria-label="Cerrar chats de agentes" className={s.mobileAgentClose} onClick={() => setMobileAgentsOpen(false)}>×</button></div>
        {!selectedAgentThread ? <div className={s.agentList}>{parallelThreads.length === 0 && <div className={s.agentEmpty}><div>⇶</div><strong>Todavía no hay especialistas</strong><p>Cuando Supervisor delegue trabajo, cada agente aparece acá.</p></div>}{parallelThreads.map((thread) => { const last = [...thread.messages].reverse().find((m) => m.text); return <button className={s.agentListItem} key={thread.name} onClick={() => openAgent(thread.name)}><span className={s.agentAvatar}>{thread.displayName[0]?.toUpperCase() || "A"}</span><span><strong>{thread.displayName}</strong><small>{thread.assignment || last?.text || thread.description}</small></span><span className={`${s.agentStatus} ${thread.status === "running" ? s.agentRunning : thread.status === "error" ? s.agentError : s.agentDone}`}>{thread.status === "running" ? "●" : thread.status === "error" ? "!" : thread.status === "completed" ? "✓" : ""}{thread.unread > 0 && <b>{thread.unread}</b>}</span></button>; })}</div> : <div className={s.agentConversation}><div className={s.agentNotice}>Pedido actual: {selectedAgentThread.assignment || "Aún no hay una consigna registrada."}<br />Este hilo no modifica archivos. Tus ajustes se agregan al contexto del próximo turno de Supervisor.</div><div className={s.agentMessages}>{selectedAgentThread.description && <div className={s.agentSystem}>Rol · {selectedAgentThread.description}</div>}{renderToolGroups(selectedAgentThread.messages, selectedAgentThread.displayName, (message) => renderAgentMessage(message, selectedAgentThread))}<div ref={agentEndRef} /></div><div className={s.agentComposer}><textarea aria-label={`Ajustar pedido a ${selectedAgentThread.displayName}`} value={selectedAgentThread.draft} onChange={(e) => updateAgentThread(active.id, selectedAgentThread.name, (thread) => ({ ...thread, draft: e.target.value }))} placeholder={`Ajustar pedido a ${selectedAgentThread.displayName}…`} disabled={selectedAgentThread.status === "running"} rows={1} /><button aria-label="Enviar ajuste al especialista" onClick={() => void startAgentRun(active.id, selectedAgentThread.name)} disabled={!selectedAgentThread.draft.trim() || selectedAgentThread.status === "running"}>➤</button></div></div>}
      </aside>

      {settingsOpen && <><button aria-label="Cerrar configuración" className={s.settingsBackdrop} onClick={() => setSettingsOpen(false)} /><aside id="supervisor-settings" className={s.settings} role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className={s.sheetHandle} /><div className={s.settingsHeader}><div><strong id="settings-title">Configuración de Supervisor</strong><span>Proveedor, modelo, repo y entrega.</span></div><button ref={settingsCloseRef} aria-label="Cerrar configuración" className={s.iconButton} onClick={() => setSettingsOpen(false)}>×</button></div><section className={s.section}><div className={s.sectionTitle}>Modo</div><div className={s.modeGrid}>{(["chat","draft","pr"] as ChatMode[]).map((mode) => <button key={mode} className={active.mode === mode ? s.modeActive : ""} onClick={() => updateChat(active.id, (chat) => ({ ...chat, mode, repo: mode === "chat" ? "" : chat.repo }))}><strong>{modeLabel(mode)}</strong></button>)}</div></section><section className={s.section}><div className={s.sectionTitle}>IA</div><div className={s.grid}><label>Proveedor<select value={active.provider} onChange={(e) => updateChat(active.id, (chat) => ({ ...chat, provider: e.target.value as Provider, model: e.target.value === "copilot" ? "auto" : chat.model }))}><option value="chatgpt">ChatGPT / Codex</option><option value="copilot" disabled={!githubConnected}>GitHub Copilot</option></select></label><label>Modelo<select value={active.model} onChange={(e) => updateChat(active.id, (chat) => ({ ...chat, model: e.target.value }))}>{models.map((m) => <option key={m.id} value={m.id}>{m.displayName || m.name || m.id}</option>)}</select></label></div></section>{active.mode !== "chat" && <section className={s.section}><div className={s.sectionTitle}>Repositorio</div><div className={s.repoRow}><select value={active.repo} onChange={(e) => setRepo(e.target.value)}><option value="">Elegí un repo…</option>{repos.map((repo) => <option key={repo.id} value={repo.fullName}>{repo.private ? "🔒 " : ""}{repo.fullName}</option>)}</select></div></section>}<section className={s.section}><div className={s.sectionTitle}>Conexiones</div><div className={s.connection}><span className={s.gptLogo}>GPT</span><div><strong>{chatGPTConnected ? "ChatGPT conectado" : "ChatGPT"}</strong><small>{chatGPT.planType || "Codex"}</small></div>{chatGPTConnected ? <button onClick={() => fetch("/api/chatgpt/logout", { method: "POST" }).then(() => setChatGPT({ status: "disconnected" }))}>Salir</button> : <button onClick={() => fetch("/api/chatgpt/login", { method: "POST" }).then((r) => r.json()).then((body) => setChatGPT(body as ChatGPTState)).catch((error) => setConnectionError(String(error)))}>Conectar</button>}</div><div className={s.connection}><span className={s.ghLogo}>GH</span><div><strong>{githubConnected ? `@${session.user?.login}` : "GitHub"}</strong><small>Repos + Copilot</small></div>{!githubConnected && <a href="/api/auth/github">Conectar</a>}</div>{connectionError && <div className={s.formError}>{connectionError}</div>}</section></aside></>}
    </main>
  );
}
