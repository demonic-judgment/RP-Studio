import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Eye,
  GripVertical,
  History,
  Image as ImageIcon,
  MessageSquare,
  Plus,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react";
import type { Character, ContextBlock, Message, Role } from "../../lib/types";
import {
  DEFAULT_IMAGE_DIRECTIVE,
  assembleContext,
  blockKindMeta,
  defaultImageDirectiveBlock,
  describeHistoryBlock,
  newBlockId,
} from "../../lib/context";
import { cn } from "../../lib/utils";
import { Button, IconButton } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Segmented } from "../ui/Tabs";
import { Switch } from "../ui/Form";

export function ContextEditor({
  character,
  blocks,
  onChange,
  history,
  userName,
  imageEnabled,
}: {
  character: Character;
  blocks: ContextBlock[];
  onChange: (blocks: ContextBlock[]) => void;
  history: Message[];
  userName: string;
  /** 图生图开关：关着时「生图 JSON 预设」不显示、也不参与装配 */
  imageEnabled: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const patch = (id: string, value: Partial<ContextBlock>) => {
    onChange(blocks.map((b) => (b.id === id ? ({ ...b, ...value } as ContextBlock) : b)));
  };

  const remove = (id: string) => onChange(blocks.filter((b) => b.id !== id));

  const add = (kind: ContextBlock["kind"]) => {
    let block: ContextBlock;
    if (kind === "history") block = { id: newBlockId(), kind, enabled: true, from: -12, to: -1 };
    else if (kind === "custom")
      block = { id: newBlockId(), kind, enabled: true, role: "system", content: "" };
    else if (kind === "system") block = { id: newBlockId(), kind, enabled: true };
    else if (kind === "image") block = defaultImageDirectiveBlock();
    else block = { id: newBlockId(), kind, enabled: true };
    onChange([...blocks, block]);
    setExpanded(block.id);
  };

  const hasImageBlock = blocks.some((block) => block.kind === "image");

  const preview = useMemo(
    () =>
      assembleContext({
        character: { ...character, contextBlocks: blocks },
        history,
        input: "（这里预览当前用户输入）",
        userName,
        imageEnabled,
      }),
    [blocks, character, history, userName, imageEnabled],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11.5px] leading-relaxed text-fg-subtle">
          拖动左侧手柄调整顺序：越靠前，模型越早读到。
        </p>
        <button
          onClick={() => setPreviewOpen(true)}
          className="flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-inset-pill py-1.5 text-[11px] text-fg-subtle transition-colors hover:text-fg-muted"
        >
          <Eye size={12} />
          预览
        </button>
      </div>

      <div className="space-y-2">
        {blocks.map((block, index) => {
          // 开关关着时不显示这条预设，但数组里保留，重新打开即恢复
          if (block.kind === "image" && !imageEnabled) return null;
          const meta = blockKindMeta(block.kind);
          const isOpen = expanded === block.id;
          const icon =
            block.kind === "history" ? (
              <History size={13} />
            ) : block.kind === "custom" ? (
              <Type size={13} />
            ) : block.kind === "user" ? (
              <MessageSquare size={13} />
            ) : block.kind === "image" ? (
              <ImageIcon size={13} />
            ) : (
              <Sparkles size={13} />
            );

          return (
            <div
              key={block.id}
              draggable
              onDragStart={(e) => {
                setDragIndex(index);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIndex(index);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) move(dragIndex, index);
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={cn(
                "group rounded-2xl bg-surface shadow-card transition-all",
                block.enabled ? "" : "opacity-60",
                overIndex === index && dragIndex !== null && dragIndex !== index && "ring-2 ring-primary/40",
                dragIndex === index && "opacity-50",
              )}
            >
              <div className="flex items-start gap-2 px-inset-sm py-3">
                <span className="mt-0.5 flex h-6 w-4 cursor-grab items-center justify-center text-fg-subtle active:cursor-grabbing">
                  <GripVertical size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "flex h-[22px] shrink-0 items-center gap-1 rounded-full px-inset-pill text-[10.5px] font-medium",
                        meta.tone,
                      )}
                    >
                      {icon}
                      {meta.label}
                    </span>
                    <span className="truncate text-[10.5px] text-fg-subtle">
                      {block.label && block.label !== meta.label ? block.label : meta.hint}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : block.id)}
                    className="mt-1 flex w-full items-start gap-1 text-left"
                  >
                    <span className="line-clamp-1 flex-1 text-[12px] leading-relaxed text-fg-muted">
                      {block.kind === "history"
                        ? `${describeHistoryBlock(block.from, block.to)} · 历史共 ${history.length} 条`
                        : block.kind === "custom"
                          ? `${block.role}：${block.content || "空内容"}`
                          : block.kind === "system"
                            ? character.systemPrompt || "尚未填写系统提示"
                            : block.kind === "image"
                              ? block.content.split("\n")[0] || "未填写预设"
                              : "当前输入会插入到这里"}
                    </span>
                    <ChevronDown
                      size={13}
                      className={cn(
                        "mt-0.5 shrink-0 text-fg-subtle transition-transform",
                        isOpen && "rotate-180",
                      )}
                    />
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <div className="flex items-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    <IconButton label="上移" className="h-6 w-6" onClick={() => move(index, index - 1)}>
                      <ArrowUp size={12} />
                    </IconButton>
                    <IconButton label="下移" className="h-6 w-6" onClick={() => move(index, index + 1)}>
                      <ArrowDown size={12} />
                    </IconButton>
                    <IconButton
                      label="删除此块"
                      className="h-6 w-6 hover:text-danger"
                      onClick={() => remove(block.id)}
                    >
                      <Trash2 size={12} />
                    </IconButton>
                  </div>
                  <Switch
                    size="sm"
                    checked={block.enabled}
                    onChange={(enabled) => patch(block.id, { enabled })}
                    label="启用此块"
                  />
                </div>
              </div>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-3 border-t border-line px-inset-sm py-3">
                      {block.kind === "system" && (
                        <div>
                          <p className="mb-1 text-[11px] text-fg-subtle">来自角色设定（在「基础」里编辑）</p>
                          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-surface-2 px-inset-lg py-2.5 font-sans text-[12px] leading-relaxed text-fg-muted">
                            {character.systemPrompt || "（尚未填写系统提示）"}
                          </pre>
                        </div>
                      )}

                      {block.kind === "history" && (
                        <>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {[
                              { label: "全部", from: 0, to: -1 },
                              { label: "最近 5 条", from: -5, to: -1 },
                              { label: "最近 12 条", from: -12, to: -1 },
                              { label: "最近 20 条", from: -20, to: -1 },
                            ].map((preset) => (
                              <button
                                key={preset.label}
                                onClick={() => patch(block.id, { from: preset.from, to: preset.to })}
                                className={cn(
                                  "rounded-full px-inset-pill py-1.5 text-[11px] transition-colors",
                                  block.from === preset.from && block.to === preset.to
                                    ? "bg-primary-container text-on-primary-container"
                                    : "bg-surface-2 text-fg-subtle hover:text-fg-muted",
                                )}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-end gap-2">
                            <label className="flex-1">
                              <span className="mb-1 block text-[11px] text-fg-subtle">起始下标</span>
                              <input
                                type="number"
                                value={block.from}
                                onChange={(e) => patch(block.id, { from: Number(e.target.value) })}
                                className="h-9 w-full rounded-lg bg-surface-2 px-inset-md font-mono text-[12px] outline-none focus:ring-2 focus:ring-[var(--ring)]/15"
                              />
                            </label>
                            <span className="pb-2 text-fg-subtle">→</span>
                            <label className="flex-1">
                              <span className="mb-1 block text-[11px] text-fg-subtle">结束下标</span>
                              <input
                                type="number"
                                value={block.to}
                                onChange={(e) => patch(block.id, { to: Number(e.target.value) })}
                                className="h-9 w-full rounded-lg bg-surface-2 px-inset-md font-mono text-[12px] outline-none focus:ring-2 focus:ring-[var(--ring)]/15"
                              />
                            </label>
                          </div>
                          <p className="text-[11px] leading-relaxed text-fg-subtle">
                            负数表示倒数：`[-5,-1]` = 倒数第 5 条到倒数第 1 条。
                            当前历史共 {history.length} 条。
                          </p>
                        </>
                      )}

                      {block.kind === "custom" && (
                        <>
                          <div>
                            <p className="mb-1.5 text-[11px] text-fg-subtle">消息角色</p>
                            <Segmented<Role>
                              size="sm"
                              value={block.role}
                              onChange={(role) => patch(block.id, { role })}
                              options={[
                                { id: "system", label: "system" },
                                { id: "user", label: "user" },
                                { id: "assistant", label: "assistant" },
                              ]}
                            />
                          </div>
                          <textarea
                            value={block.content}
                            onChange={(e) => patch(block.id, { content: e.target.value })}
                            placeholder="自定义提示词，可使用 {{char}} / {{user}} / {{input}} / {{time}} 变量"
                            className="min-h-[110px] w-full resize-y rounded-xl bg-surface-2 px-inset-lg py-2.5 text-[12.5px] leading-relaxed outline-none transition-colors placeholder:text-fg-subtle focus:ring-2 focus:ring-[var(--ring)]/15"
                          />
                          <p className="text-[11px] text-fg-subtle">
                            支持变量：{"{{char}}"} {"{{user}}"} {"{{input}}"} {"{{time}}"}
                          </p>
                        </>
                      )}

                      {block.kind === "image" && (
                        <>
                          <textarea
                            value={block.content}
                            onChange={(e) => patch(block.id, { content: e.target.value })}
                            placeholder="要求模型在回复开头先给出画面 JSON 的 system 指令，支持 {{char}} / {{user}}"
                            className="min-h-[150px] w-full resize-y rounded-xl bg-surface-2 px-inset-lg py-2.5 font-mono text-[12px] leading-relaxed outline-none transition-colors placeholder:text-fg-subtle focus:ring-2 focus:ring-[var(--ring)]/15"
                          />
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[11px] leading-relaxed text-fg-subtle">
                              建议保留 4 项结构：改了格式，模型可能就不按 JSON 回了。顶栏关掉「图生图」时这段不生效。
                            </p>
                            <button
                              type="button"
                              onClick={() => patch(block.id, { content: DEFAULT_IMAGE_DIRECTIVE })}
                              className="shrink-0 text-[11px] text-fg-subtle transition-colors hover:text-primary"
                            >
                              恢复默认
                            </button>
                          </div>
                        </>
                      )}

                      {block.kind === "user" && (
                        <p className="text-[11.5px] leading-relaxed text-fg-subtle">
                          代表你这一次说的话。拖动它调整你这句话出现的位置。
                        </p>
                      )}

                      <label className="flex items-center gap-2 text-[11px] text-fg-subtle">
                        <span className="shrink-0">备注名</span>
                        <input
                          value={block.label ?? ""}
                          onChange={(e) => patch(block.id, { label: e.target.value })}
                          placeholder="可选"
                          className="h-8 w-full rounded-lg bg-surface-2 px-inset-md text-[12px] outline-none focus:ring-2 focus:ring-[var(--ring)]/15"
                        />
                      </label>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-fg-subtle">添加块</span>
        {(
          [
            { kind: "system", label: "系统提示" },
            { kind: "history", label: "历史对话" },
            { kind: "custom", label: "自定义提示词" },
            { kind: "user", label: "用户回复" },
            ...(imageEnabled && !hasImageBlock ? [{ kind: "image" as const, label: "生图 JSON 预设" }] : []),
          ] as const
        ).map((item) => (
          <button
            key={item.kind}
            onClick={() => add(item.kind)}
            className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-inset-pill py-1.5 text-[11px] text-fg-muted transition-colors hover:bg-surface-3"
          >
            <Plus size={11} />
            {item.label}
          </button>
        ))}
      </div>

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="上下文预览"
        subtitle={`${preview.messages.length} 条消息 · ≈ ${preview.tokens} tokens`}
        className="max-w-[680px]"
        footer={
          <>
            <p className="min-w-0 text-[11px] leading-relaxed text-fg-subtle">
              留空的块会被跳过，不想要的直接关掉
            </p>
            <Button
              variant="ghost"
              size="sm"
              data-autofocus
              onClick={() => setPreviewOpen(false)}
            >
              关闭
            </Button>
          </>
        }
      >
        <div className="space-y-2 pb-1">
          {preview.messages.map((msg, i) => (
            <div key={i} className="rounded-xl bg-surface-2 px-inset-lg py-2.5">
              <div className="mb-1 flex items-center gap-1.5">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono text-[10px]",
                    msg.role === "system"
                      ? "bg-primary-container text-on-primary-container"
                      : msg.role === "user"
                        ? "bg-surface-3 text-fg-muted"
                        : "bg-secondary-container text-on-primary-container",
                  )}
                >
                  {msg.role}
                </span>
                <span className="text-[10px] text-fg-subtle">{msg.content.length} 字</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-fg-muted">
                {msg.content}
              </p>
            </div>
          ))}
          {preview.messages.length === 0 && (
            <p className="text-[11.5px] text-fg-subtle">所有块都被禁用，或内容为空。</p>
          )}

          <div className="space-y-0.5 border-t border-line pt-2">
            {preview.trace.map((item) => (
              <div
                key={item.blockId}
                className="flex items-center justify-between text-[10.5px] text-fg-subtle"
              >
                <span>{blockKindMeta(item.kind).label}</span>
                <span>{item.note}</span>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
