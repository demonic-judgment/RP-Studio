import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ChevronRight } from "lucide-react";
import { useStore } from "../../lib/store";
import type { Character, Message } from "../../lib/types";
import { cn } from "../../lib/utils";
import { MessageItem } from "./MessageItem";

export function MessageList({
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
  const stream = useStore((s) => s.stream);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const editMessage = useStore((s) => s.editMessage);
  const regenerate = useStore((s) => s.regenerate);
  const removeMessage = useStore((s) => s.removeMessage);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  const streaming = stream.running && stream.sessionId === activeSessionId;
  const streamText = stream.buffer;
  // 用 mask 让消息在悬浮输入层上缘自然淡出（不再叠一层不透明色带），
  // 因此底部只需预留 淡出高度 + 呼吸间距。
  const fade = 56;
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
  }, [messages.length, streamText, atBottom, streaming, reserved]);

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

  const virtualMessage: Message = {
    id: "streaming-virtual",
    sessionId: activeSessionId ?? "",
    role: "assistant",
    content: streamText,
    status: "streaming",
    meta: { viaWorkflow: stream.mode === "workflow" },
    createdAt: new Date().toISOString(),
  };

  return (
    <div className="relative min-h-0 flex-1">
      {/* 遮罩放在滚动容器外的包裹层：遮罩框不随滚动位移，也避开 iOS 上「遮罩 + overflow」的历史问题 */}
      <div className="h-full" style={{ maskImage, WebkitMaskImage: maskImage }}>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          style={{ paddingBottom: reserved }}
          className="h-full overflow-y-auto overscroll-contain px-4 pt-6 sm:px-6"
        >
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5">
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
                  disabled={streaming}
                />
              ))
            )}

            {streaming && (
              <>
                {stream.logs.length > 0 && <StreamLogs logs={stream.logs} />}
                <MessageItem
                  message={virtualMessage}
                  name={character.name}
                  avatar={character.avatar}
                  streaming
                  onEdit={() => {}}
                  onRegenerate={() => {}}
                  onDelete={() => {}}
                />
              </>
            )}

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
        <Capability>上下文编排</Capability>
        <Capability>工作流</Capability>
        <Capability>脚本沙箱</Capability>
        <Capability>PGlite 本地存储</Capability>
      </div>
    </motion.div>
  );
}

function Capability({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-surface-2 px-inset-pill py-1.5">{children}</span>
  );
}

function StreamLogs({ logs }: { logs: { nodeTitle: string; message: string; level: string }[] }) {
  const [open, setOpen] = useState(true);
  const recent = logs.slice(-4);
  return (
    <div className="ml-0 mr-2 max-w-[calc(100%-44px)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-full bg-surface-2 px-inset-pill py-1.5 text-[11px] text-fg-subtle transition-colors hover:text-fg-muted",
        )}
      >
        <ChevronRight size={12} className={cn("transition-transform", open && "rotate-90")} />
        工作流执行日志 · {logs.length}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 rounded-xl bg-surface-2 px-inset-lg py-2.5 font-mono text-[11px] leading-relaxed text-fg-muted">
          {recent.map((log, i) => (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 text-fg-subtle">[{log.nodeTitle}]</span>
              <span className={cn("break-all", log.level === "error" && "text-danger")}>{log.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
