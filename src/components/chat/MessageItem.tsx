import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, ChevronRight, Copy, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import type { Message } from "../../lib/types";
import { cn, copyText, formatTime } from "../../lib/utils";
import { Markdown } from "./Markdown";
import { Button, IconButton } from "../ui/Button";

interface MessageItemProps {
  message: Message;
  name: string;
  avatar: string;
  streaming?: boolean;
  onEdit: (messageId: string, content: string) => void;
  onRegenerate: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  disabled?: boolean;
}

export function MessageItem({
  message,
  name,
  avatar,
  streaming,
  onEdit,
  onRegenerate,
  onDelete,
  disabled,
}: MessageItemProps) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(message.content);
  }, [message.content, editing]);

  useEffect(() => {
    if (editing) {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.value.length;
        el.style.height = `${el.scrollHeight}px`;
      }
    }
  }, [editing]);

  const handleCopy = async () => {
    const ok = await copyText(message.content);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  const isUser = message.role === "user";
  const isError = message.status === "error";

  const actions = (
    <div
      className={cn(
        "flex items-center gap-0.5 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100",
        streaming && "opacity-0",
      )}
    >
      <IconButton label={copied ? "已复制" : "复制"} onClick={handleCopy} className="h-7 w-7">
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </IconButton>
      {isUser ? (
        <IconButton
          label="编辑并重新生成"
          className="h-7 w-7"
          onClick={() => setEditing(true)}
          disabled={disabled}
        >
          <Pencil size={13} />
        </IconButton>
      ) : message.meta.greeting ? null : (
        <IconButton
          label="重新生成"
          className="h-7 w-7"
          onClick={() => onRegenerate(message.id)}
          disabled={disabled || streaming}
        >
          <RefreshCw size={13} />
        </IconButton>
      )}
      <IconButton
        label="删除"
        className="h-7 w-7 hover:text-danger"
        onClick={() => onDelete(message.id)}
        disabled={disabled}
      >
        <Trash2 size={13} />
      </IconButton>
      <span className="ml-1 hidden text-[10.5px] tabular-nums text-fg-subtle sm:inline">
        {message.meta.model ? `${message.meta.model} · ` : ""}
        {formatTime(message.createdAt)}
      </span>
    </div>
  );

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="group flex flex-col items-end gap-1.5"
      >
        {editing ? (
          <div className="w-full max-w-[86%] rounded-2xl bg-surface p-inset-sm shadow-card">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  onEdit(message.id, draft.trim());
                  setEditing(false);
                }
              }}
              className="max-h-64 w-full resize-none bg-transparent text-[14.5px] leading-relaxed text-fg outline-none"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-fg-subtle">⌘/Ctrl + Enter 保存并重新生成</span>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} leading={<X size={13} />}>
                  取消
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    if (draft.trim()) {
                      onEdit(message.id, draft.trim());
                      setEditing(false);
                    }
                  }}
                >
                  保存
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="max-w-[86%] whitespace-pre-wrap break-words rounded-[20px] rounded-br-[7px] bg-[var(--bubble-user)] px-inset-md py-3 text-[14.5px] leading-relaxed text-fg shadow-bubble">
              {message.content}
            </div>
            <div className="flex h-6 items-center pr-0.5">{actions}</div>
          </>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="group flex gap-3"
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[16px]">
        {avatar}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[12.5px] font-semibold text-fg-muted">{name}</span>
          {message.status === "stopped" && (
            <span className="rounded-full bg-surface-2 px-inset-pill py-1 text-[10px] text-fg-subtle">已停止</span>
          )}
          {message.meta.greeting && (
            <span className="rounded-full bg-surface-2 px-inset-pill py-1 text-[10px] text-fg-subtle">
              开场
            </span>
          )}
          {message.meta.viaWorkflow && (
            <span className="rounded-full bg-primary-container px-inset-pill py-1 text-[10px] text-on-primary-container">
              工作流
            </span>
          )}
          {message.meta.edited && <span className="text-[10px] text-fg-subtle">已编辑</span>}
        </div>

        {isError ? (
          <div className="rounded-2xl bg-danger/10 px-inset-sm py-3">
            <p className="text-[13px] font-medium text-danger">生成失败</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-fg-muted">
              {message.meta.error || message.content}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => onRegenerate(message.id)}
              leading={<RefreshCw size={13} />}
            >
              重试
            </Button>
          </div>
        ) : (
          <div className="text-[14.5px] leading-relaxed">
            {streaming && !message.content ? (
              <TypingDots />
            ) : (
              <>
                <Markdown content={message.content} />
                {streaming && (
                  <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-primary align-middle" />
                )}
              </>
            )}
          </div>
        )}

        {message.status === "streaming" && !streaming && <TypingDots />}

        {message.meta.logs && message.meta.logs.length > 0 && <LogDisclosure logs={message.meta.logs} />}

        <div className="mt-1 flex h-6 items-center">{actions}</div>
      </div>
    </motion.div>
  );
}

function LogDisclosure({ logs }: { logs: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-full bg-surface-2 px-inset-pill py-1 text-[10.5px] text-fg-subtle transition-colors hover:text-fg-muted"
      >
        <ChevronRight size={11} className={cn("transition-transform", open && "rotate-90")} />
        执行日志 · {logs.length}
      </button>
      {open && (
        <div className="mt-1 space-y-0.5 rounded-xl bg-surface-2 px-inset-lg py-2.5 font-mono text-[10.5px] leading-relaxed text-fg-muted">
          {logs.map((line, i) => (
            <div key={i} className="break-all">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TypingDots() {  return (
    <span className="inline-flex items-center gap-1 py-2" aria-label="正在输入">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-subtle"
          style={{ animationDelay: `${i * 120}ms`, animationDuration: "900ms" }}
        />
      ))}
    </span>
  );
}
