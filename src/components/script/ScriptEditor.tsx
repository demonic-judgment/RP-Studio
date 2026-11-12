import { useState } from "react";
import { CirclePlay, Eraser, Terminal, Trash2 } from "lucide-react";
import type { Character, Message } from "../../lib/types";
import { runScript } from "../../lib/script";
import { assembleContext } from "../../lib/context";
import { cn } from "../../lib/utils";
import { Button, IconButton } from "../ui/Button";

const SAMPLE = `// 可用：ctx.messages / ctx.input / ctx.vars / ctx.character / ctx.history
// 返回字符串，或 { text, messages }
log("上下文消息数:", ctx.messages.length);
log("角色:", ctx.character.name);

// 示例：给最后一条用户消息加一层潜台词提醒
const last = [...ctx.messages].reverse().find((m) => m.role === "user");
if (last) {
  ctx.messages.push({
    role: "system",
    content: "写作提示：让角色的回应停留在未说出口的那句话上。",
  });
}

return "脚本已注入潜台词提示";`;

export function ScriptEditor({
  code,
  onChange,
  character,
  messages,
  userName,
  imageEnabled,
  timeoutMs,
  minHeight = 220,
}: {
  code: string;
  onChange: (code: string) => void;
  character: Character;
  messages: Message[];
  userName: string;
  imageEnabled?: boolean;
  timeoutMs: number;
  minHeight?: number;
}) {
  const [testInput, setTestInput] = useState("（测试输入）");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<{ ok: boolean; text: string; ms: number } | null>(null);

  const run = async () => {
    setRunning(true);
    setLogs([]);
    setResult(null);
    const assembled = assembleContext({
      character,
      history: messages,
      input: testInput,
      userName,
      imageEnabled,
    });
    const output = await runScript(
      code,
      {
        messages: assembled.messages,
        input: testInput,
        vars: { char: character.name, user: userName, input: testInput },
        character,
        history: assembled.messages
          .filter((m) => m.role !== "system")
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n"),
      },
      timeoutMs,
      (line) => setLogs((prev) => [...prev, line]),
    );
    setLogs(output.logs);
    setResult({ ok: output.ok, text: output.ok ? output.text : output.error ?? "未知错误", ms: output.durationMs });
    setRunning(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11.5px] leading-relaxed text-fg-subtle">
          超时会自动停止（当前 {Math.round(timeoutMs / 1000)}s）。不确定怎么写就先点「载入示例」。
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="清空脚本" onClick={() => onChange("")}>
            <Trash2 size={13} />
          </IconButton>
          <IconButton label="载入示例" onClick={() => onChange(SAMPLE)}>
            <Eraser size={13} />
          </IconButton>
          <Button size="sm" variant="soft" onClick={run} disabled={running} leading={<CirclePlay size={13} />}>
            {running ? "运行中…" : "运行"}
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl bg-surface-2">
        <textarea
          value={code}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          placeholder="// 在这里写 JavaScript…"
          style={{ minHeight }}
          className="w-full resize-y bg-transparent px-inset-lg py-3 font-mono text-[12px] leading-[1.7] text-fg outline-none placeholder:text-fg-subtle"
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault();
              const el = e.currentTarget;
              const start = el.selectionStart;
              const next = `${code.slice(0, start)}  ${code.slice(el.selectionEnd)}`;
              onChange(next);
              requestAnimationFrame(() => {
                el.selectionStart = el.selectionEnd = start + 2;
              });
            }
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-fg-subtle">测试输入</span>
        <input
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
          className="h-8 flex-1 rounded-lg bg-surface-2 px-inset-md text-[12px] outline-none focus:ring-2 focus:ring-[var(--ring)]/15"
        />
      </div>

      {(logs.length > 0 || result) && (
        <div className="rounded-xl bg-surface-2 p-inset-lg">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-fg-muted">
              <Terminal size={12} />
              控制台
            </span>
            {result && (
              <span
                className={cn(
                  "text-[10.5px] tabular-nums",
                  result.ok ? "text-success" : "text-danger",
                )}
              >
                {result.ok ? "完成" : "失败"} · {result.ms}ms
              </span>
            )}
          </div>
          <div className="max-h-44 space-y-1 overflow-y-auto font-mono text-[11px] leading-relaxed">
            {logs.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all text-fg-muted">
                <span className="mr-1.5 text-fg-subtle">›</span>
                {line}
              </div>
            ))}
            {result && (
              <div className={cn("whitespace-pre-wrap break-all", result.ok ? "text-success" : "text-danger")}>
                {result.ok ? "← " : "✕ "}
                {result.text || "（无返回值）"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
