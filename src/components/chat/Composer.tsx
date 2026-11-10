import { useEffect, useMemo, useRef } from "react";
import { motion } from "motion/react";
import { ArrowUp, Square, Sparkles, Wand2 } from "lucide-react";
import { useStore } from "../../lib/store";
import type { Character } from "../../lib/types";
import { cn, estimateTokens } from "../../lib/utils";
import { assembleContext } from "../../lib/context";

export function Composer({
  character,
  value,
  onChange,
  onSend,
  streaming,
  onStop,
  onHeightChange,
}: {
  character: Character;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  streaming: boolean;
  onStop: () => void;
  /** 悬浮输入层的实际高度（含底部留白），消息列表据此预留空间 */
  onHeightChange?: (height: number) => void;
}) {
  const settings = useStore((s) => s.settings);
  const messages = useStore((s) => s.messages);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  // 输入框会随内容长高、快捷语行也可能出现／消失：把真实高度报给消息列表，
  // 让它的底部内边距始终等于输入层高度，最后几行消息永远不会被浮层压住。
  useEffect(() => {
    const el = shellRef.current;
    if (!el || !onHeightChange) return;
    const report = () => onHeightChange(el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onHeightChange]);

  const tokens = useMemo(() => {
    if (!settings.showTokenEstimate || !value.trim()) return 0;
    try {
      const assembled = assembleContext({
        character,
        history: messages,
        input: value,
        userName: settings.userName,
      });
      return assembled.tokens;
    } catch {
      return estimateTokens(value);
    }
  }, [character, messages, settings.showTokenEstimate, settings.userName, value]);

  const send = () => {
    if (!value.trim() || streaming) return;
    onSend();
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
      {/* 这里不再铺不透明渐变色带：消息列表改用 mask 自身淡出，
          输入框左右两侧保持与页面一致的半透明底色（能透出背景）。 */}
      <div
        ref={shellRef}
        className="pointer-events-auto mx-auto w-full max-w-[820px] px-3 pb-4 sm:px-5 sm:pb-5"
      >
        <div className="rounded-[26px] border border-line-strong/70 bg-surface/90 p-2 shadow-float backdrop-blur-xl transition-shadow focus-within:border-primary/30 focus-within:shadow-[0_28px_70px_-24px_rgba(28,25,20,0.38)]">
          {character.quickPhrases.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto px-1 pb-2 pt-1 no-scrollbar">
              <span className="flex shrink-0 items-center gap-1 pl-1 pr-0.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
                <Sparkles size={11} />
                快捷语
              </span>
              {character.quickPhrases.map((phrase) => (
                <button
                  key={phrase.id}
                  type="button"
                  onClick={() => {
                    onChange(value.trim() ? `${value.trim()}\n${phrase.content}` : phrase.content);
                    textareaRef.current?.focus();
                  }}
                  className="shrink-0 rounded-full border border-line bg-surface-2/70 px-2.5 py-1 text-[11.5px] text-fg-muted transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-fg"
                  title={phrase.content}
                >
                  {phrase.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="flex h-9 shrink-0 items-center justify-center pl-1 text-fg-subtle">
              <Wand2 size={16} />
            </div>
            <textarea
              ref={textareaRef}
              value={value}
              rows={1}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && settings.enterToSend) {
                  if (e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  send();
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={`给 ${character.name} 发消息…`}
              className="max-h-[220px] min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[14.5px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
            />

            <div className="flex shrink-0 items-center gap-1.5 pb-0.5">
              {streaming ? (
                <motion.button
                  initial={{ scale: 0.9, opacity: 0.6 }}
                  animate={{ scale: 1, opacity: 1 }}
                  type="button"
                  onClick={onStop}
                  aria-label="停止生成"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-fg text-bg transition hover:opacity-85"
                >
                  <Square size={13} fill="currentColor" />
                </motion.button>
              ) : (
                <button
                  type="button"
                  onClick={send}
                  disabled={!value.trim()}
                  aria-label="发送"
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200",
                    value.trim()
                      ? "bg-primary text-on-primary shadow-soft hover:bg-primary-hover active:scale-95"
                      : "bg-surface-3 text-fg-subtle",
                  )}
                >
                  <ArrowUp size={17} strokeWidth={2.4} />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between px-2 pb-0.5 pt-1 text-[10.5px] text-fg-subtle">
            <span className="truncate">
              {settings.enterToSend ? "Enter 发送 · Shift+Enter 换行" : "⌘/Ctrl+Enter 发送"}
            </span>
            {tokens > 0 && <span className="shrink-0 tabular-nums">上下文 ≈ {tokens} tokens</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
