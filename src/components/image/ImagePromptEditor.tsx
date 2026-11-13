import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Eye,
  GripVertical,
  Plus,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react";
import type { ImagePromptBlock } from "../../lib/types";
import { assembleImagePrompt, imageBlockLabel } from "../../lib/image-prompt";
import { IMAGE_SAMPLE_PROMPT } from "../../lib/image-presets";
import { cn, uid } from "../../lib/utils";
import { Button, IconButton } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Switch } from "../ui/Form";

function newBlock(kind: ImagePromptBlock["kind"]): ImagePromptBlock {
  const id = uid("ipb");
  if (kind === "text") return { id, kind, enabled: true, label: "硬编码提示词", content: "" };
  return { id, kind, enabled: true, label: "本轮生图提示词" };
}

function BlockIcon({ kind }: { kind: ImagePromptBlock["kind"] }) {
  if (kind === "text") return <Type size={13} />;
  return <Sparkles size={13} />;
}

/**
 * 生图提示词编排：和上下文块同一套心智模型 —— 顺序即拼装顺序，
 * 可拖动排序、单块启停。块之间用换行连接，最终作为绘图模型的 prompt。
 */
export function ImagePromptEditor({
  blocks,
  onChange,
  characterName,
  userName,
}: {
  blocks: ImagePromptBlock[];
  onChange: (blocks: ImagePromptBlock[]) => void;
  characterName?: string;
  userName: string;
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

  const patch = (id: string, value: Partial<ImagePromptBlock>) => {
    onChange(blocks.map((block) => (block.id === id ? ({ ...block, ...value } as ImagePromptBlock) : block)));
  };

  /** 预览用占位提示词：没有真实回复时也能看清拼装结果（样例句在 image-preset.json） */
  const preview = useMemo(
    () =>
      assembleImagePrompt({
        blocks,
        characterName: characterName || "（角色名）",
        userName,
        prompt: IMAGE_SAMPLE_PROMPT,
      }),
    [blocks, characterName, userName],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11.5px] leading-relaxed text-fg-subtle">
          拖动左侧手柄调整顺序：越靠前，越先被画图模型读到。
        </p>
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-inset-pill py-1.5 text-[11px] text-fg-subtle transition-colors hover:text-fg-muted"
        >
          <Eye size={12} />
          预览
        </button>
      </div>

      <div className="space-y-2">
        {blocks.map((block, index) => {
          const meta = imageBlockLabel[block.kind];
          const isOpen = expanded === block.id;
          const summary =
            block.kind === "text"
              ? block.content || "空内容"
              : "模型返回的那句提示词会插在这里";

          return (
            <div
              key={block.id}
              draggable
              onDragStart={(event) => {
                setDragIndex(index);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setOverIndex(index);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
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
                      <BlockIcon kind={block.kind} />
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
                      {summary}
                    </span>
                    <ChevronDown
                      size={13}
                      className={cn("mt-0.5 shrink-0 text-fg-subtle transition-transform", isOpen && "rotate-180")}
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
                      onClick={() => onChange(blocks.filter((item) => item.id !== block.id))}
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
                      {block.kind === "text" && (
                        <>
                          <textarea
                            value={block.content}
                            onChange={(event) => patch(block.id, { content: event.target.value })}
                            placeholder="写每轮都成立的话：画风、构图、光线、镜头。可用 {{char}} / {{user}} / {{prompt}}"
                            className="min-h-[100px] w-full resize-y rounded-xl bg-surface-2 px-inset-lg py-2.5 text-[12.5px] leading-relaxed outline-none transition-colors placeholder:text-fg-subtle focus:ring-2 focus:ring-[var(--ring)]/15"
                          />
                          <p className="text-[11px] text-fg-subtle">
                            支持变量：{"{{char}}"} {"{{user}}"} {"{{prompt}}"}
                          </p>
                        </>
                      )}

                      {block.kind === "prompt" && (
                        <p className="text-[11.5px] leading-relaxed text-fg-subtle">
                          模型每轮返回的那句提示词会填在这里。想让它压过前面的画风描述，就放到最后一格。
                        </p>
                      )}

                      <label className="flex items-center gap-2 text-[11px] text-fg-subtle">
                        <span className="shrink-0">备注名</span>
                        <input
                          value={block.label ?? ""}
                          onChange={(event) => patch(block.id, { label: event.target.value })}
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
            { kind: "text", label: "硬编码提示词" },
            { kind: "prompt", label: "生图提示词" },
          ] as const
        ).map((item) => (
          <button
            key={item.kind}
            type="button"
            onClick={() => {
              const block = newBlock(item.kind);
              onChange([...blocks, block]);
              setExpanded(block.id);
            }}
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
        title="生图提示词预览"
        subtitle={`${preview.text.length} 字 · 用一句示例提示词试拼`}
        className="max-w-[640px]"
        footer={
          <>
            <p className="min-w-0 text-[11px] leading-relaxed text-fg-subtle">
              留空的块会被跳过，不想要的直接关掉
            </p>
            <Button variant="ghost" size="sm" data-autofocus onClick={() => setPreviewOpen(false)}>
              关闭
            </Button>
          </>
        }
      >
        <div className="space-y-2 pb-1">
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-surface-2 px-inset-lg py-3 font-sans text-[12px] leading-relaxed text-fg-muted">
            {preview.text || "（所有块都被禁用或为空）"}
          </pre>
          <div className="space-y-0.5 border-t border-line pt-2">
            {preview.trace.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-[10.5px] text-fg-subtle">
                <span>{imageBlockLabel[item.kind].label}</span>
                <span>{item.note}</span>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
