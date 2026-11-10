import { useEffect, useRef, useState } from "react";
import {
  Check,
  Database,
  Download,
  Eye,
  EyeOff,
  Palette,
  Plug,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useStore } from "../../lib/store";
import { ACCENT_PRESETS } from "../../lib/theme";
import { DEFAULT_MODEL, DEFAULT_PARAMS } from "../../lib/settings";
import { chatCompletion } from "../../lib/llm";
import { formatBytes, safeJsonParse } from "../../lib/utils";
import type { ThemeMode } from "../../lib/types";
import { Drawer, DrawerHeader } from "../ui/Drawer";
import { Tabs, Segmented, Pill } from "../ui/Tabs";
import { Button, IconButton } from "../ui/Button";
import { Field, Input, Textarea, Switch, Slider } from "../ui/Form";

type TabId = "theme" | "model" | "data";

export function SettingsDrawer() {
  const open = useStore((s) => s.drawer === "settings");
  const openDrawer = useStore((s) => s.openDrawer);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const exportData = useStore((s) => s.exportData);
  const importData = useStore((s) => s.importData);
  const clearAll = useStore((s) => s.clearAll);
  const refreshStats = useStore((s) => s.refreshStats);
  const toast = useStore((s) => s.toast);

  const [tab, setTab] = useState<TabId>("theme");
  const [modelDraft, setModelDraft] = useState(settings.model);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [stats, setStats] = useState({ characters: 0, sessions: 0, messages: 0 });
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setModelDraft(settings.model);
    void refreshStats().then(setStats);
    if (navigator.storage?.estimate) {
      void navigator.storage
        .estimate()
        .then((est) => setUsage({ usage: est.usage ?? 0, quota: est.quota ?? 0 }))
        .catch(() => setUsage(null));
    }
  }, [open, refreshStats, settings.model]);

  const paramsCheck = safeJsonParse<Record<string, unknown>>(modelDraft.params);
  const modelDirty = JSON.stringify(modelDraft) !== JSON.stringify(settings.model);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await chatCompletion({
        config: { ...modelDraft, params: JSON.stringify({ max_tokens: 24 }) },
        messages: [{ role: "user", content: "回复两个字：可用" }],
        stream: false,
      });
      setTestResult({ ok: true, text: result.content.slice(0, 80) || "连接成功（空回复）" });
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleImport = async (file: File) => {
    if (!window.confirm("导入会覆盖当前浏览器里的全部角色、会话与设置，且无法撤销。确定继续？")) {
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await importData(parsed);
    } catch (err) {
      toast({
        title: "导入失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
  };

  return (
    <Drawer open={open} onClose={() => openDrawer(null)} side="right" ariaLabel="设置" className="w-[min(420px,100vw)]">
      <DrawerHeader title="设置" subtitle="主题、模型与本地数据" onClose={() => openDrawer(null)} />

      <div className="border-b border-line px-3 py-2">
        <Tabs<TabId>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "theme", label: "主题", icon: <Palette size={14} /> },
            { id: "model", label: "模型", icon: <SlidersHorizontal size={14} /> },
            { id: "data", label: "数据", icon: <Database size={14} /> },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {tab === "theme" && (
          <div className="space-y-6">
            <Field label="外观模式">
              <Segmented<ThemeMode>
                value={settings.theme}
                onChange={(theme) => void setSettings({ theme })}
                options={[
                  { id: "light", label: "浅色" },
                  { id: "dark", label: "深色" },
                  { id: "system", label: "跟随系统" },
                ]}
              />
            </Field>

            <div>
              <p className="mb-2 text-[12.5px] font-medium text-fg-muted">强调色</p>
              <div className="grid grid-cols-3 gap-2">
                {ACCENT_PRESETS.map((preset) => {
                  const active = settings.accent === preset.id;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => void setSettings({ accent: preset.id })}
                      className={`flex items-center gap-1.5 rounded-xl px-inset-md py-2.5 text-left transition-all ${
                        active
                          ? "bg-primary-container"
                          : "bg-surface-2 hover:bg-surface-3"
                      }`}
                    >
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                        style={{ background: preset.hex }}
                      >
                        {active && <Check size={13} className="text-white" />}
                      </span>
                      <span className="truncate text-[11.5px] text-fg-muted">{preset.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl bg-surface-2 p-inset-sm">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
                预览
              </p>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface text-[13px]">
                    🎭
                  </span>
                  <div className="rounded-2xl rounded-tl-md bg-surface px-inset-sm py-2.5 text-[12.5px] leading-relaxed text-fg shadow-soft">
                    这是一段角色回复的示例文本，用以确认强调色与排版。
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="rounded-2xl rounded-br-md bg-[var(--bubble-user)] px-inset-sm py-2.5 text-[12.5px] text-fg shadow-bubble">
                    明白了，继续。
                  </div>
                </div>
              </div>
            </div>

            <Field label="你的称呼" hint="用于 {{user}} 变量与消息署名">
              <Input
                value={settings.userName}
                onChange={(e) => void setSettings({ userName: e.target.value })}
                placeholder="你"
              />
            </Field>
          </div>
        )}

        {tab === "model" && (
          <div className="space-y-5">
            <div className="rounded-2xl bg-surface-2 p-inset-sm text-[11.5px] leading-relaxed text-fg-muted">
              使用 OpenAI 兼容接口。<span className="text-fg">Base URL、Key、模型名分开填写</span>，
              其余参数（temperature、top_p、max_tokens、response_format…）在下方以 JSON 透传，不做任何裁剪。
            </div>

            <Field label="Base URL" hint="例如 https://api.openai.com/v1 或你的中转地址">
              <Input
                value={modelDraft.baseUrl}
                onChange={(e) => setModelDraft({ ...modelDraft, baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                spellCheck={false}
              />
            </Field>

            <Field label="API Key" hint="仅保存在本机 PGlite，不会上传">
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={modelDraft.apiKey}
                  onChange={(e) => setModelDraft({ ...modelDraft, apiKey: e.target.value })}
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

            <Field label="模型名称">
              <Input
                value={modelDraft.model}
                onChange={(e) => setModelDraft({ ...modelDraft, model: e.target.value })}
                placeholder="gpt-4o-mini"
                spellCheck={false}
              />
            </Field>

            <Field
              label="额外参数（JSON 透传）"
              error={paramsCheck.ok ? undefined : `JSON 无效：${paramsCheck.error}`}
              hint={paramsCheck.ok ? "会展开合并进请求体；model / messages / stream 由应用控制" : undefined}
              action={
                <button
                  type="button"
                  onClick={() => setModelDraft({ ...modelDraft, params: DEFAULT_PARAMS })}
                  className="text-[11px] text-fg-subtle transition-colors hover:text-primary"
                >
                  恢复默认
                </button>
              }
            >
              <Textarea
                value={modelDraft.params}
                onChange={(e) => setModelDraft({ ...modelDraft, params: e.target.value })}
                spellCheck={false}
                className="min-h-[150px] font-mono text-[12px] leading-relaxed"
              />
            </Field>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={testConnection}
                disabled={testing || !paramsCheck.ok}
                leading={<Plug size={13} />}
              >
                {testing ? "测试中…" : "测试连接"}
              </Button>
              <Button
                variant={modelDirty ? "primary" : "ghost"}
                size="sm"
                disabled={!modelDirty || !paramsCheck.ok}
                onClick={() => {
                  void setSettings({ model: modelDraft });
                  toast({ title: "模型配置已保存", variant: "success" });
                }}
              >
                保存配置
              </Button>
              {modelDirty && <Pill tone="muted">未保存</Pill>}
            </div>

            {testResult && (
              <div
                className={`rounded-xl px-inset-lg py-2.5 text-[12px] leading-relaxed ${
                  testResult.ok
                    ? "bg-success/10 text-fg-muted"
                    : "bg-danger/10 text-fg-muted"
                }`}
              >
                <p className={testResult.ok ? "font-medium text-success" : "font-medium text-danger"}>
                  {testResult.ok ? "连接成功" : "连接失败"}
                </p>
                <p className="mt-0.5 break-words">{testResult.text}</p>
              </div>
            )}

            <div className="space-y-3 rounded-2xl bg-surface-2 p-inset-sm">
              <Row label="流式输出" hint="逐字返回，实时渲染">
                <Switch label="流式输出" checked={settings.stream} onChange={(stream) => void setSettings({ stream })} />
              </Row>
              <Row label="Enter 发送" hint="关闭后用 ⌘/Ctrl+Enter">
                <Switch
                  label="Enter 发送"
                  checked={settings.enterToSend}
                  onChange={(enterToSend) => void setSettings({ enterToSend })}
                />
              </Row>
              <Row label="显示上下文估算" hint="在输入框右下角显示 token 粗估">
                <Switch
                  label="显示上下文估算"
                  checked={settings.showTokenEstimate}
                  onChange={(showTokenEstimate) => void setSettings({ showTokenEstimate })}
                />
              </Row>
              <div>
                <p className="mb-1.5 text-[12.5px] text-fg">脚本超时</p>
                <Slider
                  value={settings.scriptTimeoutMs}
                  min={1000}
                  max={20000}
                  step={500}
                  suffix="ms"
                  onChange={(scriptTimeoutMs) => void setSettings({ scriptTimeoutMs })}
                />
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              leading={<RotateCcw size={13} />}
              onClick={() => setModelDraft(DEFAULT_MODEL)}
            >
              恢复默认模型配置
            </Button>
          </div>
        )}

        {tab === "data" && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="角色" value={stats.characters} />
              <Stat label="会话" value={stats.sessions} />
              <Stat label="消息" value={stats.messages} />
            </div>

            {usage && (
              <Field label="浏览器存储占用" hint={`配额 ${formatBytes(usage.quota)}`}>
                <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(100, (usage.usage / Math.max(usage.quota, 1)) * 100)}%` }}
                  />
                </div>
                <p className="text-[11px] text-fg-subtle">{formatBytes(usage.usage)} 已使用</p>
              </Field>
            )}

            <div className="space-y-2 rounded-2xl border border-line p-inset-sm">
              <p className="text-[12.5px] font-medium text-fg">备份与恢复</p>
              <p className="text-[11.5px] leading-relaxed text-fg-subtle">
                导出包含全部角色卡、会话、消息与设置，可迁移到另一台设备。
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  leading={<Download size={13} />}
                  onClick={async () => {
                    const data = await exportData();
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `rp-studio-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 2000);
                    toast({ title: "已导出备份", variant: "success" });
                  }}
                >
                  导出 JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  leading={<Upload size={13} />}
                  onClick={() => fileRef.current?.click()}
                >
                  导入 JSON
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImport(file);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-2xl bg-danger/[0.08] p-inset-sm">
              <p className="text-[12.5px] font-medium text-danger">危险区域</p>
              <p className="text-[11.5px] leading-relaxed text-fg-muted">
                清空所有数据并恢复到初始示例角色，操作不可撤销。
              </p>
              {confirmClear ? (
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    variant="danger"
                    size="sm"
                    leading={<Trash2 size={13} />}
                    onClick={async () => {
                      await clearAll();
                      setConfirmClear(false);
                      setStats(await refreshStats());
                    }}
                  >
                    确认清空
                  </Button>
                  <Button variant="ghost" size="sm" leading={<X size={13} />} onClick={() => setConfirmClear(false)}>
                    取消
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-danger"
                  leading={<Trash2 size={13} />}
                  onClick={() => setConfirmClear(true)}
                >
                  清空数据
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12.5px] text-fg">{label}</p>
        {hint && <p className="text-[11px] text-fg-subtle">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface-2 px-inset-lg py-3">
      <p className="text-[10.5px] uppercase tracking-[0.1em] text-fg-subtle">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-fg">{value}</p>
    </div>
  );
}
