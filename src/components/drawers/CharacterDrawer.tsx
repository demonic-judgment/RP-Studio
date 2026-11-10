import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Maximize2,
  Plus,
  Save,
  Trash2,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useStore } from "../../lib/store";
import { validateWorkflow } from "../../lib/workflow";
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

export function CharacterDrawer() {
  const open = useStore((s) => s.drawer === "character");
  const openDrawer = useStore((s) => s.openDrawer);
  const character = useStore((s) =>
    s.characters.find((c) => c.id === s.activeCharacterId) ?? null,
  );
  const messages = useStore((s) => s.messages);
  const settings = useStore((s) => s.settings);
  const saveCharacter = useStore((s) => s.saveCharacter);
  const removeCharacter = useStore((s) => s.removeCharacter);
  const newSession = useStore((s) => s.newSession);

  const [draft, setDraft] = useState<Character | null>(character);
  const [tab, setTab] = useState<TabId>("basic");
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && character) {
      setDraft({ ...character });
      setConfirmDelete(false);
    }
  }, [open, character?.id, character?.updatedAt]);

  const dirty = useMemo(() => {
    if (!draft || !character) return false;
    return JSON.stringify(draft) !== JSON.stringify(character);
  }, [draft, character]);

  if (!draft) return null;

  const patch = (value: Partial<Character>) => setDraft({ ...draft, ...value });

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
        systemPrompt: draft.systemPrompt,
        contextBlocks: draft.contextBlocks,
        quickPhrases: draft.quickPhrases,
        workflow: draft.workflow,
        script: draft.script,
        modelOverride: draft.modelOverride,
      });
    } finally {
      setSaving(false);
    }
  };

  const workflowErrors = validateWorkflow(draft.workflow);

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

              <div className="rounded-2xl bg-surface-2 p-inset-sm">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium text-fg">初始消息</p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-subtle">
                      新建会话时自动写入的第一条角色消息，可直接开始对话。
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-surface px-inset-pill py-1 text-[10.5px] tabular-nums text-fg-subtle">
                    {draft.greeting.trim().length} 字
                  </span>
                </div>
                <Textarea
                  value={draft.greeting}
                  onChange={(e) => patch({ greeting: e.target.value })}
                  className="min-h-[116px] bg-surface text-[12.5px] leading-relaxed"
                  placeholder={"（她抬眼，把伞往你那边偏了偏。）\n\n「这么大的雨，站这儿等人？」"}
                />
                <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">
                  支持 <code className="rounded bg-surface-3 px-1 font-mono text-[10.5px]">{"{{char}}"}</code>{" "}
                  <code className="rounded bg-surface-3 px-1 font-mono text-[10.5px]">{"{{user}}"}</code>；留空则新会话显示角色介绍页。已存在的会话不会补写。
                </p>
                {draft.greeting.trim() && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1.5 h-7 px-2 text-[11.5px]"
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
                hint="支持 {{char}} / {{user}} 变量；这是上下文编排中「角色系统提示」块的内容"
              >
                <Textarea
                  value={draft.systemPrompt}
                  onChange={(e) => patch({ systemPrompt: e.target.value })}
                  className="min-h-[220px] text-[12.5px] leading-relaxed"
                  placeholder="你是……"
                />
              </Field>

              <div className="rounded-2xl border border-line">
                <button
                  onClick={() => setModelOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left"
                >
                  <span>
                    <span className="block text-[12.5px] font-medium text-fg">角色级模型覆盖</span>
                    <span className="block text-[11px] text-fg-subtle">
                      {Object.values(draft.modelOverride ?? {}).filter(Boolean).length > 0
                        ? "已设置，留空的字段仍继承全局"
                        : "未设置，使用全局模型配置"}
                    </span>
                  </span>
                  <ChevronDown
                    size={14}
                    className={cn("text-fg-subtle transition-transform", modelOpen && "rotate-180")}
                  />
                </button>
                {modelOpen && (
                  <div className="space-y-3 border-t border-line px-3 py-3">
                    <Field label="Base URL">
                      <Input
                        value={draft.modelOverride?.baseUrl ?? ""}
                        onChange={(e) =>
                          patch({ modelOverride: { ...draft.modelOverride, baseUrl: e.target.value } })
                        }
                        placeholder={settings.model.baseUrl || "继承全局"}
                        spellCheck={false}
                      />
                    </Field>
                    <Field label="模型名称">
                      <Input
                        value={draft.modelOverride?.model ?? ""}
                        onChange={(e) =>
                          patch({ modelOverride: { ...draft.modelOverride, model: e.target.value } })
                        }
                        placeholder={settings.model.model || "继承全局"}
                        spellCheck={false}
                      />
                    </Field>
                    <Field label="API Key">
                      <Input
                        type="password"
                        value={draft.modelOverride?.apiKey ?? ""}
                        onChange={(e) =>
                          patch({ modelOverride: { ...draft.modelOverride, apiKey: e.target.value } })
                        }
                        placeholder="继承全局"
                        spellCheck={false}
                      />
                    </Field>
                    <Field label="参数 JSON 覆盖" hint="与全局参数浅合并">
                      <Textarea
                        value={draft.modelOverride?.params ?? ""}
                        onChange={(e) =>
                          patch({ modelOverride: { ...draft.modelOverride, params: e.target.value } })
                        }
                        placeholder='{"temperature": 1.1}'
                        className="min-h-[80px] font-mono text-[12px]"
                        spellCheck={false}
                      />
                    </Field>
                  </div>
                )}
              </div>

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
              userName={settings.userName}
            />
          )}

          {tab === "workflow" && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 rounded-2xl bg-surface-2 p-inset-sm">
                <div>
                  <p className="text-[12.5px] font-medium text-fg">启用工作流</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-subtle">
                    开启后，生成回复时先按画布编排执行，再写入会话。
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
                userName={settings.userName}
                timeoutMs={settings.scriptTimeoutMs}
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
        userName={settings.userName}
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
        快捷语显示在输入框上方，点击即可填入。「标签」用于按钮，「内容」是实际发送的文本。
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
