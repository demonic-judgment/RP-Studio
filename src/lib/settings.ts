import type { AppSettings, BackgroundConfig, ModelConfig, ModelProfile } from "./types";
import { safeJsonParse, uid } from "./utils";

/**
 * 新建档案时预置的四个参数：model 必填、stream 固定走流式、
 * temperature / top_p 按常见写作场景给默认值。其余参数由用户自行加进 JSON。
 */
const PARAM_DEFAULTS = {
  model: "gpt-4o-mini",
  stream: true,
  temperature: 0.85,
  top_p: 0.95,
};

export const DEFAULT_PARAMS = JSON.stringify(PARAM_DEFAULTS, null, 2);
export const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

/** 只做规范化：补协议、去尾斜杠。路径不做任何拼接，endpoint 由用户完整填写 */
export function normalizeEndpoint(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

/** 旧版 baseUrl → 完整 endpoint：缺 chat/completions 路径时补上，仅用于数据迁移 */
export function legacyBaseUrlToEndpoint(baseUrl: string): string {
  const u = normalizeEndpoint(baseUrl);
  if (!u) return "";
  if (/\/chat\/completions$/i.test(u)) return u;
  return `${u}/chat/completions`;
}

/**
 * 看起来只填了 Base URL（没有接口路径，或只到 /v1）。
 * 仅用于界面提示，不阻止请求——非标准网关的路径由用户自己决定。
 */
export function looksLikeBaseUrl(endpoint: string): boolean {
  const u = normalizeEndpoint(endpoint);
  if (!u) return false;
  try {
    const path = new URL(u).pathname.replace(/\/+$/, "");
    return path === "" || /^\/v\d+(\.\d+)?$/i.test(path);
  } catch {
    return false;
  }
}

/** 取参数里的 model，用于列表展示与消息 meta */
export function paramModel(params: string): string {
  const parsed = safeJsonParse<Record<string, unknown>>(params || "{}");
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return "";
  const model = (parsed.value as Record<string, unknown>).model;
  return typeof model === "string" ? model.trim() : "";
}

/** 补齐参数：保留用户写的键，缺 model 用旧字段兜底，缺 stream 默认 true */
function normalizeParams(raw: string | undefined, legacyModel?: string): string {
  const parsed = raw?.trim() ? safeJsonParse<Record<string, unknown>>(raw) : null;
  const value =
    parsed && parsed.ok && parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
      ? { ...(parsed.value as Record<string, unknown>) }
      : { ...PARAM_DEFAULTS };
  if (typeof value.model !== "string" || !value.model.trim()) {
    value.model = legacyModel?.trim() || PARAM_DEFAULTS.model;
  }
  if (typeof value.stream !== "boolean") value.stream = true;
  return JSON.stringify(value, null, 2);
}

/** 新建一条模型档案，缺省值按 OpenAI 兼容接口给 */
export function createProfile(
  patch: Partial<ModelProfile> & { baseUrl?: string; model?: string } = {},
): ModelProfile {
  const params = normalizeParams(patch.params, patch.model);
  const rawEndpoint =
    typeof patch.endpoint === "string" && patch.endpoint.trim()
      ? patch.endpoint
      : typeof patch.baseUrl === "string"
        ? legacyBaseUrlToEndpoint(patch.baseUrl)
        : DEFAULT_ENDPOINT;
  return {
    id: patch.id?.trim() || uid("model"),
    name: patch.name?.trim() || paramModel(params) || "未命名模型",
    endpoint: normalizeEndpoint(rawEndpoint) || DEFAULT_ENDPOINT,
    apiKey: typeof patch.apiKey === "string" ? patch.apiKey : "",
    params,
  };
}

export const DEFAULT_PROFILE: ModelProfile = createProfile({
  id: "model-default",
  name: "OpenAI",
});

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "light",
  accent: "violet",
  userName: "你",
  models: [{ ...DEFAULT_PROFILE }],
  activeModelId: DEFAULT_PROFILE.id,
  scriptTimeoutMs: 5000,
  enterToSend: true,
  showTokenEstimate: true,
};

/** endpoint 的主机名，用于列表里的一行摘要 */
export function endpointHost(config: { endpoint: string }): string {
  const u = normalizeEndpoint(config.endpoint);
  if (!u) return "未填 endpoint";
  try {
    return new URL(u).host;
  } catch {
    return u.replace(/^https?:\/\//i, "").split("/")[0] || u;
  }
}

export function activeProfile(settings: AppSettings): ModelProfile {
  return (
    settings.models.find((m) => m.id === settings.activeModelId) ??
    settings.models[0] ??
    DEFAULT_PROFILE
  );
}

/**
 * 兼容旧版单模型设置（`settings.model`）与旧版 baseUrl 档案，并补齐缺字段：
 * 旧结构一律迁移成一条档案，且保证至少有一条、activeModelId 指向存在的档案。
 * 旧版全局「流式输出」开关已移除，历史数据里的 `stream` 键在归一化时丢弃。
 */
export function normalizeSettings(raw: unknown): AppSettings {
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<AppSettings> & {
    model?: Partial<ModelProfile>;
    stream?: boolean;
  };
  const legacyModel = input.model;
  const rawModels = input.models;
  const rawActiveId = input.activeModelId;
  const rest: Partial<AppSettings> & { model?: Partial<ModelProfile>; stream?: boolean } = { ...input };
  delete rest.model;
  delete rest.stream;
  delete rest.models;
  delete rest.activeModelId;

  const seen = new Set<string>();
  const models: ModelProfile[] = [];
  const push = (candidate: Partial<ModelProfile> | undefined) => {
    if (!candidate || typeof candidate !== "object") return;
    // 旧数据可能没有任何内容，只有空对象：仍视为一条可编辑档案
    const profile = createProfile(candidate);
    let id = profile.id;
    while (seen.has(id)) id = uid("model");
    seen.add(id);
    models.push({ ...profile, id });
  };

  if (Array.isArray(rawModels)) rawModels.forEach((m) => push(m as Partial<ModelProfile>));
  if (models.length === 0) {
    // 真正的新库：直接沿用默认档案；只有旧版单模型设置才需要迁移
    if (legacyModel && typeof legacyModel === "object") {
      push(legacyModel);
    } else {
      models.push({ ...DEFAULT_PROFILE });
      seen.add(DEFAULT_PROFILE.id);
    }
  }

  const activeModelId =
    typeof rawActiveId === "string" && models.some((m) => m.id === rawActiveId)
      ? rawActiveId
      : models[0].id;

  // 背景图不算「普通设置」：非法值一律当没设置，别把坏 url 带进渲染层
  const background = normalizeBackground((rest as { background?: unknown }).background);
  delete rest.background;

  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    models,
    activeModelId,
    background,
  };
}

/**
 * 背景图只接受 http(s)、blob 或图片 data URL：`url(...)` 是直接拼进 CSS 的，
 * 顺手把引号/反斜杠去掉，免得半截坏值把整条背景规则弄挂。
 */
export function normalizeBackground(raw: unknown): BackgroundConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const input = raw as Partial<BackgroundConfig>;
  const url = typeof input.url === "string" ? input.url.replace(/["'\\\r\n]/g, "").trim() : "";
  if (!/^(https?:\/\/|blob:|data:image\/)/i.test(url)) return undefined;
  const clamp = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  return {
    url,
    opacity: clamp(input.opacity, 0.1, 1, 1),
    blur: clamp(input.blur, 0, 24, 0),
  };
}

/**
 * 解析当前实际生效的模型参数 —— 全局只有一份「当前档案」，
 * 角色卡不再做任何级别的模型绑定。
 */
export function resolveModelConfig(settings: AppSettings): ModelConfig {
  const base = activeProfile(settings);
  return {
    endpoint: base.endpoint,
    apiKey: base.apiKey,
    params: base.params,
  };
}
