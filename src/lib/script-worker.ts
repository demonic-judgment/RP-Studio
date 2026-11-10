/// <reference lib="webworker" />

/**
 * 用户脚本沙箱：在独立 Worker 中执行，主线程可随时 terminate 实现超时熔断。
 * 仅通过消息传递数据，脚本无法访问 DOM / localStorage / 网络凭据（虽仍可 fetch，但由超时兜底）。
 */

export interface WorkerScriptMessage {
  code: string;
  ctx: {
    messages: { role: string; content: string }[];
    input: string;
    vars: Record<string, string>;
    character: { name: string; systemPrompt: string; description: string };
    history: string;
  };
}

export interface WorkerResultMessage {
  type: "result" | "log";
  ok?: boolean;
  text?: string;
  messages?: { role: string; content: string }[];
  logs?: string[];
  error?: string;
  line?: string;
  durationMs?: number;
}

const format = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};

const post = (msg: WorkerResultMessage) => (self as unknown as Worker).postMessage(msg);

self.onmessage = async (event: MessageEvent<WorkerScriptMessage>) => {
  const { code, ctx } = event.data;
  const started = Date.now();
  const logs: string[] = [];
  const log = (...args: unknown[]) => {
    const line = args.map(format).join(" ");
    logs.push(line);
    post({ type: "log", line });
  };
  const warn = (...args: unknown[]) => log("[warn]", ...args);
  const error = (...args: unknown[]) => log("[error]", ...args);

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {
      /* placeholder */
    }).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

    const fn = new AsyncFunction(
      "ctx",
      "log",
      "warn",
      "error",
      "vars",
      `"use strict";\n${code}`,
    );
    const raw = await fn(ctx, log, warn, error, ctx.vars);

    let text = "";
    let messages: { role: string; content: string }[] | undefined;

    if (typeof raw === "string") {
      text = raw;
    } else if (typeof raw === "number" || typeof raw === "boolean") {
      text = String(raw);
    } else if (raw && typeof raw === "object") {
      const obj = raw as { text?: unknown; messages?: unknown; output?: unknown };
      if (typeof obj.text === "string") text = obj.text;
      else if (typeof obj.output === "string") text = obj.output;
      if (Array.isArray(obj.messages)) {
        messages = obj.messages
          .filter(
            (m): m is { role: string; content: string } =>
              !!m &&
              typeof m === "object" &&
              ["system", "user", "assistant"].includes(String((m as { role?: unknown }).role)) &&
              typeof (m as { content?: unknown }).content === "string",
          )
          .map((m) => ({ role: m.role, content: m.content }));
      }
    }

    post({ type: "result", ok: true, text, messages, logs, durationMs: Date.now() - started });
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    post({
      type: "result",
      ok: false,
      error: message,
      logs,
      durationMs: Date.now() - started,
    });
  }
};
