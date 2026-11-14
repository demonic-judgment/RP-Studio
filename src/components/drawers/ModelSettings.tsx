import { useState } from "react";
import { Eye, EyeOff, Plug, Plus, Trash2, X } from "lucide-react";
import { useStore } from "../../lib/store";
import {
  DEFAULT_ENDPOINT,
  DEFAULT_PARAMS,
  activeProfile,
  createProfile,
  endpointHost,
  looksLikeBaseUrl,
  normalizeEndpoint,
  paramModel,
} from "../../lib/settings";
import { chatCompletion } from "../../lib/llm";
import { cn, safeJsonParse } from "../../lib/utils";
import type { ModelProfile } from "../../lib/types";
import { Button, IconButton } from "../ui/Button";
import { Field, Input, Textarea } from "../ui/Form";
import { Modal } from "../ui/Modal";
import { Pill } from "../ui/Tabs";

type TestResult = { ok: boolean; text: string };

/** 测试连接时的参数：沿用档案参数，只把输出长度压到最小 */
function testParams(raw: string): string {
  const parsed = safeJsonParse<Record<string, unknown>>(raw || "{}");
  const base = parsed.ok && parsed.value && typeof parsed.value === "object" ? parsed.value : {};
  return JSON.stringify({ ...base, max_tokens: 24 });
}

/**
 * 设置抽屉的「模型」页签：列表负责切换当前档案与删除，
 * 点列表项弹窗编辑单条档案（新增也走同一个弹窗，保存才落库）。
 */
export function ModelSettings() {
  const settings = useStore((s) => s.settings);
  const saveModel = useStore((s) => s.saveModel);
  const removeModel = useStore((s) => s.removeModel);
  const toast = useStore((s) => s.toast);

  /** 非空即弹窗打开；新建档案此时尚未落库 */
  const [draft, setDraft] = useState<ModelProfile | null>(null);
  /** 打开弹窗那一刻的快照，用来判断是否真的有改动 */
  const [baseline, setBaseline] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  /** 列表里等待二次确认删除的档案 */
  const [removingId, setRemovingId] = useState<string | null>(null);

  const active = activeProfile(settings);
  const isNew = !!draft && !settings.models.some((m) => m.id === draft.id);
  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  const paramsCheck = safeJsonParse<Record<string, unknown>>(draft?.params ?? "{}");
  const draftModel = paramModel(draft?.params ?? "");
  /** 参数合法但没填 model：请求必失败，按错误处理 */
  const paramsError = !paramsCheck.ok
    ? `JSON 无效：${paramsCheck.error}`
    : draftModel
      ? undefined
      : "缺 model：填服务商给的模型名";
  const baseUrlWarning = !!draft && looksLikeBaseUrl(draft.endpoint);

  const openEditor = (profile: ModelProfile) => {
    setDraft({ ...profile });
    setBaseline(JSON.stringify(profile));
    setShowKey(false);
    setTestResult(null);
    setRemovingId(null);
  };

  const closeEditor = () => {
    if (dirty && !window.confirm("这条模型档案有未保存的修改，确定放弃？")) return;
    setDraft(null);
    setTestResult(null);
  };

  const handleAdd = () => {
    // 先给一份本地草稿，点保存才写进设置，取消即无痕
    openEditor(createProfile({ name: `模型 ${settings.models.length + 1}` }));
  };

  const handleSave = async () => {
    if (!draft) return;
    const model = paramModel(draft.params);
    await saveModel({
      ...draft,
      endpoint: normalizeEndpoint(draft.endpoint),
      name: draft.name.trim() || model || "未命名模型",
    });
    toast({ title: isNew ? "模型档案已添加" : "模型档案已保存", variant: "success" });
    setDraft(null);
    setTestResult(null);
  };

  const handleRemove = async (id: string) => {
    await removeModel(id);
    setRemovingId(null);
    toast({ title: "模型档案已删除", variant: "default" });
  };

  const testConnection = async () => {
    if (!draft) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await chatCompletion({
        config: {
          endpoint: normalizeEndpoint(draft.endpoint),
          apiKey: draft.apiKey,
          params: testParams(draft.params),
        },
        messages: [{ role: "user", content: "回复两个字：可用" }],
      });
      setTestResult({ ok: true, text: result.content.slice(0, 80) || "连接成功（空回复）" });
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-fg">模型档案</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-subtle">
            共 {settings.models.length} 条 · 当前使用「{active.name}」
          </p>
        </div>        <Button variant="outline" size="sm" leading={<Plus size={13} />} onClick={handleAdd}>
          新增
        </Button>
      </div>

      <div className="space-y-2">
        {settings.models.map((profile) => {
          const isActive = profile.id === settings.activeModelId;
          const missingKey = !profile.apiKey.trim();
          const model = paramModel(profile.params);

          if (removingId === profile.id) {
            return (
              <div
                key={profile.id}
                className="flex items-center justify-between gap-2 rounded-2xl bg-danger/[0.08] p-inset-sm"
              >
                <p className="min-w-0 text-[11.5px] leading-relaxed text-fg">
                  删除「{profile.name}」？
                  <span className="text-fg-subtle"> 无法撤销</span>
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="danger"
                    size="sm"
                    leading={<Trash2 size={13} />}
                    onClick={() => void handleRemove(profile.id)}
                  >
                    删除
                  </Button>
                  <IconButton label="取消删除" onClick={() => setRemovingId(null)}>
                    <X size={14} />
                  </IconButton>
                </div>
              </div>
            );
          }

          return (
            <div
              key={profile.id}
              className={cn(
                "flex items-center gap-1 rounded-2xl p-1 transition-colors",
                isActive ? "bg-primary-container" : "bg-surface-2 hover:bg-surface-3",
              )}
            >
              <button
                type="button"
                onClick={() => openEditor(profile)}
                aria-label={`编辑模型档案 ${profile.name}`}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-inset-sm py-2 text-left"
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold uppercase",
                    isActive
                      ? "bg-[var(--bg)]/55 text-on-primary-container"
                      : "bg-surface text-fg-muted",
                  )}
                >
                  {(profile.name.trim() || model || "?").slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-fg">{profile.name}</span>
                    {missingKey && (
                      <span className="shrink-0 rounded-full bg-warning/12 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                        缺 Key
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-fg-subtle">
                    {model || "缺 model"} · {endpointHost(profile)}
                  </span>
                </span>
              </button>

              <div className="flex shrink-0 items-center gap-1 pr-0.5">
                {isActive && (
                  <span className="px-inset-tight">
                    <Pill tone="default" className="bg-[var(--bg)]/55 text-fg-muted">
                      使用中
                    </Pill>
                  </span>
                )}
                <IconButton
                  label={
                    settings.models.length <= 1
                      ? "至少保留一条模型档案"
                      : `删除模型档案 ${profile.name}`
                  }
                  disabled={settings.models.length <= 1}
                  className="hover:text-danger disabled:opacity-30 disabled:hover:text-fg-subtle"
                  onClick={() => setRemovingId(profile.id)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl bg-surface-2 p-inset-sm text-[11.5px] leading-relaxed text-fg-muted">
        模型名填在参数的 model 里。用哪条档案在输入框左下角切换 —— 换档案不用改空间设置。
      </div>

      <Modal
        open={!!draft}
        onClose={closeEditor}
        title={isNew ? "新增模型档案" : "编辑模型档案"}
        subtitle={
          isNew
            ? "保存后才会出现在列表里"
            : draft?.id === settings.activeModelId
              ? "这条档案正在被使用"
              : undefined
        }
        footer={
          draft ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={testConnection}
                disabled={testing || !!paramsError || !draft.endpoint.trim()}
                leading={<Plug size={13} />}
              >
                {testing ? "测试中…" : "测试连接"}
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={closeEditor}>
                  取消
                </Button>
                <Button
                  variant={dirty ? "primary" : "ghost"}
                  size="sm"
                  disabled={!dirty || !!paramsError}
                  onClick={handleSave}
                >
                  保存
                </Button>
              </div>
            </>
          ) : null
        }
      >
        {draft && (
          <div className="space-y-4 pb-1">
            <Field label="名称" hint="仅用于界面区分，例如「官方」「中转 · 便宜」">
              <Input
                data-autofocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="官方 OpenAI"
              />
            </Field>

            <Field
              label="Endpoint"
              hint={
                baseUrlWarning ? (
                  <span className="text-warning">
                    看起来只填了 Base URL，请求会打到 {normalizeEndpoint(draft.endpoint)}；完整地址通常以
                    /chat/completions 结尾
                  </span>
                ) : (
                  "填完整地址，记得把 /chat/completions 也带上"
                )
              }
            >
              <Input
                value={draft.endpoint}
                onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })}
                placeholder={DEFAULT_ENDPOINT}
                spellCheck={false}
              />
            </Field>

            <Field label="API Key" hint="只存在本机，不会上传">
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  placeholder="sk-…"
                  className="pr-10"
                  spellCheck={false}
                />
                <IconButton
                  label={showKey ? "隐藏" : "显示"}
                  className="absolute right-1 top-1"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </IconButton>
              </div>
            </Field>

            <Field
              label="额外参数（JSON）"
              error={paramsError}
              hint="model 必填；stream 建议保持 true，其余照服务商文档加"
              action={
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, params: DEFAULT_PARAMS })}
                  className="text-[11px] text-fg-subtle transition-colors hover:text-primary"
                >
                  恢复默认
                </button>
              }
            >
              <Textarea
                value={draft.params}
                onChange={(e) => setDraft({ ...draft, params: e.target.value })}
                spellCheck={false}
                className="min-h-[180px] font-mono text-[12px] leading-relaxed"
              />
            </Field>

            {testResult && (
              <div
                className={`rounded-xl px-inset-lg py-2.5 text-[12px] leading-relaxed ${
                  testResult.ok ? "bg-success/10 text-fg-muted" : "bg-danger/10 text-fg-muted"
                }`}
              >
                <p
                  className={
                    testResult.ok ? "font-medium text-success" : "font-medium text-danger"
                  }
                >
                  {testResult.ok ? "连接成功" : "连接失败"}
                </p>
                <p className="mt-0.5 break-words">{testResult.text}</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
