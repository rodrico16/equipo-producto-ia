"use client";

import { KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import s from "./supervisor-workspace.module.css";

type Provider = "chatgpt" | "copilot" | "apple";
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
type Attachment = { name: string; type: string; data: string; size: number };
type AttachmentLabel = { name: string; type: string };

type ChatMessage = {
  id: string;
  kind: "user" | "agent" | "system" | "pr";
  text: string;
  attachments?: AttachmentLabel[];
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
  runId?: string;
  retryPrompt?: string;
  retryNeedsAttachments?: boolean;
  continuationPrompt?: string;
};

type ToolArgs = Record<string, unknown>;

const STORAGE_KEY = "epia_control_room_chats_v3";
const ACTIVE_KEY = "epia_control_room_active_chat_v3";
const COPILOT_FALLBACK: ModelOption[] = [{ id: "auto", displayName: "Auto · Copilot decide" }];
const APPLE_INTELLIGENCE_MODEL: ModelOption = { id: "apple-intelligence", displayName: "Apple Intelligence · iPhone" };
const VERCEL_HOBBY_SOFT_TIMEOUT_MS = 285_000;

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function asString(value: unknown) { return typeof value === "string" ? value : ""; }
function pullRequestNumber(pr: PullRequestRecord, repo: string) {
  try {
    const url = new URL(pr.url);
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);
    if (url.origin !== "https://github.com" || !match || `${match[1]}/${match[2]}`.toLowerCase() !== repo.toLowerCase()) return undefined;
    return pr.number || Number(match[3]);
  } catch { return undefined; }
}
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
function continuationPromptFor(reason: string) {
  return [
    "Continuá el turno anterior usando el contexto visible de este chat.",
    `Motivo de la pausa: ${reason}`,
    "Primero revisá lo ya conversado y cualquier salida parcial, luego seguí desde el punto más útil sin repetir trabajo innecesario.",
    "Si no hay evidencia suficiente para afirmar que una acción terminó, verificá antes de declararla completada.",
  ].join("\n");
}
function modeLabel(mode: ChatMode) {
  if (mode === "pr") return "Repo + PR";
  if (mode === "draft") return "Repo · borrador";
  return "Solo chat";
}
function providerLabel(provider: Provider) {
  if (provider === "copilot") return "GitHub Copilot";
  if (provider === "apple") return "Apple Intelligence";
  return "ChatGPT / Codex";
}
function isIPhoneRuntime() {
  const ua = navigator.userAgent || "";
  return /\biPhone\b/i.test(ua);
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
    diffStat: "", prUrl: "", pullRequests: [], error: "", runId: "",
  };
}
function normalizeChat(input: Partial<ChatThread>): ChatThread {
  const base = { ...defaultChat(), ...input } as ChatThread;
  const threads: Record<string, AgentThread> = { ...(input.agentThreads || {}) };
  const supervisorMessages: ChatMessage[] = [];
  for (const message of input.messages || []) {
    // Older sessions persisted these setup notices once per turn. Hide them on
    // restore so an existing conversation benefits from the cleaner timeline.
    if (message.kind === "system" && /^(Equipo cargado · \d+ agentes disponibles|Supervisor inició · (GitHub Copilot|ChatGPT \/ Codex) · .+)$/.test(message.text)) continue;
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
  return { ...base, running: Boolean(base.running && base.runId), messages: supervisorMessages.slice(-200), agentThreads: threads, queuedSupervisor: input.queuedSupervisor || [], pullRequests };
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
  const [pendingAttachments, setPendingAttachments] = useState<Record<string, Attachment[]>>({});
  const [attachmentError, setAttachmentError] = useState("");
  const [isIPhone, setIsIPhone] = useState(false);

  const chatsRef = useRef<ChatThread[]>([]);
  const selectedAgentRef = useRef("");
  const agentMaps = useRef<Record<string, Record<string, string>>>({});
  const queueLocks = useRef(new Set<string>());
  const retryLocks = useRef(new Set<string>());
  const activeRunsRef = useRef(new Map<string, ActiveRun>());
  const endRef = useRef<HTMLDivElement>(null);
  const agentEndRef = useRef<HTMLDivElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const supervisorFileRef = useRef<HTMLInputElement>(null);
  const agentFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { chatsRef.current = chats; }, [chats]);
  // Closing the mobile browser must not explicitly cancel an in-flight server run.
  useEffect(() => { selectedAgentRef.current = selectedAgentName; }, [selectedAgentName]);
  useEffect(() => {
    if (!settingsOpen) return;
    settingsCloseRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setSettingsOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);
  useEffect(() => { if (!settingsOpen) settingsTriggerRef.current?.focus(); }, [settingsOpen]);
  useEffect(() => { setIsIPhone(isIPhoneRuntime()); }, []);

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
      running: Boolean(chat.running && chat.runId),
      messages: chat.messages.slice(-200).map((m) => ({ ...m, streaming: false })),
      agentThreads: Object.fromEntries(Object.entries(chat.agentThreads).map(([name, thread]) => [name, { ...thread, status: thread.status === "running" ? "idle" : thread.status, messages: thread.messages.slice(-120).map((m) => ({ ...m, streaming: false })) }])),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [chats, activeId, hydrated]);

  useEffect(() => {
    if (!hydrated || isIPhone || !chats.some((chat) => chat.provider === "apple")) return;
    setChats((current) => current.map((chat) => chat.provider === "apple" ? { ...chat, provider: "chatgpt", model: "", mode: "chat", repo: "" } : chat));
  }, [hydrated, isIPhone, chats]);

  useEffect(() => {
    if (!hydrated) return;
    const recover = async () => {
      for (const chat of chatsRef.current) {
        if (!chat.runId || (!chat.running && chat.status !== "Estado por confirmar")) continue;
        if (activeRunsRef.current.has(chat.runId)) continue;
        try {
          const response = await fetch(`/api/runs/${encodeURIComponent(chat.runId)}`, { cache: "no-store" });
          if (response.status === 404) {
            updateChat(chat.id, (current) => current.status === "Estado por confirmar" && current.continuationPrompt ? current : ({
              ...current,
              running: false,
              runId: "",
              status: "Estado por confirmar",
              error: "No se puede verificar el estado de este turno. El servidor no conserva su registro tras un reinicio o al llegar al límite de Vercel Hobby. Podés continuar con el contexto guardado en este chat.",
              continuationPrompt: continuationPromptFor("el servidor perdió el registro del turno en curso"),
              updatedAt: Date.now(),
            }));
            continue;
          }
          if (!response.ok) continue;
          const state = await response.json() as { status?: string; error?: string };
          if (state.status === "completed") updateChat(chat.id, (current) => ({ ...current, running: false, runId: "", status: "Turno completado", error: "El turno terminó, pero la respuesta no está disponible en este dispositivo. Revisá el resultado antes de repetirlo.", updatedAt: Date.now() }));
          if (state.status === "failed") updateChat(chat.id, (current) => ({ ...current, running: false, runId: "", status: "Turno detenido", error: state.error || "La ejecución falló", updatedAt: Date.now() }));
        } catch { /* transient disconnect; retry on the next interval */ }
      }
    };
    void recover();
    const timer = window.setInterval(() => void recover(), 3000);
    return () => window.clearInterval(timer);
  }, [hydrated]);

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
  const models = active?.provider === "copilot" ? copilotModels : active?.provider === "apple" ? [APPLE_INTELLIGENCE_MODEL] : chatGPTModels;
  const selectedModel = models.find((m) => m.id === active?.model);
  const githubConnected = Boolean(session?.githubConnected);
  const chatGPTConnected = chatGPT.status === "connected";
  const supervisorAttachments = pendingAttachments[active?.id || ""] || [];
  const providerReady = active?.provider === "copilot" ? githubConnected : active?.provider === "apple" ? isIPhone : chatGPTConnected;
  const canSendSupervisor = Boolean((active?.draft.trim() || supervisorAttachments.length) && (!active?.running || !supervisorAttachments.length) && providerReady && (active.provider === "apple" ? active.mode === "chat" && !supervisorAttachments.length : active.mode === "chat" || active.repo) && (active.mode !== "pr" || githubConnected) && (active.provider !== "copilot" || !supervisorAttachments.some((file) => file.type.startsWith("image/"))));
  const sendHint = active?.running && supervisorAttachments.length
    ? "Esperá a que termine el turno para enviar adjuntos."
    : active?.provider === "copilot" && supervisorAttachments.some((file) => file.type.startsWith("image/"))
      ? "Para analizar imágenes elegí ChatGPT / Codex."
    : active?.provider === "apple" && supervisorAttachments.length
      ? "Apple Intelligence recibe texto desde esta integración; quitá adjuntos para enviar."
    : !active?.draft.trim() && !supervisorAttachments.length
    ? "Escribí un mensaje para continuar."
    : active.provider === "copilot" && !githubConnected
      ? "Conectá GitHub para usar Copilot."
      : active.provider === "chatgpt" && !chatGPTConnected
        ? "Conectá ChatGPT para enviar el mensaje."
        : active.provider === "apple" && !isIPhone
          ? "Apple Intelligence está disponible al abrir la web app desde un iPhone."
        : active.provider === "apple" && active.mode !== "chat"
          ? "Apple Intelligence funciona en Solo chat."
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
      if (chat.running || (chat.runId && chat.status === "Estado por confirmar") || !chat.queuedSupervisor.length || queueLocks.current.has(chat.id)) continue;
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
        ? chat.messages.map((message) => message.kind === "pr" && message.pullRequest?.url === url ? { ...message, text: data.updatedExistingPr ? "Pull Request actualizado con un commit" : message.text, pullRequest: record, at: record.at } : message)
        : [...chat.messages, { id: `pr:${url}`, kind: "pr", text: data.updatedExistingPr ? "Pull Request actualizado con un commit" : "Pull Request creado", at: record.at, agent: "supervisor", displayName: "Supervisor", pullRequest: record } as ChatMessage];
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

  function handleSupervisorEvent(chatId: string, runId: string, event: StreamEvent) {
    const data = event.data ?? {};
    const agentId = event.agentId || "supervisor";
    if (!agentMaps.current[chatId]) agentMaps.current[chatId] = { supervisor: "supervisor" };
    const map = agentMaps.current[chatId];
    if (event.type === "control.status") {
      const message = asString(data.message); if (message) updateChat(chatId, (chat) => ({ ...chat, status: message, updatedAt: Date.now() })); return;
    }
    // These are transport/setup events. The header and running banner already show
    // the active turn, so adding them to the conversation repeats on every message.
    if (event.type === "team.loaded" || event.type === "run.started") return;
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
    if (event.type === "auth.required") {
      if (data.provider === "github" && data.reason === "permission") {
        updateChat(chatId, (chat) => {
          const original = chat.messages.find((message) => message.id === `${runId}:user`);
          return { ...chat, retryPrompt: original?.text || undefined, retryNeedsAttachments: Boolean(original?.attachments?.length) };
        });
      }
      window.dispatchEvent(new CustomEvent("epia:reauth-required", {
        detail: { provider: data.provider === "github" ? "github" : "chatgpt", message: asString(data.message) },
      }));
      return;
    }
    if (event.type === "control.done") {
      const prUrl = asString(data.prUrl); const diffStat = asString(data.diffStat);
      if (prUrl) upsertPullRequest(chatId, data);
      updateChat(chatId, (chat) => ({ ...chat, running: false, runId: "", status: "Turno completado", diffStat: diffStat || chat.diffStat, error: "", continuationPrompt: undefined, updatedAt: Date.now() })); return;
    }
    if (event.type === "control.error" || event.type === "run.failed") {
      const message = asString(data.message) || "La ejecución falló";
      updateChat(chatId, (chat) => ({ ...chat, running: false, runId: "", status: "Turno detenido", error: message, updatedAt: Date.now() })); system(chatId, message, "bad");
    }
  }

  function specialistContext(chat: ChatThread) {
    return Object.values(chat.agentThreads).filter((thread) => thread.messages.some((m) => m.kind === "user" || m.kind === "agent")).slice(0, 10).map((thread) => {
      const lines = thread.messages.filter((m) => m.kind === "user" || m.kind === "agent").slice(-8).map((m) => `${m.kind === "user" ? "USUARIO" : thread.displayName}: ${m.text}`);
      return `HILO ${thread.displayName}:\n${lines.join("\n")}`;
    }).join("\n\n").slice(0, 16000);
  }

  async function startSupervisorRun(chatId: string, explicitPrompt?: string, alreadyAppended = false, attachments: Attachment[] = []) {
    const thread = chatsRef.current.find((chat) => chat.id === chatId); if (!thread || thread.running) return;
    const prompt = (explicitPrompt ?? thread.draft).trim() || (attachments.length ? "Analizá los archivos adjuntos." : ""); if (!prompt) return;
    const runId = uid("run");
    const controller = new AbortController();
    activeRunsRef.current.set(runId, { controller });
    agentMaps.current[chatId] = { supervisor: "supervisor" };
    const history = thread.messages.filter((m) => m.kind === "user" || m.kind === "agent").slice(-12).map((m) => `${m.kind === "user" ? "USUARIO" : "SUPERVISOR"}: ${m.text}`).join("\n\n");
    const specialist = specialistContext(thread);
    const requestPrompt = [history ? `CONTEXTO DEL CHAT CON SUPERVISOR:\n${history}` : "", specialist ? `INTERVENCIONES DIRECTAS CON ESPECIALISTAS:\n${specialist}` : "", `NUEVO PEDIDO DEL USUARIO:\n${prompt}`].filter(Boolean).join("\n\n");
    updateChat(chatId, (chat) => ({ ...chat, title: chat.title === "Nuevo chat" ? titleFrom(prompt) : chat.title, draft: "", running: true, runId, status: "Supervisor está preparando el turno…", error: "", retryPrompt: undefined, retryNeedsAttachments: false, continuationPrompt: undefined, updatedAt: Date.now(), messages: alreadyAppended ? chat.messages : [...chat.messages, { id: `${runId}:user`, kind: "user", text: prompt, attachments: attachments.map(({ name, type }) => ({ name, type })), at: Date.now() } as ChatMessage].slice(-220) }));
    let responseStarted = false;
    let terminalEvent = false;
    let softTimedOut = false;
    let softTimeout: ReturnType<typeof window.setTimeout> | undefined;
    try {
      if (thread.provider === "apple") {
        const shareText = `Actuá como Supervisor del equipo de producto e ingeniería.\n\n${requestPrompt}`;
        if (navigator.share) {
          await navigator.share({ title: "Supervisor · Apple Intelligence", text: shareText });
          system(chatId, "Pedido enviado al flujo nativo del iPhone para usar Apple Intelligence.", "good");
        } else {
          await navigator.clipboard.writeText(shareText);
          system(chatId, "Pedido copiado. Pegalo en el flujo de Apple Intelligence del iPhone.", "good");
        }
        updateChat(chatId, (chat) => ({ ...chat, running: false, runId: "", status: "Apple Intelligence listo", error: "", updatedAt: Date.now() }));
        return;
      }
      const endpoint = thread.mode === "pr" ? "/api/run" : thread.provider === "copilot" ? "/api/copilot-run" : "/api/chat-run";
      const existingPrNumbers = [...thread.pullRequests].reverse().map((item) => pullRequestNumber(item, thread.repo)).filter((number): number is number => Boolean(number));
      const payload = thread.mode === "pr"
        ? { repo: thread.repo, branch: thread.branch, existingPrNumbers, provider: thread.provider, model: thread.model, reasoningEffort: thread.reasoningEffort, prompt: requestPrompt, attachments }
        : { mode: thread.mode, repo: thread.repo, branch: thread.branch, model: thread.model, reasoningEffort: thread.reasoningEffort, prompt: requestPrompt, attachments };
      softTimeout = window.setTimeout(() => {
        softTimedOut = true;
        controller.abort();
      }, VERCEL_HOBBY_SOFT_TIMEOUT_MS);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Run-Id": runId },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
      responseStarted = true;
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
          if (raw.trim()) {
            const event = JSON.parse(raw) as StreamEvent;
            if (["control.done", "control.error", "run.failed"].includes(event.type)) terminalEvent = true;
            handleSupervisorEvent(chatId, runId, event);
          }
        }
        if (done || controller.signal.aborted) break;
      }
      if (!controller.signal.aborted && buffer.trim()) {
        const event = JSON.parse(buffer) as StreamEvent;
        if (["control.done", "control.error", "run.failed"].includes(event.type)) terminalEvent = true;
        handleSupervisorEvent(chatId, runId, event);
      }
      if (controller.signal.aborted) throw new Error("La ejecución fue interrumpida.");
      if (!controller.signal.aborted && !terminalEvent) throw new Error("La transmisión terminó antes de confirmar el resultado.");
    } catch (error) {
      const interrupted = controller.signal.aborted;
      const message = interrupted ? "La ejecución fue interrumpida." : error instanceof Error ? error.message : String(error);
      if (attachments.length && !responseStarted) setPendingAttachments((current) => ({ ...current, [chatId]: [...attachments, ...(current[chatId] || [])] }));
      if (softTimedOut) {
        const reason = "se alcanzó el margen seguro del límite de 300 segundos de Vercel Hobby";
        updateChat(chatId, (chat) => ({
          ...chat,
          running: false,
          runId: "",
          status: "Continuación disponible",
          error: "Pausé el turno antes del límite de 300 segundos de Vercel Hobby. Podés seguir con el contexto que ya quedó guardado en este chat.",
          continuationPrompt: continuationPromptFor(reason),
          updatedAt: Date.now(),
        }));
        system(chatId, "Turno pausado por límite de tiempo. Podés continuar desde acá.");
      } else if (responseStarted && !interrupted && !terminalEvent) {
        updateChat(chatId, (chat) => ({ ...chat, running: true, status: "Consultando estado del turno…", error: "", updatedAt: Date.now() }));
      } else {
        updateChat(chatId, (chat) => ({ ...chat, running: false, runId: "", status: interrupted ? "Turno interrumpido" : "Turno detenido", error: message, updatedAt: Date.now() }));
        system(chatId, message, "bad");
      }
    } finally {
      if (softTimeout) window.clearTimeout(softTimeout);
      activeRunsRef.current.delete(runId);
    }
  }

  function sendSupervisor() {
    if (!active || !canSendSupervisor) return;
    const attachments = supervisorAttachments;
    const text = active.draft.trim() || "Analizá los archivos adjuntos.";
    if (active.running) {
      const queued: QueuedPrompt = { id: uid("queued"), text, at: Date.now() };
      updateChat(active.id, (chat) => ({ ...chat, draft: "", queuedSupervisor: [...chat.queuedSupervisor, queued], messages: [...chat.messages, { id: queued.id, kind: "user", text, at: queued.at } as ChatMessage].slice(-220), updatedAt: Date.now() })); return;
    }
    setPendingAttachments((current) => ({ ...current, [active.id]: [] }));
    setAttachmentError("");
    void startSupervisorRun(active.id, text, false, attachments);
  }

  async function retryPublication(chatId: string) {
    const chat = chatsRef.current.find((item) => item.id === chatId);
    if (!chat?.retryPrompt || chat.running || !githubConnected || (chat.provider === "chatgpt" && !chatGPTConnected) || retryLocks.current.has(chatId)) return;
    const attachments = pendingAttachments[chatId] || [];
    if (chat.retryNeedsAttachments && !attachments.length) return;
    retryLocks.current.add(chatId);
    setPendingAttachments((current) => ({ ...current, [chatId]: [] }));
    try { await startSupervisorRun(chatId, chat.retryPrompt, false, attachments); }
    finally { retryLocks.current.delete(chatId); }
  }

  async function continueSupervisorRun(chatId: string) {
    const chat = chatsRef.current.find((item) => item.id === chatId);
    if (!chat?.continuationPrompt || chat.running) return;
    await startSupervisorRun(chatId, chat.continuationPrompt);
  }

  async function startAgentRun(chatId: string, name: string) {
    const parent = chatsRef.current.find((chat) => chat.id === chatId); const thread = parent?.agentThreads[name];
    const attachments = pendingAttachments[`${chatId}:${name}`] || [];
    if (!parent || !thread || thread.status === "running" || (!thread.draft.trim() && !attachments.length)) return;
    const prompt = thread.draft.trim() || "Analizá los archivos adjuntos."; const runId = uid("agent-run");
    setPendingAttachments((current) => ({ ...current, [`${chatId}:${name}`]: [] }));
    const controller = new AbortController();
    activeRunsRef.current.set(runId, { controller });
    const supervisorContext = parent.messages.filter((m) => m.kind === "user" || m.kind === "agent").slice(-8).map((m) => `${m.kind === "user" ? "USUARIO" : "SUPERVISOR"}: ${m.text}`).join("\n\n");
    const directHistory = thread.messages.filter((m) => m.kind === "user" || m.kind === "agent").slice(-10).map((m) => `${m.kind === "user" ? "USUARIO" : thread.displayName}: ${m.text}`).join("\n\n");
    const requestPrompt = [supervisorContext ? `CONTEXTO DEL SUPERVISOR:\n${supervisorContext}` : "", directHistory ? `HISTORIAL DE ESTE HILO:\n${directHistory}` : "", `NUEVO AJUSTE DEL USUARIO:\n${prompt}`].filter(Boolean).join("\n\n");
    updateAgentThread(chatId, name, (current) => ({ ...current, draft: "", status: "running", error: "", unread: 0, messages: [...current.messages, { id: `${runId}:user`, kind: "user", text: prompt, attachments: attachments.map(({ name, type }) => ({ name, type })), at: Date.now() } as ChatMessage].slice(-140), updatedAt: Date.now() }));
    try {
      const response = await fetch("/api/agent-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: parent.provider, agentName: name, prompt: requestPrompt, repo: parent.repo, branch: parent.branch, model: parent.model, reasoningEffort: parent.reasoningEffort, attachments }), signal: controller.signal });
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
      if (attachments.length) setPendingAttachments((current) => ({ ...current, [`${chatId}:${name}`]: [...attachments, ...(current[`${chatId}:${name}`] || [])] }));
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

  async function attachFiles(key: string, files: FileList | null) {
    if (!files?.length) return;
    setAttachmentError("");
    try {
      const accepted: Attachment[] = [];
      for (const file of Array.from(files)) {
        let data: string;
        let name = file.name;
        let type = file.type;
        if (file.type.startsWith("image/")) {
          const url = URL.createObjectURL(file);
          try {
            const img = new Image();
            img.src = url;
            await img.decode();
            const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
            canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
            data = canvas.toDataURL("image/jpeg", 0.78).split(",")[1];
            name = `${file.name.replace(/\.[^.]+$/, "")}.jpg`;
            type = "image/jpeg";
          } finally { URL.revokeObjectURL(url); }
        } else {
          data = (await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
            reader.readAsDataURL(file);
          }));
        }
        const size = Math.floor(data.length * 3 / 4);
        if (size > 2_500_000) throw new Error(`${file.name} supera el límite de 2,5 MB.`);
        accepted.push({ name, type, data, size });
      }
      const existing = pendingAttachments[key] || [];
      if (existing.length + accepted.length > 4 || [...existing, ...accepted].reduce((sum, file) => sum + file.size, 0) > 3_000_000) throw new Error("Máximo 4 archivos y 3 MB en total por mensaje.");
      setPendingAttachments((current) => ({ ...current, [key]: [...(current[key] || []), ...accepted] }));
    } catch (error) { setAttachmentError(error instanceof Error ? error.message : String(error)); }
  }

  function attachmentChips(key: string, files: Attachment[]) {
    return files.length ? <div className={s.attachmentChips}>{files.map((file, index) => <span key={`${file.name}-${index}`}>{file.type.startsWith("image/") ? <img src={`data:${file.type};base64,${file.data}`} alt="" /> : "📄"} {file.name}<button type="button" aria-label={`Quitar ${file.name}`} onClick={() => setPendingAttachments((current) => ({ ...current, [key]: (current[key] || []).filter((_, i) => i !== index) }))}>×</button></span>)}</div> : null;
  }

  function messageAttachments(message: ChatMessage) {
    return message.attachments?.length ? <div className={s.messageAttachments}>{message.attachments.map((file, index) => <span key={`${file.name}-${index}`}>{file.type.startsWith("image/") ? "🖼" : "📄"} {file.name}</span>)}</div> : null;
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
    if (message.kind === "user") return <div className={`${s.row} ${s.userRow}`} key={message.id}><article className={`${s.bubble} ${s.userBubble}`}><div>{message.text}</div>{messageAttachments(message)}<time>{time(message.at)}</time></article></div>;
    if (message.kind === "pr" && message.pullRequest) return <div className={`${s.row} ${s.agentRow}`} key={message.id}><span className={s.messageAvatar}>S</span><article className={`${s.bubble} ${s.agentBubble} ${s.prMessage}`}><div className={s.author}><strong>Supervisor</strong><span>Pull Request</span></div><div>{message.text}</div><a href={message.pullRequest.url} target="_blank" rel="noreferrer">{message.pullRequest.repo || message.pullRequest.url} {message.pullRequest.number ? `#${message.pullRequest.number}` : "↗"}</a>{message.pullRequest.branch && <small>{message.pullRequest.branch}</small>}{message.pullRequest.diffStat && <pre>{message.pullRequest.diffStat}</pre>}<time>{time(message.at)}</time></article></div>;
    return <div className={`${s.row} ${s.agentRow}`} key={message.id}><span className={s.messageAvatar}>S</span><article className={`${s.bubble} ${s.agentBubble}`}><div className={s.author}><strong>Supervisor</strong></div><div className={s.aiResponse}><MessageResponse>{message.text}</MessageResponse></div><time>{time(message.at)}</time></article></div>;
  }

  function renderAgentMessage(message: ChatMessage, thread: AgentThread) {
    if (message.kind === "system") return <div key={message.id} className={`${s.agentSystem} ${message.tone === "bad" ? s.agentSystemBad : ""}`}>{message.text}</div>;
    if (message.kind === "user") return <div key={message.id} className={s.agentUserBubble}>{message.text}{messageAttachments(message)}<time>{time(message.at)}</time></div>;
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
        <div className={s.threadList}>{visibleChats.length === 0 ? <div className={s.emptyList} role="status"><strong>No hay chats que coincidan</strong><span>Probá con otro término de búsqueda.</span><button type="button" onClick={() => setSearch("")}>Limpiar búsqueda</button></div> : visibleChats.map((chat) => <div className={`${s.thread} ${chat.id === active.id ? s.threadActive : ""}`} key={chat.id}><button aria-label={`Abrir chat ${chat.title}`} aria-current={chat.id === active.id ? "page" : undefined} className={s.threadMain} onClick={() => { setActiveId(chat.id); setMobileListOpen(false); }}><span className={s.threadAvatar}>S</span><span className={s.threadBody}><span className={s.threadTitle}><strong>{chat.title}</strong><time>{time(chat.updatedAt)}</time></span><span className={s.threadPreview}>{chat.running && <span className={s.spinner} />}<span>{chat.error || chat.status}</span></span><span className={s.threadMeta}>Supervisor · {providerLabel(chat.provider)}{chat.repo ? ` · ${chat.repo}` : ""}</span></span></button></div>)}</div>
        <div className={s.accountBar}><button className={s.accountButton} onClick={() => setSettingsOpen(true)}>{session.user?.avatarUrl ? <img src={session.user.avatarUrl} alt="" /> : <span>ME</span>}<span><strong>{githubConnected ? `@${session.user?.login}` : "Conexiones"}</strong><small>{githubConnected ? "Copilot disponible" : chatGPTConnected ? "ChatGPT conectado" : "Configurar"}</small></span></button></div>
      </aside>

      <section className={s.supervisorPane}>
        <header className={s.chatHeader}><button aria-label="Volver a chats" className={s.mobileBack} onClick={() => setMobileListOpen(true)}>‹</button><span className={s.supervisorAvatar}>S</span><div className={s.headerCopy}><strong>Supervisor</strong><span>{active.title} · {active.running ? active.status : "listo"}</span></div><button aria-label="Abrir chats de agentes" className={s.agentToggle} onClick={() => setMobileAgentsOpen(true)}>{parallelThreads.length ? `${parallelThreads.length} agentes` : "Agentes"}</button><button ref={settingsTriggerRef} aria-label="Abrir configuración" aria-expanded={settingsOpen} aria-controls="supervisor-settings" className={s.iconButton} onClick={() => setSettingsOpen(true)}>⚙</button></header>
        <div className={s.contextBar}><span>{modeLabel(active.mode)}</span><span>{providerLabel(active.provider)} · {selectedModel?.displayName || selectedModel?.name || active.model || "modelo"}</span>{active.repo && <span>repo · {active.repo}</span>}{active.queuedSupervisor.length > 0 && <span className={s.queueChip}>{active.queuedSupervisor.length} en cola</span>}{active.pullRequests.length > 0 && <button type="button" className={s.prQuickButton} aria-label={`Abrir lista de ${active.pullRequests.length} Pull Requests`} aria-expanded={prQuickOpen} onClick={() => setPrQuickOpen((open) => !open)}>PRs · {active.pullRequests.length}</button>}</div>
        <div className={s.messages}><div className={s.stack}>{prQuickOpen && active.pullRequests.length > 0 && <section className={s.prQuickList} aria-label="Lista rápida de Pull Requests"><div className={s.prQuickHeader}><strong>Pull Requests del chat</strong><button type="button" aria-label="Cerrar lista de Pull Requests" onClick={() => setPrQuickOpen(false)}>×</button></div>{active.pullRequests.slice().reverse().map((pr) => <a className={s.prQuickItem} key={pr.url} href={pr.url} target="_blank" rel="noreferrer"><span>{pr.repo || pr.url} {pr.number ? `#${pr.number}` : "↗"}</span><small>{pr.branch || "Abrir en GitHub"}</small></a>)}</section>}{active.messages.length === 0 && <div className={s.welcome}><div className={s.welcomeAvatar}>S</div><h1>Hablá con Supervisor</h1><p>Supervisor coordina el equipo. Los especialistas aparecen a la derecha como chats paralelos.</p></div>}{renderToolGroups(active.messages, "Supervisor", renderSupervisorMessage)}{active.pullRequests.length === 0 && active.diffStat && <div className={s.delivery}><strong>Cambios preparados</strong><pre>{active.diffStat}</pre></div>}<div ref={endRef} /></div></div>
        <footer className={s.composerShell}>{active.running && <div className={s.runningBanner} role="status" aria-live="polite"><span className={s.spinner} /><div><strong>{parallelThreads.some((thread) => thread.status === "running") ? `Coordinando con ${parallelThreads.filter((thread) => thread.status === "running").map((thread) => thread.displayName).join(", ")}` : "Supervisor está pensando…"}</strong><small>{active.status}</small></div>{active.queuedSupervisor.length > 0 && <b>{active.queuedSupervisor.length} en cola</b>}</div>}{active.error && <div className={s.errorBanner} role="alert"><strong>{active.status === "Estado por confirmar" ? "Estado del turno incierto:" : active.status === "Continuación disponible" ? "Turno pausado:" : "Ocurrió un error:"}</strong> {active.error}{active.continuationPrompt && <div className={s.retryControls}><button type="button" onClick={() => void continueSupervisorRun(active.id)} disabled={active.running || (active.provider === "chatgpt" && !chatGPTConnected) || (active.provider === "copilot" && !githubConnected)}>Continuar</button><small>Se abrirá un turno nuevo con el historial de este chat como contexto.</small>{active.provider === "chatgpt" && !chatGPTConnected && <small>Reconectá ChatGPT para continuar.</small>}{active.provider === "copilot" && !githubConnected && <small>Reconectá GitHub para continuar con Copilot.</small>}</div>}{active.retryPrompt && <div className={s.retryControls}><button type="button" onClick={() => void retryPublication(active.id)} disabled={active.running || !githubConnected || (active.provider === "chatgpt" && !chatGPTConnected) || (active.retryNeedsAttachments && !supervisorAttachments.length)}>Reintentar</button><small>Se volverá a ejecutar el pedido para crear el PR.</small>{!githubConnected && <small>Reconectá GitHub para habilitar el reintento.</small>}{githubConnected && active.retryNeedsAttachments && !supervisorAttachments.length && <small>Volvé a adjuntar los archivos del pedido antes de reintentar.</small>}</div>}</div>}{attachmentChips(active.id, supervisorAttachments)}<div className={s.composer}><input ref={supervisorFileRef} className={s.hiddenFile} type="file" multiple accept="image/*,.pdf,.txt,.md,.csv,.json,.xml,.html,.docx,.xlsx,.zip" onChange={(event) => { void attachFiles(active.id, event.target.files); event.target.value = ""; }} /><button type="button" aria-label="Adjuntar imágenes o archivos" title="Adjuntar imágenes o archivos" className={s.plus} onClick={() => supervisorFileRef.current?.click()}>＋</button><textarea aria-label="Mensaje a Supervisor" aria-describedby={sendHint ? "supervisor-send-hint" : undefined} value={active.draft} onChange={(e) => updateChat(active.id, (chat) => ({ ...chat, draft: e.target.value }))} onKeyDown={keyDown} placeholder={active.running ? "Otra instrucción (queda en cola)…" : "Mensaje a Supervisor…"} rows={1} /><button aria-label="Enviar mensaje" className={s.send} onClick={sendSupervisor} disabled={!canSendSupervisor}>➤</button></div>{attachmentError && <small className={s.attachmentError} role="alert">{attachmentError}</small>}{sendHint && <small id="supervisor-send-hint" className={s.composerHint}>{sendHint}</small>}</footer>
      </section>

      <aside className={s.agentRail}>
        <div className={s.agentRailHeader}>{selectedAgentThread ? <button aria-label="Volver a la lista de especialistas" onClick={() => setSelectedAgentName("")}>‹</button> : <span className={s.railMark}>⇶</span>}<div><strong>{selectedAgentThread ? selectedAgentThread.displayName : "Chats paralelos"}</strong><span>{selectedAgentThread ? "Especialista · solo lectura" : `${parallelThreads.length} especialistas activos`}</span></div><button aria-label="Cerrar chats de agentes" className={s.mobileAgentClose} onClick={() => setMobileAgentsOpen(false)}>×</button></div>
        {!selectedAgentThread ? <div className={s.agentList}>{parallelThreads.length === 0 && <div className={s.agentEmpty}><div>⇶</div><strong>Todavía no hay especialistas</strong><p>Cuando Supervisor delegue trabajo, cada agente aparece acá.</p></div>}{parallelThreads.map((thread) => { const last = [...thread.messages].reverse().find((m) => m.text); return <button className={s.agentListItem} key={thread.name} onClick={() => openAgent(thread.name)}><span className={s.agentAvatar}>{thread.displayName[0]?.toUpperCase() || "A"}</span><span><strong>{thread.displayName}</strong><small>{thread.assignment || last?.text || thread.description}</small></span><span className={`${s.agentStatus} ${thread.status === "running" ? s.agentRunning : thread.status === "error" ? s.agentError : s.agentDone}`}>{thread.status === "running" ? "●" : thread.status === "error" ? "!" : thread.status === "completed" ? "✓" : ""}{thread.unread > 0 && <b>{thread.unread}</b>}</span></button>; })}</div> : <div className={s.agentConversation}><div className={s.agentNotice}>Pedido actual: {selectedAgentThread.assignment || "Aún no hay una consigna registrada."}<br />Este hilo no modifica archivos. Tus ajustes se agregan al contexto del próximo turno de Supervisor.</div><div className={s.agentMessages}>{selectedAgentThread.description && <div className={s.agentSystem}>Rol · {selectedAgentThread.description}</div>}{renderToolGroups(selectedAgentThread.messages, selectedAgentThread.displayName, (message) => renderAgentMessage(message, selectedAgentThread))}<div ref={agentEndRef} /></div><div className={s.agentComposer}><input ref={agentFileRef} className={s.hiddenFile} type="file" multiple accept="image/*,.pdf,.txt,.md,.csv,.json,.xml,.html,.docx,.xlsx,.zip" onChange={(event) => { void attachFiles(`${active.id}:${selectedAgentThread.name}`, event.target.files); event.target.value = ""; }} /><button type="button" aria-label="Adjuntar archivo al especialista" className={s.attachButton} onClick={() => agentFileRef.current?.click()} disabled={selectedAgentThread.status === "running"}>＋</button><div className={s.agentInput}>{attachmentChips(`${active.id}:${selectedAgentThread.name}`, pendingAttachments[`${active.id}:${selectedAgentThread.name}`] || [])}<textarea aria-label={`Ajustar pedido a ${selectedAgentThread.displayName}`} value={selectedAgentThread.draft} onChange={(e) => updateAgentThread(active.id, selectedAgentThread.name, (thread) => ({ ...thread, draft: e.target.value }))} placeholder={`Ajustar pedido a ${selectedAgentThread.displayName}…`} disabled={selectedAgentThread.status === "running"} rows={1} />{attachmentError && <small className={s.attachmentError} role="alert">{attachmentError}</small>}{active.provider === "copilot" && (pendingAttachments[`${active.id}:${selectedAgentThread.name}`] || []).some((file) => file.type.startsWith("image/")) && <small className={s.attachmentError}>Para analizar imágenes elegí ChatGPT / Codex.</small>}</div><button aria-label="Enviar ajuste al especialista" onClick={() => void startAgentRun(active.id, selectedAgentThread.name)} disabled={(!selectedAgentThread.draft.trim() && !(pendingAttachments[`${active.id}:${selectedAgentThread.name}`] || []).length) || selectedAgentThread.status === "running" || (active.provider === "copilot" && (pendingAttachments[`${active.id}:${selectedAgentThread.name}`] || []).some((file) => file.type.startsWith("image/")))}>➤</button></div></div>}
      </aside>

      {settingsOpen && <><button aria-label="Cerrar configuración" className={s.settingsBackdrop} onClick={() => setSettingsOpen(false)} /><aside id="supervisor-settings" className={s.settings} role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className={s.sheetHandle} /><div className={s.settingsHeader}><div><strong id="settings-title">Configuración de Supervisor</strong><span>Proveedor, modelo, repo y entrega.</span></div><button ref={settingsCloseRef} aria-label="Cerrar configuración" className={s.iconButton} onClick={() => setSettingsOpen(false)}>×</button></div><section className={s.section}><div className={s.sectionTitle}>Modo</div><div className={s.modeGrid}>{(["chat","draft","pr"] as ChatMode[]).map((mode) => <button key={mode} disabled={active.provider === "apple" && mode !== "chat"} className={active.mode === mode ? s.modeActive : ""} onClick={() => updateChat(active.id, (chat) => ({ ...chat, mode, repo: mode === "chat" ? "" : chat.repo }))}><strong>{modeLabel(mode)}</strong></button>)}</div></section><section className={s.section}><div className={s.sectionTitle}>IA</div><div className={s.grid}><label>Proveedor<select value={active.provider} onChange={(e) => updateChat(active.id, (chat) => { const provider = e.target.value as Provider; return { ...chat, provider, mode: provider === "apple" ? "chat" : chat.mode, repo: provider === "apple" ? "" : chat.repo, model: provider === "copilot" ? "auto" : provider === "apple" ? APPLE_INTELLIGENCE_MODEL.id : "" }; })}><option value="chatgpt">ChatGPT / Codex</option><option value="copilot" disabled={!githubConnected}>GitHub Copilot</option>{isIPhone && <option value="apple">Apple Intelligence</option>}</select></label><label>Modelo<select value={active.model} onChange={(e) => updateChat(active.id, (chat) => ({ ...chat, model: e.target.value }))}>{models.map((m) => <option key={m.id} value={m.id}>{m.displayName || m.name || m.id}</option>)}</select></label></div></section>{active.mode !== "chat" && <section className={s.section}><div className={s.sectionTitle}>Repositorio</div><div className={s.repoRow}><select value={active.repo} onChange={(e) => setRepo(e.target.value)}><option value="">Elegí un repo…</option>{repos.map((repo) => <option key={repo.id} value={repo.fullName}>{repo.private ? "🔒 " : ""}{repo.fullName}</option>)}</select></div></section>}<section className={s.section}><div className={s.sectionTitle}>Conexiones</div><div className={s.connection}><span className={s.gptLogo}>GPT</span><div><strong>{chatGPTConnected ? "ChatGPT conectado" : "ChatGPT"}</strong><small>{chatGPT.planType || "Codex"}</small></div>{chatGPTConnected ? <button onClick={() => fetch("/api/chatgpt/logout", { method: "POST" }).then(() => setChatGPT({ status: "disconnected" }))}>Salir</button> : <button onClick={() => fetch("/api/chatgpt/login", { method: "POST" }).then((r) => r.json()).then((body) => setChatGPT(body as ChatGPTState)).catch((error) => setConnectionError(String(error)))}>Conectar</button>}</div><div className={s.connection}><span className={s.ghLogo}>GH</span><div><strong>{githubConnected ? `@${session.user?.login}` : "GitHub"}</strong><small>Repos + Copilot</small></div>{!githubConnected && <a href="/api/auth/github">Conectar</a>}</div>{isIPhone && <div className={s.connection}><span className={s.gptLogo}>AI</span><div><strong>Apple Intelligence</strong><small>Disponible desde este iPhone</small></div><span>Activo</span></div>}{connectionError && <div className={s.formError}>{connectionError}</div>}</section></aside></>}
    </main>
  );
}
