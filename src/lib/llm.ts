import type { ChatMessage, ModelConfig } from "./types";
import { normalizeEndpoint } from "./settings";
import { safeJsonParse } from "./utils";

export interface ChatRequest {
  config: ModelConfig;
  messages: ChatMessage[];
  signal?: AbortSignal;
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

type BuiltBody =
  | { ok: true; body: Record<string, unknown>; model: string; stream: boolean }
  | { ok: false; error: string };

/**
 * 参数 JSON 整体就是请求体：model / stream / temperature / top_p 等原样透传，
 * 应用只注入 messages，并给 stream 补上缺省 true（渲染侧恒为流式）。
 */
function buildBody(config: ModelConfig, messages: ChatMessage[]): BuiltBody {
  const parsed = safeJsonParse<Record<string, unknown>>(config.params || "{}");
  if (!parsed.ok) return { ok: false, error: `额外参数不是合法 JSON：${parsed.error}` };
  const extra = parsed.value && typeof parsed.value === "object" ? parsed.value : {};
  const model = typeof extra.model === "string" ? extra.model.trim() : "";
  if (!model) return { ok: false, error: "额外参数里缺少 model，无法发起请求" };
  const stream = extra.stream !== false;
  return { ok: true, body: { ...extra, stream, messages }, model, stream };
}

export async function chatCompletion({
  config,
  messages,
  signal,
  onDelta,
}: ChatRequest): Promise<ChatResponse> {
  const endpoint = normalizeEndpoint(config.endpoint);
  if (!endpoint) throw new Error("尚未配置 endpoint");

  const built = buildBody(config, messages);
  if (!built.ok) throw new Error(built.error);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(built.body),
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
  // 参数里关掉了 stream，或部分网关即使 stream=true 也返回整包 JSON
  if (!built.stream || !res.body || !contentType.includes("event-stream")) {
    const json = (await res.json()) as CompletionChunk;
    if (json.error?.message) throw new Error(json.error.message);
    const content = json.choices?.[0]?.message?.content ?? "";
    onDelta?.(content, content);
    return { content, aborted: false, model: built.model, usage: json.usage };
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

  return { content: full, aborted, model: built.model, usage };
}
