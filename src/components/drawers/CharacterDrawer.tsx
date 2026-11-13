import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ImageIcon,
  Maximize2,
  Plus,
  Save,
  Trash2,
  Upload,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useStore } from "../../lib/store";
import { validateWorkflow } from "../../lib/workflow";
import { prepareReferenceImage } from "../../lib/image";
import type { Character, ContextBlock, QuickPhrase } from "../../lib/types";
import { cn, uid } from "../../lib/utils";
import { Drawer, DrawerHeader } from "../ui/Drawer";
import { Button, IconButton } from "../ui/Button";
import { Field, Input, Textarea, Switch } from "../ui/Form";
import { Tabs } from "../ui/Tabs";
import { ContextEditor } from "../character/ContextEditor";
import { ScriptEditor } from "../script/ScriptEditor";
import { WorkflowEditor } from "../workflow/WorkflowEditor";

type TabId = "basic" | "context" | "workflow" | "script" | "phrases";

const AVATARS = ["🎭", "🌙", "🛰️", "🕯️", "🐉", "🧝", "🧛", "🕵️", "🤖", "🦊", "🌸", "🗡️", "👑", "🌊"];

/** 底图只留一张：正面全身最稳，多角度参考反而会把脸与身材拉偏 */
const SEED_LABEL = "正面全身照";

/** 存之前去掉尾部空槽；`imageSeeds` 仍是数组，老数据里的多张只认第一张 */
function trimSeeds(seeds: string[]): string[] {
  const next = [...(seeds ?? [])];
  while (next.length && !next[next.length - 1]) next.pop();
  return next;
}

export function CharacterDrawer() {
  const open = useStore((s) => s.drawer === "character");
  const openDrawer = useStore((s) => s.openDrawer);
  const character = useStore((s) =>
    s.characters.find((c) => c.id === s.activeCharacterId) ?? null,
  );
  const messages = useStore((s) => s.messages);
  // 只订用得到的两个字段：订整份 settings 的话，设置抽屉里拖滑杆、改称呼
  // 都会把这个抽屉整棵树重渲染一遍（哪怕它是关着的）。
  const userName = useStore((s) => s.settings.userName);
  const imageEnabled = useStore((s) => s.settings.imageEnabled);
  const scriptTimeoutMs = useStore((s) => s.settings.scriptTimeoutMs);
  const saveCharacter = useStore((s) => s.saveCharacter);
  const removeCharacter = useStore((s) => s.removeCharacter);
  const newSession = useStore((s) => s.newSession);
  const toast = useStore((s) => s.toast);

  const [draft, setDraft] = useState<Character | null>(character);
  const [tab, setTab] = useState<TabId>("basic");
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingSeed, setUploadingSeed] = useState(false);
  const seedInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && character) {
      setDraft({ ...character });
      setConfirmDelete(false);
    }
  }, [open, character?.id, character?.updatedAt]);

  const dirty = useMemo(() => {
    // 抽屉关着时不用比：草稿里带着整份工作流与上下文块，
    // 每次消息 / 设置变化都 stringify 两遍是白算。
    if (!open || !draft || !character) return false;
    return JSON.stringify(draft) !== JSON.stringify(character);
  }, [open, draft, character]);

  // 只在「工作流」页真的开着时才校验：validateWorkflow 要遍历全部节点与连线，
  // 挂在组件顶层等于每次重渲染都算一遍，而结果只有那一页用得到。
  const workflowErrors = useMemo(
    () => (open && tab === "workflow" && draft ? validateWorkflow(draft.workflow) : []),
    [open, tab, draft],
  );

  if (!draft) return null;

  const patch = (value: Partial<Character>) => setDraft({ ...draft, ...value });

  // 老角色卡可能还存着三张（正 / 侧 / 背）：只认第一张，多余的槽位在保存时自然被裁掉
  const seed = (draft.imageSeeds ?? []).find((src) => Boolean(src)) ?? "";

  const handleSeedUpload = async (files: FileList | null) => {
    const picked = Array.from(files ?? []).slice(0, 1);
    if (!picked.length) return;
    setUploadingSeed(true);
    try {
      const data = await prepareReferenceImage(picked[0]);
      setDraft({ ...draft, imageSeeds: [data] });
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

  const clearSeed = () => setDraft({ ...draft, imageSeeds: [] });

  const requestClose = () => {
    if (dirty && !window.confirm("角色卡有未保存的修改，确定关闭？")) return;
    openDrawer(null);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await saveCharacter({
        id: draft.id,
        name: draft.name,
        avatar: draft.avatar,
        tagline: draft.tagline,
        description: draft.description,
        greeting: draft.greeting,
        imageSeeds: trimSeeds(draft.imageSeeds),
        systemPrompt: draft.systemPrompt,
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
        ariaLabel="角色卡编辑"
        className="w-[min(600px,100vw)]"
      >
        <DrawerHeader
          title={
            <span className="flex items-center gap-2">
              <span className="text-[17px]">{draft.avatar}</span>
              {draft.name || "未命名角色"}
            </span>
          }
          subtitle="角色卡 · 提示词工程 · 工作流"
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
                  <Field label="头像 Emoji">
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

              <Field label="角色名">
                <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
              </Field>

              <Field label="一句话简介">
                <Input
                  value={draft.tagline}
                  onChange={(e) => patch({ tagline: e.target.value })}
                  placeholder="例如：雨夜借伞的江湖客"
                />
              </Field>

              <Field label="角色描述" hint="展示在会话空态，也作为角色背景">
                <Textarea
                  value={draft.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  className="min-h-[76px]"
                />
              </Field>

              <Field
                label="角色底图"
                hint="一张正面全身照最稳：双手双脚完整入画，脑袋正对前方、不要歪斜。建议事先洗一下底图，现代人物洗成全裸/西装与白色衬衫（接近模型没有约束下的默认设定），古风人物洗成白色轻纱汉服，这样换装换动作不容易跑形"
              >
                <div className="flex items-start gap-3">
                  <div className="w-[116px] shrink-0 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => seedInputRef.current?.click()}
                      disabled={uploadingSeed}
                      title={seed ? "更换底图" : "上传底图"}
                      className={cn(
                        "group/slot relative flex aspect-[2/3] w-full items-center justify-center overflow-hidden rounded-xl border bg-surface-2 text-fg-subtle transition-colors",
                        seed
                          ? "border-line hover:border-primary/40"
                          : "border-dashed border-line/80 hover:border-primary/50 hover:text-fg-muted",
                      )}
                    >
                      {seed ? (
                        <img src={seed} alt="角色底图" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex flex-col items-center gap-1">
                          <ImageIcon size={18} />
                          <span className="text-[10.5px]">{uploadingSeed ? "处理中…" : "上传"}</span>
                        </span>
                      )}
                      {seed && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover/slot:opacity-100">
                          <Upload size={16} className="text-white" />
                        </span>
                      )}
                    </button>
                    <div className="flex items-center justify-between px-0.5">
                      <span className="text-[11px] text-fg-subtle">{SEED_LABEL}</span>
                      {seed && (
                        <button
                          type="button"
                          onClick={clearSeed}
                          className="text-[11px] text-fg-subtle transition-colors hover:text-danger"
                        >
                          移除
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-fg-subtle">
                    图生图每轮都拿这张重新画，画面变化只来自提示词。底图上就带着你想长期保留的那身衣服时，后续换装、换动作最稳。
                  </p>
                </div>
                <input
                  ref={seedInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    void handleSeedUpload(event.target.files);
                    event.target.value = "";
                  }}
                />
              </Field>

              <div className="space-y-2">
                <Field
                  label="初始消息"
                  hint="新建会话时自动写入的第一条角色消息，支持 {{char}} / {{user}}；留空就显示角色介绍页"
                >
                  <Textarea
                    value={draft.greeting}
                    onChange={(e) => patch({ greeting: e.target.value })}
                    className="min-h-[116px] text-[12.5px] leading-relaxed"
                    placeholder={"（她抬眼，把伞往你那边偏了偏。）\n\n「这么大的雨，站这儿等人？」"}
                  />
                </Field>
                {draft.greeting.trim() && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11.5px]"
                    onClick={async () => {
                      await save();
                      await newSession(draft.id);
                    }}
                    leading={<Plus size={12} />}
                  >
                    保存并新建开场会话
                  </Button>
                )}
              </div>

              <Field
                label="系统提示词"
                hint="支持 {{char}} / {{user}}。写完就是上下文编排里「角色系统提示」块的内容"
              >
                <Textarea
                  value={draft.systemPrompt}
                  onChange={(e) => patch({ systemPrompt: e.target.value })}
                  className="min-h-[220px] text-[12.5px] leading-relaxed"
                  placeholder="你是……"
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
                        await removeCharacter(draft.id);
                        setConfirmDelete(false);
                        openDrawer(null);
                      }}
                    >
                      确认删除角色（含会话）
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
                    删除角色
                  </Button>
                )}
              </div>
            </div>
          )}

          {tab === "context" && (
            <ContextEditor
              character={draft}
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
                    开启后，回复会按画布的顺序来写。不想用就关掉，回到普通对话。
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

          {tab === "script" && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-surface-2 p-inset-sm text-[11.5px] leading-relaxed text-fg-muted">
                这是每次生成前运行的<span className="text-fg">前置脚本</span>：可以读取装配后的
                messages，改写后返回 <code className="rounded bg-surface-3 px-1 font-mono text-[11px]">{`{ messages }`}</code>
                ，即可影响最终请求。工作流中的「脚本」节点则在编排内单独执行。
              </div>
              <ScriptEditor
                code={draft.script}
                onChange={(script) => patch({ script })}
                character={draft}
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
              {character && dirty && (
                <Button variant="ghost" size="sm" onClick={() => setDraft({ ...character })}>
                  还原
                </Button>
              )}
              <Button variant="primary" size="sm" onClick={save} disabled={!dirty || saving}>
                保存角色卡
              </Button>
            </div>
          </div>
        </div>
      </Drawer>

      <WorkflowEditor
        open={workflowOpen}
        workflow={draft.workflow}
        character={draft}
        messages={messages}
        userName={userName}
        onClose={() => setWorkflowOpen(false)}
        onChange={(workflow) => patch({ workflow })}
      />
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
        点一下就能填入。「标签」是按钮上的字，「内容」是实际发出去的文本。
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
    </div>
  );
}
