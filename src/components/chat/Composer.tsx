import { type KeyboardEvent, useEffect, useMemo, useRef } from "react";
import { Sparkles } from "lucide-react";
import { useStore } from "../../lib/store";
import type { Character } from "../../lib/types";
import { estimateTokens } from "../../lib/utils";
import { assembleContext } from "../../lib/context";
import { PromptInput, type PromptInputMessages, type PromptModel } from "../agents/prompt-input";

/** 快捷语插入后要靠它把焦点还给输入框；textarea 由组件内部持有，只能用 id 拿 */
const INPUT_ID = "composer-input";

const PROMPT_LABELS: Partial<PromptInputMessages> = {
  label: "消息输入",
  addToPrompt: "加入提示词",
  chooseModel: "选择模型",
  send: "发送",
  stop: "停止生成",
};

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
  const setActiveModel = useStore((s) => s.setActiveModel);
  const shellRef = useRef<HTMLDivElement>(null);

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

  const models = useMemo<PromptModel[]>(
    () => settings.models.map((profile) => ({ value: profile.id, label: profile.name })),
    [settings.models],
  );

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

  const insertPhrase = (content: string) => {
    onChange(value.trim() ? `${value.trim()}\n${content}` : content);
    requestAnimationFrame(() => {
      const el = document.getElementById(INPUT_ID) as HTMLTextAreaElement | null;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  };

  // 组件默认「Enter 提交 / Shift+Enter 换行」，这里接管关掉 enterToSend 的情形：
  // Enter 退化成换行，⌘/Ctrl+Enter 照旧提交（组件本身也会处理带修饰键的回车）。
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      settings.enterToSend ||
      event.key !== "Enter" ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    const el = event.currentTarget;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    onChange(`${value.slice(0, start)}\n${value.slice(end)}`);
    requestAnimationFrame(() => {
      el.selectionStart = start + 1;
      el.selectionEnd = start + 1;
    });
  };

  const sendHint = settings.enterToSend
    ? "Enter 发送 · Shift+Enter 换行"
    : "⌘/Ctrl+Enter 发送";

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
      {/* 这里不再铺不透明渐变色带：消息列表改用 mask 自身淡出，
          输入框左右两侧保持与页面一致的半透明底色（能透出背景）。 */}
      <div
        ref={shellRef}
        className="pointer-events-auto mx-auto w-full max-w-[820px] px-3 pb-4 sm:px-5 sm:pb-5"
      >
        <div className="rounded-[26px] bg-surface/90 p-2.5 shadow-float-soft backdrop-blur-xl transition-shadow focus-within:shadow-focus-soft dark:bg-surface-2/95">
          {(character.quickPhrases.length > 0 || tokens > 0) && (
            <div className="flex items-center gap-2 px-1 pb-1.5">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar">
                <span className="flex shrink-0 items-center gap-1 pl-1 pr-0.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
                  <Sparkles size={11} />
                  快捷语
                </span>
                {character.quickPhrases.map((phrase) => (
                  <button
                    key={phrase.id}
                    type="button"
                    onClick={() => insertPhrase(phrase.content)}
                    className="shrink-0 rounded-full bg-surface-2 px-inset-pill py-1.5 text-[11.5px] text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg"
                    title={phrase.content}
                  >
                    {phrase.label}
                  </button>
                ))}
              </div>
              {tokens > 0 && (
                <span className="shrink-0 whitespace-nowrap pr-0.5 text-[10.5px] tabular-nums text-fg-subtle">
                  上下文 ≈ {tokens} tokens
                </span>
              )}
            </div>
          )}

          {/* 卡片外观由外层提供，组件只负责 textarea + 底部工具条（模型切换 / 发送） */}
          <PromptInput
            id={INPUT_ID}
            value={value}
            onValueChange={onChange}
            models={models}
            model={settings.activeModelId}
            onModelChange={(id) => void setActiveModel(id)}
            onSubmit={() => onSend()}
            loading={streaming}
            onStop={onStop}
            minRows={1}
            maxRows={9}
            placeholder={sendHint}
            labels={PROMPT_LABELS}
            onKeyDown={handleKeyDown}
            className="rounded-[20px] border-0 bg-transparent p-0"
          />
        </div>
      </div>
    </div>
  );
}
