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
  UserRound,
} from "lucide-react";
import type { Character, ContextBlock, Message, ProfileConfig, ProfileSnapshot, Role, Space } from "../../lib/types";
import {
  DEFAULT_IMAGE_DIRECTIVE,
  assembleContext,
  blockKindMeta,
  defaultImageDirectiveBlock,
  describeHistoryBlock,
  isKnownBlockKind,
  newBlockId,
} from "../../lib/context";
import { DEFAULT_PROFILE_INSTRUCTION, countRounds, profileText } from "../../lib/profile";
import { cn } from "../../lib/utils";
import { Button, IconButton } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Segmented } from "../ui/Tabs";
import { Switch } from "../ui/Form";

export function ContextEditor({
  space,
  character,
  blocks,
  onChange,
  onProfileChange,
  activeProfile,
  onRunProfile,
  profileRunning,
  history,
  userName,
  imageEnabled,
}: {
  space: Space;
  character: Character;
  blocks: ContextBlock[];
  onChange: (blocks: ContextBlock[]) => void;
  /** 角色档案的整理配置存在空间上，改它要回到空间草稿 */
  onProfileChange: (patch: Partial<ProfileConfig>) => void;
  /** 当前会话该注入的那一版；为空表示还没整理过，用的是角色设定原文 */
  activeProfile: ProfileSnapshot | null;
  onRunProfile: () => void;
  profileRunning: boolean;
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
    else if (kind === "system" || kind === "character")
      block = { id: newBlockId(), kind, enabled: true };
    else if (kind === "image") block = defaultImageDirectiveBlock();
    else block = { id: newBlockId(), kind, enabled: true };
    onChange([...blocks, block]);
    setExpanded(block.id);
  };

  const hasImageBlock = blocks.some((block) => block.kind === "image");
  const rounds = countRounds(history);
  const archive = profileText(character, activeProfile);
  const profileConfig = space.profile;

  // 编排是空间的，角色只贡献自己那段档案：预览按「当前编排 + 当前角色 + 当前版本」跑一遍
  const preview = useMemo(
    () =>
      assembleContext({
        space: { ...space, contextBlocks: blocks },
        character: { ...character, profile: activeProfile?.content ?? "" },
        history,
        input: "（这里预览当前用户输入）",
        userName,
        imageEnabled,
      }),
    [blocks, space, character, activeProfile, history, userName, imageEnabled],
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
          const known = isKnownBlockKind(block.kind);
          const meta = blockKindMeta(block.kind);
          const isOpen = expanded === block.id;
          // 不认识的块只展示、不崩：装配时本来就会跳过它，界面也没必要白屏
          const summary = !known
            ? `无法识别的块（kind: ${String((block as { kind?: unknown }).kind ?? "缺失")}），删掉即可`
            : block.kind === "history"
              ? `${describeHistoryBlock(block.from, block.to)} · 历史共 ${history.length} 条`
              : block.kind === "custom"
                ? `${block.role}：${block.content || "空内容"}`
                : block.kind === "system"
                  ? space.systemPrompt || "尚未填写共享提示"
                  : block.kind === "character"
                    ? activeProfile
                      ? `第 ${activeProfile.round} 轮版 · ${activeProfile.content.split("\n")[0] || "……"}`
                      : `角色设定原文（还没整理过）· ${archive.split("\n")[0] || "空"}`
                    : block.kind === "image"
                      ? block.content.split("\n")[0] || "未填写预设"
                      : "当前输入会插入到这里";
          const icon =
            block.kind === "history" ? (
              <History size={13} />
            ) : block.kind === "custom" ? (
              <Type size={13} />
            ) : block.kind === "user" ? (
              <MessageSquare size={13} />
            ) : block.kind === "image" ? (
              <ImageIcon size={13} />
            ) : block.kind === "character" ? (
              <UserRound size={13} />
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
                      {summary}
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
                      {!known && (
                        <p className="text-[11.5px] leading-relaxed text-fg-subtle">
                          这个块的类型是「{String((block as { kind?: unknown }).kind ?? "缺失")}」，当前版本不认它：
                          装配时会被跳过，不影响对话。直接删掉就行。
                        </p>
                      )}

                      {block.kind === "system" && (
                        <div>
                          <p className="mb-1 text-[11px] text-fg-subtle">空间共享提示（在空间设置的「基础」里编辑）</p>
                          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-surface-2 px-inset-lg py-2.5 font-sans text-[12px] leading-relaxed text-fg-muted">
                            {space.systemPrompt || "（尚未填写共享提示）"}
                          </pre>
                        </div>
                      )}

                      {block.kind === "character" && (
                        <div className="space-y-3">
                          <div>
                            <p className="mb-1 text-[11px] text-fg-subtle">
                              这一会话已经聊到第 {rounds} 轮 · 当前注入{" "}
                              {activeProfile ? `第 ${activeProfile.round} 轮整理的那一版` : "角色设定原文（第 0 版）"}
                              ；回看更早的消息时用当时那一版
                            </p>
                            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-surface-2 px-inset-lg py-2.5 font-sans text-[12px] leading-relaxed text-fg-muted">
                              {archive || "（这个角色还没写设定，先到角色编辑里补一段）"}
                            </pre>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="flex items-center gap-2 text-[11.5px] text-fg-muted">
                              <Switch
                                size="sm"
                                checked={profileConfig.enabled}
                                onChange={(enabled) => onProfileChange({ enabled })}
                                label="自动整理角色档案"
                              />
                              自动整理
                            </label>
                            <span className="text-[11.5px] text-fg-subtle">
                              每 {profileConfig.every} 轮整理一次 · 改频率去「基础」
                            </span>
                          </div>
                          <p className="text-[11px] leading-relaxed text-fg-subtle">
                            一轮 = 一问一答。整理不挡聊天，你可以接着说；关掉开关后不再生成新版本，已有的版本照常注入。
                          </p>

                          <div>
                            <p className="mb-1.5 text-[11px] text-fg-subtle">
                              合并指令：每次整理时连同「本段对话 + 当前档案」一起发给模型，输出只取 JSON 里「角色档案」那个键的原文
                            </p>
                            <textarea
                              value={profileConfig.instruction}
                              onChange={(e) => onProfileChange({ instruction: e.target.value })}
                              className="min-h-[140px] w-full resize-y rounded-xl bg-surface-2 px-inset-lg py-2.5 font-mono text-[11.5px] leading-relaxed outline-none transition-colors placeholder:text-fg-subtle focus:ring-2 focus:ring-[var(--ring)]/15"
                            />
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              <p className="text-[11px] text-fg-subtle">支持 {"{{char}}"} / {"{{user}}"}</p>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => onProfileChange({ instruction: DEFAULT_PROFILE_INSTRUCTION })}
                                  className="text-[11px] text-fg-subtle transition-colors hover:text-primary"
                                >
                                  恢复默认
                                </button>
                                <button
                                  type="button"
                                  onClick={onRunProfile}
                                  disabled={profileRunning || rounds === 0}
                                  className="rounded-full bg-surface-2 px-inset-pill py-1.5 text-[11px] text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
                                >
                                  {profileRunning ? "整理中…" : rounds === 0 ? "聊过一轮再整理" : "立即整理"}
                                </button>
                              </div>
                            </div>
                          </div>
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
            { kind: "system", label: "空间系统提示" },
            { kind: "character", label: "角色档案" },
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
