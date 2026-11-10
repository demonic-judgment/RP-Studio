import { memo, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, Copy, Pencil, Trash2, X } from "lucide-react";
import type { Message } from "../../lib/types";
import { copyText, formatTime } from "../../lib/utils";
import { useSmoothText } from "../../lib/hooks/use-smooth-text";
import { Markdown } from "./Markdown";
import { MessageActivity, type RunLog } from "./MessageActivity";
import { Button, IconButton } from "../ui/Button";
import {
  StreamingResponse,
  type StreamingResponseMessages,
  type StreamingResponseStatus,
} from "../agents/streaming-response";

/** beui 的 StreamingResponse 默认是英文，这里接中文文案 */
const RESPONSE_LABELS: Partial<StreamingResponseMessages> = {
  copy: "复制",
  copied: "已复制",
  retry: "重新生成",
  helpful: "有帮助",
  notHelpful: "没帮助",
  source: "{count} 个来源",
  sources: "{count} 个来源",
};

interface MessageItemProps {
  message: Message;
  name: string;
  avatar: string;
  streaming?: boolean;
  /** 流式运行态：起始时间与实时日志，喂给顶部的活动流 */
  live?: { startedAt: number | null; logs: RunLog[] };
  onEdit: (messageId: string, content: string) => void;
  onRegenerate: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  /** 在重新生成留下的历史版本之间切换 */
  onSwitchVariant: (messageId: string, index: number) => void;
  disabled?: boolean;
}

function MessageItemBase({
  message,
  name,
  avatar,
  streaming,
  live,
  onEdit,
  onRegenerate,
  onDelete,
  onSwitchVariant,
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
  // 正在写入的这一条，以及页面上残留的半截流式消息，都按 streaming 呈现
  const responseStatus: StreamingResponseStatus =
    streaming || message.status === "streaming" ? "streaming" : "complete";
  // 打字机：按帧匀速揭示缓冲文本，而不是把网络 chunk 整块甩出来
  const revealed = useSmoothText(message.content, { enabled: Boolean(streaming) });

  // 重新生成留下的历史版本；只有一版时不显示切换器
  const variants = message.meta.variants ?? [];
  const variantIndex = message.meta.variantIndex ?? Math.max(0, variants.length - 1);

  // 用户气泡的操作条：复制 / 编辑重发 / 删除。角色的操作条由回复面自己渲染。
  const userActions = (
    <div className="flex items-center gap-0.5 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100">
      <IconButton label={copied ? "已复制" : "复制"} onClick={handleCopy} className="h-7 w-7">
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </IconButton>
      <IconButton
        label="编辑并重新生成"
        className="h-7 w-7"
        onClick={() => setEditing(true)}
        disabled={disabled}
      >
        <Pencil size={13} />
      </IconButton>
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
            <div className="flex h-6 items-center pr-0.5">{userActions}</div>
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

        <MessageActivity
          message={message}
          running={Boolean(streaming)}
          startedAt={live?.startedAt}
          liveLogs={live?.logs}
        />

        <StreamingResponse
          status={isError ? "error" : responseStatus}
          copyText={message.content}
          onCopy={handleCopy}
          onRetry={message.meta.greeting ? undefined : () => onRegenerate(message.id)}
          labels={RESPONSE_LABELS}
          contentClassName="text-[14.5px] leading-relaxed text-fg"
          announce={false}
          extraActions={
            <>
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
            </>
          }
        >
          {isError ? (
            <div className="rounded-2xl bg-danger/10 px-inset-sm py-3">
              <p className="text-[13px] font-medium text-danger">生成失败</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-fg-muted">
                {message.meta.error || message.content}
              </p>
            </div>
          ) : message.content ? (
            <Markdown content={revealed} streaming={Boolean(streaming)} />
          ) : (
            <TypingDots />
          )}
        </StreamingResponse>

        {variants.length > 1 && (
          <div className="mt-1 flex items-center gap-0.5 text-[11px] text-fg-subtle">
            <IconButton
              label="上一版回答"
              className="h-6 w-6"
              onClick={() => onSwitchVariant(message.id, variantIndex - 1)}
              disabled={disabled || variantIndex <= 0}
            >
              <ChevronLeft size={12} />
            </IconButton>
            <span className="min-w-[38px] text-center tabular-nums">
              {variantIndex + 1} / {variants.length}
            </span>
            <IconButton
              label="下一版回答"
              className="h-6 w-6"
              onClick={() => onSwitchVariant(message.id, variantIndex + 1)}
              disabled={disabled || variantIndex >= variants.length - 1}
            >
              <ChevronRight size={12} />
            </IconButton>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * 每条消息都很贵的渲染：流式打字机每帧都会让列表重渲染，
 * 用 memo 把已经写完的历史消息挡在外面，只有正在写的那条需要逐帧更新。
 */
export const MessageItem = memo(MessageItemBase);

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
