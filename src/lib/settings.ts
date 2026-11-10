import type { AppSettings, ModelConfig } from "./types";

export const DEFAULT_PARAMS = `{
  "temperature": 0.85,
  "top_p": 0.95,
  "max_tokens": 1024,
  "frequency_penalty": 0.2,
  "presence_penalty": 0.2
}`;

export const DEFAULT_MODEL: ModelConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  params: DEFAULT_PARAMS,
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "light",
  accent: "violet",
  userName: "你",
  model: DEFAULT_MODEL,
  scriptTimeoutMs: 5000,
  stream: true,
  enterToSend: true,
  showTokenEstimate: true,
};

export function normalizeBaseUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

/** 拼接 chat completions 端点，兼容用户直接粘贴完整端点的情况 */
export function completionsUrl(baseUrl: string): string {
  const u = normalizeBaseUrl(baseUrl);
  if (/\/chat\/completions$/i.test(u)) return u;
  return `${u}/chat/completions`;
}
