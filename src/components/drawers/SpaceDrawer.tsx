import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ImageIcon,
  Maximize2,
  Plus,
  Save,
  Trash2,
  Upload,
  UserRound,
  Workflow as WorkflowIcon,
  X,
} from "lucide-react";
import { useStore } from "../../lib/store";
import { validateWorkflow } from "../../lib/workflow";
import { prepareReferenceImage } from "../../lib/image";
import type { ContextBlock, QuickPhrase, Space } from "../../lib/types";
import { cn, uid } from "../../lib/utils";
import { Drawer, DrawerHeader } from "../ui/Drawer";
import { Button, IconButton } from "../ui/Button";
import { Field, Input, Textarea, Switch } from "../ui/Form";
import { Tabs } from "../ui/Tabs";
import { ContextEditor } from "../character/ContextEditor";
import { CharacterAvatar, characterSeed } from "../character/CharacterAvatar";
import { ScriptEditor } from "../script/ScriptEditor";
import { WorkflowEditor } from "../workflow/WorkflowEditor";

type TabId = "basic" | "characters" | "context" | "workflow" | "script" | "phrases";

const AVATARS = ["🎭", "🌧️", "🏮", "🛰️", "🕯️", "🗡️", "🏙️", "🌊", "🐉", "🧝", "🧛", "🕵️", "🤖", "🦊", "🌸", "👑"];

/** 存之前去掉空槽；列表本身保持用户上传的顺序 */
function trimSeeds(seeds: string[]): string[] {
  return (seeds ?? []).filter((src, index, list) => Boolean(src) && list.indexOf(src) === index);
}

/**
 * 空间设置：共享提示词、上下文编排、工作流、脚本、快捷语、底图库。
 * 角色自己的东西（名字、开场白、专属提示词、用哪张底图）在角色编辑里。
 */
export function SpaceDrawer() {
  const open = useStore((s) => s.drawer === "space");
  const openDrawer = useStore((s) => s.openDrawer);
  const space = useStore((s) => s.spaces.find((item) => item.id === s.activeSpaceId) ?? null);
  const characters = useStore((s) => s.characters);
  const activeCharacterId = useStore((s) => s.activeCharacterId);
  const messages = useStore((s) => s.messages);
  // 只订用得到的几个字段：订整份 settings 的话，设置抽屉里拖滑杆、改称呼
  // 都会把这个抽屉整棵树重渲染一遍（哪怕它是关着的）。
  const userName = useStore((s) => s.settings.userName);
  const imageEnabled = useStore((s) => s.settings.imageEnabled);
  const scriptTimeoutMs = useStore((s) => s.settings.scriptTimeoutMs);
  const saveSpace = useStore((s) => s.saveSpace);
  const removeSpace = useStore((s) => s.removeSpace);
  const selectCharacter = useStore((s) => s.selectCharacter);
  const createCharacter = useStore((s) => s.createCharacter);
  const newSession = useStore((s) => s.newSession);
  const toast = useStore((s) => s.toast);

  const [draft, setDraft] = useState<Space | null>(space);
  const [tab, setTab] = useState<TabId>("basic");
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingSeed, setUploadingSeed] = useState(false);
  const seedInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && space) {
      setDraft({ ...space });
      setConfirmDelete(false);
    }
  }, [open, space?.id, space?.updatedAt]);

  const dirty = useMemo(() => {
    // 抽屉关着时不用比：草稿里带着整份工作流与上下文块，
    // 每次消息 / 设置变化都 stringify 两遍是白算。
    if (!open || !draft || !space) return false;
    return JSON.stringify(draft) !== JSON.stringify(space);
  }, [open, draft, space]);

  // 只在「工作流」页真的开着时才校验：validateWorkflow 要遍历全部节点与连线，
  // 挂在组件顶层等于每次重渲染都算一遍，而结果只有那一页用得到。
  const workflowErrors = useMemo(
    () => (open && tab === "workflow" && draft ? validateWorkflow(draft.workflow) : []),
    [open, tab, draft],
  );

  const spaceCharacters = useMemo(
    () => (space ? characters.filter((c) => c.spaceId === space.id) : []),
    [characters, space],
  );
  const character = characters.find((c) => c.id === activeCharacterId) ?? spaceCharacters[0] ?? null;

  if (!draft) return null;

  const patch = (value: Partial<Space>) => setDraft({ ...draft, ...value });

  const seeds = trimSeeds(draft.imageSeeds);

  const handleSeedUpload = async (files: FileList | null) => {
    const picked = Array.from(files ?? []);
    if (!picked.length) return;
    setUploadingSeed(true);
    try {
      const added: string[] = [];
      for (const file of picked) added.push(await prepareReferenceImage(file));
      patch({ imageSeeds: Array.from(new Set([...seeds, ...added])) });
    } catch (err) {
      toast({
        title: "底图读取失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setUploadingSeed(false);
    }
  };

  const removeSeed = (src: string) =>
    patch({ imageSeeds: seeds.filter((item) => item !== src) });

  const requestClose = () => {
    if (dirty && !window.confirm("空间设置有未保存的修改，确定关闭？")) return;
    openDrawer(null);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await saveSpace({
        id: draft.id,
        name: draft.name,
        avatar: draft.avatar,
        systemPrompt: draft.systemPrompt,
        imageSeeds: seeds,
        contextBlocks: draft.contextBlocks,
        quickPhrases: draft.quickPhrases,
        workflow: draft.workflow,
        script: draft.script,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Drawer
        open={open}
        onClose={requestClose}
        side="right"
        ariaLabel="空间设置"
        className="w-[min(620px,100vw)]"
      >
        <DrawerHeader
          title={
            <span className="flex items-center gap-2">
              <span className="text-[17px]">{draft.avatar}</span>
              {draft.name || "未命名空间"}
            </span>
          }
          subtitle={`空间设置 · ${spaceCharacters.length} 个角色`}
          onClose={requestClose}
        >
          <Button
            variant={dirty ? "primary" : "ghost"}
            size="sm"
            disabled={!dirty || saving}
            onClick={save}
            leading={<Save size={13} />}
          >
            {saving ? "保存中…" : dirty ? "保存" : "已保存"}
          </Button>
        </DrawerHeader>

        <div className="border-b border-line px-3 py-2">
          <Tabs<TabId>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "basic", label: "基础" },
              { id: "characters", label: "角色" },
              { id: "context", label: "上下文" },
              { id: "workflow", label: "工作流" },
              { id: "script", label: "脚本" },
              { id: "phrases", label: "快捷语" },
            ]}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {tab === "basic" && (
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-[30px] shadow-soft">
                  {draft.avatar}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <Field label="空间图标">
                    <Input
                      value={draft.avatar}
                      onChange={(e) => patch({ avatar: e.target.value.slice(0, 4) })}
                      className="h-9 w-24 text-center text-lg"
                      maxLength={4}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-1">
                    {AVATARS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => patch({ avatar: emoji })}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-lg text-[15px] transition-colors hover:bg-surface-2",
                          draft.avatar === emoji && "bg-primary-container",
                        )}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <Field label="空间名">
                <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
              </Field>

              <Field
                label="共享系统提示词"
                hint="空间里所有角色共用这一段：世界、规则、说话的分寸都写这里。角色自己的身份与脾性写在角色编辑里；支持 {{char}} / {{user}}"
              >
                <Textarea
                  value={draft.systemPrompt}
                  onChange={(e) => patch({ systemPrompt: e.target.value })}
                  className="min-h-[220px] text-[12.5px] leading-relaxed"
                  placeholder="这是一个发生在……的世界。"
                />
              </Field>

              <Field
                label="底图库"
                hint="这里上传的图供空间内所有角色挑选。一张正面全身照最稳：双手双脚完整入画，脑袋正对前方、不要歪斜。建议事先洗一下底图，现代人物洗成西装与白衬衫、古风人物洗成白色轻纱汉服，换装换动作不容易跑形"
              >
                <div className="flex flex-wrap gap-2">
                  {seeds.map((src) => (
                    <div key={src} className="group/seed relative">
                      <div className="aspect-[2/3] w-[64px] overflow-hidden rounded-lg border border-line">
                        <img src={src} alt="底图" className="h-full w-full object-cover" />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSeed(src)}
                        aria-label="删除这张底图"
                        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-white opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover/seed:opacity-100"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => seedInputRef.current?.click()}
                    disabled={uploadingSeed}
                    title="上传底图，可多选"
                    className="flex aspect-[2/3] w-[64px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line/80 bg-surface-2 text-fg-subtle transition-colors hover:border-primary/50 hover:text-fg-muted disabled:opacity-60"
                  >
                    <Upload size={15} />
                    <span className="text-[10px]">{uploadingSeed ? "…" : "上传"}</span>
                  </button>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">
                  {seeds.length
                    ? "每个角色在角色编辑里挑其中一张，图生图每轮都拿它重新画。"
                    : "还没有底图。想用图生图，先在这里传一张，再去角色里选。"}
                </p>
                <input
                  ref={seedInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void handleSeedUpload(event.target.files);
                    event.target.value = "";
                  }}
                />
              </Field>

              <div className="border-t border-line pt-4">
                {confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      leading={<Trash2 size={13} />}
                      onClick={async () => {
                        await removeSpace(draft.id);
                        setConfirmDelete(false);
                        openDrawer(null);
                      }}
                    >
                      确认删除空间（含全部角色与会话）
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                      取消
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    leading={<Trash2 size={13} />}
                    onClick={() => setConfirmDelete(true)}
                  >
                    删除空间
                  </Button>
                )}
              </div>
            </div>
          )}

          {tab === "characters" && (
            <div className="space-y-3">
              <p className="text-[11.5px] leading-relaxed text-fg-subtle">
                同一个空间可以有多个角色：它们共用这里的提示词、编排与底图库，各自带着自己的开场白和专属提示词。
              </p>

              {spaceCharacters.map((item) => {
                const active = item.id === activeCharacterId;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center gap-2.5 rounded-2xl px-inset-sm py-2.5 transition-colors",
                      active ? "bg-primary-container" : "bg-surface-2 hover:bg-surface-3",
                    )}
                  >
                    <CharacterAvatar
                      seed={characterSeed(item, draft)}
                      emoji={item.avatar}
                      alt={item.name}
                      className="w-[28px] bg-surface"
                      rounded="rounded-[8px]"
                      emojiSize={16}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-[13px] font-medium",
                          active ? "text-on-primary-container" : "text-fg",
                        )}
                      >
                        {item.name}
                      </p>
                      <p className="truncate text-[11px] text-fg-subtle">
                        {item.systemPrompt.trim().split("\n")[0] || "未填写角色设定"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11.5px]"
                      onClick={async () => {
                        if (dirty) await save();
                        if (!active) await selectCharacter(item.id);
                        openDrawer("character");
                      }}
                    >
                      编辑
                    </Button>
                  </div>
                );
              })}

              <Button
                variant="outline"
                size="sm"
                leading={<Plus size={13} />}
                onClick={async () => {
                  if (dirty) await save();
                  await createCharacter();
                }}
              >
                新建角色
              </Button>

              {activeCharacterId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11.5px]"
                  leading={<UserRound size={12} />}
                  onClick={async () => {
                    if (dirty) await save();
                    await newSession(activeCharacterId);
                  }}
                >
                  用当前角色新建会话
                </Button>
              )}
            </div>
          )}

          {tab === "context" && character && (
            <ContextEditor
              space={draft}
              character={character}
              blocks={draft.contextBlocks}
              onChange={(contextBlocks: ContextBlock[]) => patch({ contextBlocks })}
              history={messages}
              userName={userName}
              imageEnabled={imageEnabled}
            />
          )}

          {tab === "workflow" && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 rounded-2xl bg-surface-2 p-inset-sm">
                <div>
                  <p className="text-[12.5px] font-medium text-fg">启用工作流</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-subtle">
                    开启后，空间里每个角色的回复都按画布的顺序来写。不想用就关掉，回到普通对话。
                  </p>
                </div>
                <Switch
                  label="启用工作流"
                  checked={draft.workflow?.enabled ?? false}
                  onChange={(enabled) =>
                    patch({ workflow: { ...draft.workflow, enabled } })
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-line px-inset-lg py-3">
                  <p className="text-[10.5px] uppercase tracking-[0.1em] text-fg-subtle">节点</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-fg">
                    {draft.workflow?.nodes.length ?? 0}
                  </p>
                </div>
                <div className="rounded-xl border border-line px-inset-lg py-3">
                  <p className="text-[10.5px] uppercase tracking-[0.1em] text-fg-subtle">连线</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-fg">
                    {draft.workflow?.edges.length ?? 0}
                  </p>
                </div>
              </div>

              {workflowErrors.length > 0 ? (
                <div className="rounded-xl bg-warning/10 px-inset-lg py-2.5 text-[11.5px] text-warning">
                  {workflowErrors.map((err) => (
                    <p key={err} className="flex items-center gap-1.5">
                      <AlertTriangle size={12} />
                      {err}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-[11.5px] text-fg-subtle">结构完整，可以运行。</p>
              )}

              <Button
                variant="primary"
                className="w-full"
                onClick={() => setWorkflowOpen(true)}
                leading={<Maximize2 size={14} />}
              >
                打开全屏工作流编排
              </Button>

              <div className="space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
                  节点清单
                </p>
                {(draft.workflow?.nodes ?? []).map((node) => (
                  <div
                    key={node.id}
                    className="flex items-center justify-between rounded-lg bg-surface-2 px-inset-md py-2 text-[11.5px]"
                  >
                    <span className="flex items-center gap-1.5 text-fg-muted">
                      <WorkflowIcon size={11} />
                      {node.title}
                    </span>
                    <span className="font-mono text-[10.5px] text-fg-subtle">{node.kind}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "script" && character && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-surface-2 p-inset-sm text-[11.5px] leading-relaxed text-fg-muted">
                这是每次生成前运行的<span className="text-fg">前置脚本</span>：可以读取装配后的
                messages，改写后返回 <code className="rounded bg-surface-3 px-1 font-mono text-[11px]">{`{ messages }`}</code>
                ，即可影响最终请求。它对空间里所有角色生效；工作流中的「脚本」节点则在编排内单独执行。
              </div>
              <ScriptEditor
                code={draft.script}
                onChange={(script) => patch({ script })}
                space={draft}
                character={character}
                messages={messages}
                userName={userName}
                imageEnabled={imageEnabled}
                timeoutMs={scriptTimeoutMs}
                minHeight={260}
              />
            </div>
          )}

          {tab === "phrases" && (
            <QuickPhrasesEditor
              phrases={draft.quickPhrases}
              onChange={(quickPhrases) => patch({ quickPhrases })}
            />
          )}
        </div>

        <div className="shrink-0 border-t border-line px-5 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[11px] text-fg-subtle">
              {dirty ? "有未保存的修改" : `上次保存 ${new Date(draft.updatedAt).toLocaleString("zh-CN")}`}
            </p>
            <div className="flex items-center gap-1.5">
              {space && dirty && (
                <Button variant="ghost" size="sm" onClick={() => setDraft({ ...space })}>
                  还原
                </Button>
              )}
              <Button variant="primary" size="sm" onClick={save} disabled={!dirty || saving}>
                保存空间
              </Button>
            </div>
          </div>
        </div>
      </Drawer>

      {character && (
        <WorkflowEditor
          open={workflowOpen}
          workflow={draft.workflow}
          space={draft}
          character={character}
          messages={messages}
          userName={userName}
          onClose={() => setWorkflowOpen(false)}
          onChange={(workflow) => patch({ workflow })}
        />
      )}
    </>
  );
}

function QuickPhrasesEditor({
  phrases,
  onChange,
}: {
  phrases: QuickPhrase[];
  onChange: (phrases: QuickPhrase[]) => void;
}) {
  const update = (id: string, value: Partial<QuickPhrase>) =>
    onChange(phrases.map((p) => (p.id === id ? { ...p, ...value } : p)));

  return (
    <div className="space-y-3">
      <p className="text-[11.5px] leading-relaxed text-fg-subtle">
        点一下就能填入。空间里的角色共用这一组快捷语；「标签」是按钮上的字，「内容」是实际发出去的文本。
      </p>
      {phrases.map((phrase) => (
        <div key={phrase.id} className="space-y-2 rounded-2xl border border-line p-inset-sm">
          <div className="flex items-center gap-2">
            <Input
              value={phrase.label}
              onChange={(e) => update(phrase.id, { label: e.target.value })}
              placeholder="标签，例如：入戏"
              className="h-8 flex-1 text-[12.5px]"
            />
            <IconButton
              label="删除"
              className="hover:text-danger"
              onClick={() => onChange(phrases.filter((p) => p.id !== phrase.id))}
            >
              <Trash2 size={13} />
            </IconButton>
          </div>
          <Textarea
            value={phrase.content}
            onChange={(e) => update(phrase.id, { content: e.target.value })}
            placeholder="实际发送的内容"
            className="min-h-[64px] text-[12.5px]"
          />
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        leading={<Plus size={13} />}
        onClick={() => onChange([...phrases, { id: uid("qp"), label: "新快捷语", content: "" }])}
      >
        添加快捷语
      </Button>
      <p className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <ImageIcon size={11} />
        底图库在「基础」页，角色自己挑用哪一张。
      </p>
    </div>
  );
}
