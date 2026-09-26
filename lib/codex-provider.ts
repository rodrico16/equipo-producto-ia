export type CodexProvider = "chatgpt" | "qwen";

export const QWEN_DEFAULT_MODEL = "qwen3-coder-plus";
export const QWEN_MODELS = [
  { id: QWEN_DEFAULT_MODEL, displayName: "Qwen3 Coder Plus" },
  { id: "qwen3-max", displayName: "Qwen3 Max" },
  { id: "qwen-plus", displayName: "Qwen Plus" },
];

export function codexProviderFrom(value: unknown): CodexProvider {
  return value === "qwen" ? "qwen" : "chatgpt";
}

export function codexProviderLabel(provider: CodexProvider) {
  return provider === "qwen" ? "Qwen / DashScope" : "ChatGPT / Codex";
}

export function qwenConfigured() {
  return Boolean(process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY);
}

export function qwenModel(model?: string) {
  const clean = model?.trim();
  return clean && clean !== "auto" ? clean : QWEN_DEFAULT_MODEL;
}

export function qwenCodexEnv(model?: string) {
  const key = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || "";
  return {
    OPENAI_API_KEY: key,
    OPENAI_BASE_URL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    CODEX_PROVIDER: "qwen",
    CODEX_DEFAULT_MODEL: qwenModel(model),
  };
}
