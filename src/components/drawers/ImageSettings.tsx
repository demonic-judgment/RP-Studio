import { useState } from "react";
import { Eye, EyeOff, ImageIcon, Plus, Trash2, X } from "lucide-react";
import { useStore } from "../../lib/store";
import {
  DEFAULT_IMAGE_ENDPOINT,
  DEFAULT_IMAGE_GENERATE_ENDPOINT,
  DEFAULT_IMAGE_PARAMS,
  activeImageProfile,
  createImageProfile,
  endpointHost,
  imageEndpointFor,
  normalizeEndpoint,
  paramModel,
} from "../../lib/settings";
import { cn, safeJsonParse } from "../../lib/utils";
import type { ImageModelMode, ImageProfile } from "../../lib/types";
import { Button, IconButton } from "../ui/Button";
import { Field, Input, Switch, Textarea } from "../ui/Form";
import { Modal } from "../ui/Modal";
import { Pill, Segmented } from "../ui/Tabs";
import { ImagePromptEditor } from "../image/ImagePromptEditor";

/** 生图档案：一条 = 一个 endpoint + Key + 参数，默认图生图（multipart） */
export function ImageSettings() {
  const settings = useStore((s) => s.settings);
  const characters = useStore((s) => s.characters);
  const activeCharacterId = useStore((s) => s.activeCharacterId);
  const setSettings = useStore((s) => s.setSettings);
  const setImageEnabled = useStore((s) => s.setImageEnabled);
  const saveImageModel = useStore((s) => s.saveImageModel);
  const removeImageModel = useStore((s) => s.removeImageModel);
  const setActiveImageModel = useStore((s) => s.setActiveImageModel);
  const toast = useStore((s) => s.toast);

  const [draft, setDraft] = useState<ImageProfile | null>(null);
  const [baseline, setBaseline] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const character = characters.find((c) => c.id === activeCharacterId) ?? null;
  const active = activeImageProfile(settings);
  const isNew = !!draft && !settings.imageModels.some((m) => m.id === draft.id);
  const dirty = !!draft && JSON.stringify(draft) !== baseline;

  const paramsCheck = safeJsonParse<Record<string, unknown>>(draft?.params ?? "{}");
  const draftModel = paramModel(draft?.params ?? "");
  const paramsError = !paramsCheck.ok
    ? `JSON 无效：${paramsCheck.error}`
    : draftModel
      ? undefined
      : "参数里需要 model，它是请求体里的模型名";

  const openEditor = (profile: ImageProfile) => {
    setDraft({ ...profile });
    setBaseline(JSON.stringify(profile));
    setShowKey(false);
    setRemovingId(null);
  };

  const closeEditor = () => {
    if (dirty && !window.confirm("这条生图档案有未保存的修改，确定放弃？")) return;
    setDraft(null);
  };

  const changeMode = (mode: ImageModelMode) => {
    if (!draft) return;
    // 端点还停留在另一模式的默认值时顺手换过去，省得用户自己改
    const isDefaultEndpoint =
      draft.endpoint === DEFAULT_IMAGE_ENDPOINT || draft.endpoint === DEFAULT_IMAGE_GENERATE_ENDPOINT;
    setDraft({ ...draft, mode, endpoint: isDefaultEndpoint ? imageEndpointFor(mode) : draft.endpoint });
  };

  const handleSave = async () => {
    if (!draft) return;
    const model = paramModel(draft.params);
    await saveImageModel({
      ...draft,
      endpoint: normalizeEndpoint(draft.endpoint),
      name: draft.name.trim() || model || "未命名生图模型",
    });
    toast({ title: isNew ? "生图档案已添加" : "生图档案已保存", variant: "success" });
    setDraft(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 rounded-2xl bg-surface-2 p-inset-sm">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg">
            <ImageIcon size={14} className="text-primary" />
            图生图
          </p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-subtle">
            角色回复里返回的「生图提示词」会被摘出来，按下面的编排拼成 prompt，
            拿角色卡的三视图底图重新画（不叠加上一张的结果）。关闭后不生成图片、不显示悬浮画面；
            正文里的生图 JSON 仍然不会进气泡（要改原文点那条消息的「编辑原文」）。
            「返回 JSON」的 system 预设在各角色卡的「提示词编排」里，可改。
          </p>
        </div>
        <Switch
          label="图生图"
          checked={settings.imageEnabled}
          onChange={(imageEnabled) => void setImageEnabled(imageEnabled)}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium text-fg">生图模型</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-subtle">
              共 {settings.imageModels.length} 条 · 当前使用「{active.name}」
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            leading={<Plus size={13} />}
            onClick={() => openEditor(createImageProfile({ name: `生图 ${settings.imageModels.length + 1}` }))}
          >
            新增
          </Button>
        </div>

        <div className="space-y-2">
          {settings.imageModels.map((profile) => {
            const isActive = profile.id === settings.activeImageModelId;
            const model = paramModel(profile.params);

            if (removingId === profile.id) {
              return (
                <div
                  key={profile.id}
                  className="flex items-center justify-between gap-2 rounded-2xl bg-danger/[0.08] p-inset-sm"
                >
                  <p className="min-w-0 text-[11.5px] leading-relaxed text-fg">
                    删除「{profile.name}」？<span className="text-fg-subtle"> 无法撤销</span>
                  </p>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="danger"
                      size="sm"
                      leading={<Trash2 size={13} />}
                      onClick={async () => {
                        await removeImageModel(profile.id);
                        setRemovingId(null);
                      }}
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
                  aria-label={`编辑生图档案 ${profile.name}`}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-inset-sm py-2 text-left"
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold uppercase",
                      isActive ? "bg-[var(--bg)]/55 text-on-primary-container" : "bg-surface text-fg-muted",
                    )}
                  >
                    {(profile.name.trim() || model || "?").slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-fg">{profile.name}</span>
                      {profile.mode === "generate" && (
                        <span className="shrink-0 rounded-full bg-warning/12 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                          文生图
                        </span>
                      )}
                      {!profile.apiKey.trim() && (
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
                  {isActive ? (
                    <span className="px-inset-tight">
                      <Pill tone="default" className="bg-[var(--bg)]/55 text-fg-muted">
                        使用中
                      </Pill>
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11.5px]"
                      onClick={() => void setActiveImageModel(profile.id)}
                    >
                      使用
                    </Button>
                  )}
                  <IconButton
                    label={
                      settings.imageModels.length <= 1 ? "至少保留一条生图档案" : `删除生图档案 ${profile.name}`
                    }
                    disabled={settings.imageModels.length <= 1}
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
      </div>

      <div className="rounded-2xl bg-surface-2 p-inset-sm">
        <p className="mb-3 text-[12.5px] font-medium text-fg">生图提示词编排</p>
        <ImagePromptEditor
          blocks={settings.imagePromptBlocks}
          onChange={(imagePromptBlocks) => void setSettings({ imagePromptBlocks })}
          characterName={character?.name}
          userName={settings.userName}
        />
      </div>

      <p className="text-[11.5px] leading-relaxed text-fg-subtle">
        比例固定 2:3 竖图（默认 size 1024x1536，可改参数）。返回的图会先居中裁成 2:3、再压成
        800x1200 的 WebP 存本地，所以接口给什么比例都能对齐画面框。图生图用 multipart 把三视图参考图
        作为文件上传（一张用 image，多张用 image[]；网关不认多图时会自动拼成一张三视图重试），
        其余参数逐字段进表单；文生图整体 JSON 作为请求体。
        没有参考图时图生图会直接报错——先在角色卡里上传至少一张三视图底图。
      </p>

      <Modal
        open={!!draft}
        onClose={closeEditor}
        title={isNew ? "新增生图档案" : "编辑生图档案"}
        subtitle={isNew ? "保存后才会出现在列表里" : "图生图默认走 /v1/images/edits"}
        footer={
          draft ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft({ ...draft, endpoint: imageEndpointFor(draft.mode) })}
              >
                用默认地址
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={closeEditor}>
                  取消
                </Button>
                <Button
                  variant={dirty ? "primary" : "ghost"}
                  size="sm"
                  disabled={!dirty || !!paramsError || !draft.endpoint.trim()}
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
            <Field label="请求方式" hint="图生图（推荐）需要底图；文生图不带底图，画面会跳脱">
              <Segmented<ImageModelMode>
                value={draft.mode}
                onChange={changeMode}
                options={[
                  { id: "edit", label: "图生图" },
                  { id: "generate", label: "文生图" },
                ]}
              />
            </Field>

            <Field label="名称" hint="仅用于界面区分">
              <Input
                data-autofocus
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="OpenAI 图像"
              />
            </Field>

            <Field label="Endpoint" hint="完整地址，原样请求；图生图通常以 /images/edits 结尾">
              <Input
                value={draft.endpoint}
                onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })}
                placeholder={DEFAULT_IMAGE_ENDPOINT}
                spellCheck={false}
              />
            </Field>

            <Field label="API Key" hint="留空则不带 Authorization 头">
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={draft.apiKey}
                  onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
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
              label="参数（请求体 JSON）"
              error={paramsError}
              hint="multipart 时逐字段进表单，文生图整体作为请求体；默认 model + size 1024x1536 + n"
              action={
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, params: DEFAULT_IMAGE_PARAMS })}
                  className="text-[11px] text-fg-subtle transition-colors hover:text-primary"
                >
                  恢复默认
                </button>
              }
            >
              <Textarea
                value={draft.params}
                onChange={(event) => setDraft({ ...draft, params: event.target.value })}
                spellCheck={false}
                className="min-h-[140px] font-mono text-[12px] leading-relaxed"
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
