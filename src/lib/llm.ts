import type { ChatMessage, ModelConfig } from "./types";
import { completionsUrl } from "./settings";
import { safeJsonParse } from "./utils";

export interface ChatRequest {
  config: ModelConfig;
  messages: ChatMessage[];
  signal?: AbortSignal;
  stream?: boolean;
  onDelta?: (delta: string, full: string) => void;
}

export interface ChatResponse {
  content: string;
  aborted: boolean;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface CompletionChunk {
  choices?: { delta?: { content?: string | null; reasoning_content?: string | null }; message?: { content?: string } }[];
  usage?: ChatResponse["usage"];
  error?: { message?: string };
}

function buildBody(
  config: ModelConfig,
  messages: ChatMessage[],
  stream: boolean,
): { body: Record<string, unknown>; paramsError?: string } {
  const parsed = safeJsonParse<Record<string, unknown>>(config.params || "{}");
  if (!parsed.ok) {
    return { body: {}, paramsError: `额外参数不是合法 JSON：${parsed.error}` };
  }
  const extra = parsed.value && typeof parsed.value === "object" ? parsed.value : {};
  // 用户参数在前，核心字段在后：避免 params 里误写的 model/messages 覆盖真实请求
  return { body: { ...extra, model: config.model, messages, stream } };
}

export async function chatCompletion({
  config,
  messages,
  signal,
  stream = true,
  onDelta,
}: ChatRequest): Promise<ChatResponse> {
  if (!config.baseUrl.trim()) throw new Error("尚未配置 Base URL");
  if (!config.model.trim()) throw new Error("尚未配置模型名称");

  const { body, paramsError } = buildBody(config, messages, stream);
  if (paramsError) throw new Error(paramsError);

  const res = await fetch(completionsUrl(config.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    let detail = "";
    try {
      const text = await res.text();
      try {
        const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
        detail = typeof json.error === "string" ? json.error : json.error?.message || json.message || text;
      } catch {
        detail = text;
      }
    } catch {
      /* ignore */
    }
    throw new Error(`请求失败 ${res.status}${detail ? ` · ${detail.slice(0, 300)}` : ""}`);
  }

  const contentType = res.headers.get("content-type") || "";
  // 部分网关即使 stream=true 也返回整包 JSON
  if (!stream || !res.body || !contentType.includes("event-stream")) {
    const json = (await res.json()) as CompletionChunk;
    if (json.error?.message) throw new Error(json.error.message);
    const content = json.choices?.[0]?.message?.content ?? "";
    onDelta?.(content, content);
    return { content, aborted: false, model: config.model, usage: json.usage };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let usage: ChatResponse["usage"];
  let aborted = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let chunk: CompletionChunk;
          try {
            chunk = JSON.parse(payload) as CompletionChunk;
          } catch {
            continue;
          }
          if (chunk.error?.message) throw new Error(chunk.error.message);
          if (chunk.usage) usage = chunk.usage;
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            full += delta;
            onDelta?.(delta, full);
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      aborted = true;
    } else if (err instanceof Error && /abort/i.test(err.message)) {
      aborted = true;
    } else {
      throw err;
    }
  } finally {
    reader.releaseLock();
  }

  return { content: full, aborted, model: config.model, usage };
}
