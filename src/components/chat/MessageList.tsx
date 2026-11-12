import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ChevronRight } from "lucide-react";
import { useStore } from "../../lib/store";
import type { Character, Message } from "../../lib/types";
import { MessageItem } from "./MessageItem";

export const MessageList = memo(function MessageList({
  character,
  onQuickPhrase,
  bottomInset = 140,
}: {
  character: Character;
  onQuickPhrase: (text: string) => void;
  /** 悬浮输入层高度，消息列表据此在底部预留空间，避免遮挡最后几行 */
  bottomInset?: number;
}) {
  const messages = useStore((s) => s.messages);
  // 只订阅布尔：整份 stream 每个 chunk 都换引用，订它等于让整个列表按 chunk 重渲染
  const streaming = useStore((s) => s.stream.running && s.stream.sessionId === s.activeSessionId);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const editMessage = useStore((s) => s.editMessage);
  const regenerate = useStore((s) => s.regenerate);
  const removeMessage = useStore((s) => s.removeMessage);
  const switchVariant = useStore((s) => s.switchVariant);
  const branchConversation = useStore((s) => s.branchConversation);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  useEffect(() => {
    atBottomRef.current = atBottom;
  }, [atBottom]);

  // 用 mask 让消息在悬浮输入层上缘自然淡出（不再叠一层不透明色带），
  // 因此底部只需预留 淡出高度 + 呼吸间距。淡出带收窄到 32px，
  // 只够把最后一行溶进输入层，不会在它上方吃掉一整段可读区域。
  const fade = 32;
  const reserved = bottomInset + fade + 8;
  const maskImage = `linear-gradient(to bottom, #000 calc(100% - ${bottomInset + fade}px), transparent calc(100% - ${bottomInset}px))`;

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  useEffect(() => {
    if (atBottom) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    // 不再依赖流式正文：正文是逐帧长高的，React 侧的 chunk 更新滞后于实际高度，
    // 贴底交给下面的 ResizeObserver 更准，也少一次每 chunk 的强制布局。
  }, [messages.length, atBottom, streaming, reserved]);

  // 打字机是逐帧长高的，store 里的 buffer 却按 chunk 更新；
  // 直接盯内容高度，停在底部时才跟，避免每帧滚动都要等一次 React 重渲染。
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!atBottomRef.current) return;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    scrollToBottom("auto");
    // 切换会话时直接落到底部
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 140);
  };

  // 往上滚的瞬间就交还控制权：否则逐帧贴底的那一次滚动会把用户拽回来
  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (event.deltaY >= 0) return;
    atBottomRef.current = false;
    setAtBottom(false);
  };

  return (
    <div className="relative min-h-0 flex-1">
      {/* 遮罩放在滚动容器外的包裹层：遮罩框不随滚动位移，也避开 iOS 上「遮罩 + overflow」的历史问题 */}
      <div className="h-full" style={{ maskImage, WebkitMaskImage: maskImage }}>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onWheel={onWheel}
          style={{ paddingBottom: reserved }}
          className="h-full overflow-y-auto overscroll-contain px-4 pt-6 [overflow-anchor:none] sm:px-6"
        >
          <div
            ref={contentRef}
            data-chat-thread
            className="mx-auto flex w-full max-w-[760px] flex-col gap-5"
          >
            {messages.length === 0 && !streaming ? (
              <CharacterIntro character={character} onQuickPhrase={onQuickPhrase} />
            ) : (
              messages.map((message) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  name={message.role === "user" ? "你" : character.name}
                  avatar={message.role === "user" ? "🫧" : character.avatar}
                  onEdit={editMessage}
                  onRegenerate={regenerate}
                  onDelete={removeMessage}
                  onSwitchVariant={switchVariant}
                  onBranch={branchConversation}
                  disabled={streaming}
                />
              ))
            )}

            {streaming && <StreamingBubble character={character} />}

            <div ref={bottomRef} className="h-2" />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {!atBottom && (
          <motion.button
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9 }}
            onClick={() => {
              setAtBottom(true);
              scrollToBottom();
            }}
            aria-label="回到最新消息"
            style={{ bottom: bottomInset + 76 }}
            className="absolute left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-surface/90 text-fg-muted shadow-card backdrop-blur dark:bg-surface-2/95"
          >
            <ArrowDown size={15} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
});

const noop = () => {};

/**
 * 正在写入的那一条。store 里的 buffer 每个 chunk 都会换引用，
 * 把它单独关在这里订阅，外面的列表、顶栏、输入层就不用跟着每个 chunk 重渲染。
 */
function StreamingBubble({ character }: { character: Character }) {
  const buffer = useStore((s) => s.stream.buffer);
  const logs = useStore((s) => s.stream.logs);
  const startedAt = useStore((s) => s.stream.startedAt);
  const mode = useStore((s) => s.stream.mode);
  const sessionId = useStore((s) => s.activeSessionId);
  // 时间戳只取一次：每条 chunk 都 new Date() 会让 message 对象白白换引用
  const createdAtRef = useRef(new Date().toISOString());

  const message = useMemo<Message>(
    () => ({
      id: "streaming-virtual",
      sessionId: sessionId ?? "",
      role: "assistant",
      content: buffer,
      status: "streaming",
      meta: { viaWorkflow: mode === "workflow" },
      createdAt: createdAtRef.current,
    }),
    [buffer, mode, sessionId],
  );

  const live = useMemo(() => ({ startedAt, logs }), [startedAt, logs]);

  return (
    <MessageItem
      message={message}
      name={character.name}
      avatar={character.avatar}
      streaming
      live={live}
      onEdit={noop}
      onRegenerate={noop}
      onDelete={noop}
      onSwitchVariant={noop}
      onBranch={noop}
    />
  );
}

function CharacterIntro({
  character,
  onQuickPhrase,
}: {
  character: Character;
  onQuickPhrase: (text: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto mt-6 w-full max-w-[560px] sm:mt-12"
    >
      <div className="flex flex-col items-center text-center">
        <div className="relative">
          <div className="absolute inset-0 -z-10 scale-125 rounded-full bg-primary/18 blur-2xl" />
          <div className="flex h-[72px] w-[72px] items-center justify-center rounded-[26px] bg-surface-2 text-[34px] shadow-card">
            {character.avatar}
          </div>
        </div>
        <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.02em] text-fg">{character.name}</h2>
        {character.tagline && (
          <p className="mt-1 text-[13px] text-fg-muted">{character.tagline}</p>
        )}
        {character.description && (
          <p className="mt-3 max-w-[440px] text-balance text-[13px] leading-relaxed text-fg-muted">
            {character.description}
          </p>
        )}
      </div>

      {character.quickPhrases.length > 0 && (
        <div className="mt-8">
          <p className="mb-2.5 text-center text-[11px] font-medium uppercase tracking-[0.12em] text-fg-subtle">
            试试这样开场
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {character.quickPhrases.slice(0, 4).map((phrase) => (
              <button
                key={phrase.id}
                onClick={() => onQuickPhrase(phrase.content)}
                className="group flex items-start gap-2 rounded-2xl bg-surface-2 px-inset-sm py-3 text-left text-[13px] leading-relaxed text-fg-muted transition-all hover:-translate-y-0.5 hover:bg-surface-3 hover:text-fg hover:shadow-card"
              >
                <ChevronRight size={14} className="mt-0.5 shrink-0 text-fg-subtle group-hover:text-primary" />
                <span className="line-clamp-2">{phrase.content}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-[11px] text-fg-subtle">
        <Capability>角色设定</Capability>
        <Capability>画面同步</Capability>
        <Capability>自定义工作流</Capability>
        <Capability>数据只存本地</Capability>
      </div>
    </motion.div>
  );
}

function Capability({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-surface-2 px-inset-pill py-1.5">{children}</span>
  );
}
