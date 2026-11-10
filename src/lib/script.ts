import ScriptWorker from "./script-worker?worker";
import type { ChatMessage, Character } from "./types";

export interface ScriptContext {
  messages: ChatMessage[];
  input: string;
  vars: Record<string, string>;
  character: Pick<Character, "name" | "systemPrompt" | "description">;
  history: string;
}

export interface ScriptResult {
  ok: boolean;
  text: string;
  messages?: ChatMessage[];
  logs: string[];
  error?: string;
  durationMs: number;
}

/**
 * 在独立 Worker 中运行用户脚本，超时强制终止。
 * 每次执行都新建 Worker，避免脚本之间共享全局状态。
 */
export function runScript(
  code: string,
  ctx: ScriptContext,
  timeoutMs = 5000,
  onLog?: (line: string) => void,
): Promise<ScriptResult> {
  const started = Date.now();
  if (!code.trim()) {
    return Promise.resolve({ ok: true, text: "", logs: [], durationMs: 0 });
  }

  return new Promise<ScriptResult>((resolve) => {
    let settled = false;
    let worker: Worker;
    try {
      worker = new ScriptWorker();
    } catch (err) {
      resolve({
        ok: false,
        text: "",
        logs: [],
        error: `无法启动脚本沙箱：${err instanceof Error ? err.message : String(err)}`,
        durationMs: 0,
      });
      return;
    }

    const logs: string[] = [];
    const finish = (result: ScriptResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        text: "",
        logs,
        error: `脚本执行超过 ${timeoutMs}ms，已强制终止`,
        durationMs: Date.now() - started,
      });
    }, Math.max(200, timeoutMs));

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as {
        type: "log" | "result";
        line?: string;
        ok?: boolean;
        text?: string;
        messages?: ChatMessage[];
        logs?: string[];
        error?: string;
      };
      if (data.type === "log") {
        if (data.line) {
          logs.push(data.line);
          onLog?.(data.line);
        }
        return;
      }
      if (data.type === "result") {
        finish({
          ok: !!data.ok,
          text: data.text ?? "",
          messages: data.messages,
          logs: data.logs ?? logs,
          error: data.error,
          durationMs: Date.now() - started,
        });
      }
    };

    worker.onerror = (event) => {
      finish({
        ok: false,
        text: "",
        logs,
        error: event.message || "脚本运行出错",
        durationMs: Date.now() - started,
      });
    };

    worker.postMessage({
      code,
      ctx: {
        messages: ctx.messages.map((m) => ({ role: m.role, content: m.content })),
        input: ctx.input,
        vars: ctx.vars,
        character: {
          name: ctx.character.name,
          systemPrompt: ctx.character.systemPrompt,
          description: ctx.character.description,
        },
        history: ctx.history,
      },
    });
  });
}
