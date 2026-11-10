import type { AppSettings, ModelConfig, ModelProfile } from "./types";
import { uid } from "./utils";

export const DEFAULT_PARAMS = `{
  "temperature": 0.85,
  "top_p": 0.95,
  "max_tokens": 1024,
  "frequency_penalty": 0.2,
  "presence_penalty": 0.2
}`;

/** 新建一条模型档案，缺省值按 OpenAI 兼容接口给 */
export function createProfile(patch: Partial<ModelProfile> = {}): ModelProfile {
  const model = typeof patch.model === "string" && patch.model.trim() ? patch.model.trim() : "gpt-4o-mini";
  return {
    id: patch.id?.trim() || uid("model"),
    name: patch.name?.trim() || model,
    baseUrl: typeof patch.baseUrl === "string" ? patch.baseUrl : "https://api.openai.com/v1",
    apiKey: typeof patch.apiKey === "string" ? patch.apiKey : "",
    model,
    params: typeof patch.params === "string" && patch.params.trim() ? patch.params : DEFAULT_PARAMS,
  };
}

export const DEFAULT_PROFILE: ModelProfile = createProfile({
  id: "model-default",
  name: "OpenAI",
  model: "gpt-4o-mini",
});

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "light",
  accent: "violet",
  userName: "你",
  models: [{ ...DEFAULT_PROFILE }],
  activeModelId: DEFAULT_PROFILE.id,
  scriptTimeoutMs: 5000,
  stream: true,
  enterToSend: true,
  showTokenEstimate: true,
};

export function normalizeBaseUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

/** 拼接 chat completions 端点，兼容用户直接粘贴完整端点的情况 */
export function completionsUrl(baseUrl: string): string {
  const u = normalizeBaseUrl(baseUrl);
  if (/\/chat\/completions$/i.test(u)) return u;
  return `${u}/chat/completions`;
}

/** 档案的主机名，用于列表里的一行摘要 */
export function profileHost(config: { baseUrl: string }): string {
  const u = normalizeBaseUrl(config.baseUrl);
  if (!u) return "未填 Base URL";
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
 * 兼容旧版单模型设置（`settings.model`）并补齐缺字段：
 * 旧结构一律迁移成一条档案，且保证至少有一条、activeModelId 指向存在的档案。
 */
export function normalizeSettings(raw: unknown): AppSettings {
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<AppSettings> & {
    model?: Partial<ModelProfile>;
  };
  const { model: legacyModel, models: rawModels, activeModelId: rawActiveId, ...rest } = input;

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

  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    models,
    activeModelId,
  };
}

/**
 * 解析当前实际生效的模型参数 —— 全局只有一份「当前档案」，
 * 角色卡不再做任何级别的模型绑定。
 */
export function resolveModelConfig(settings: AppSettings): ModelConfig {
  const base = activeProfile(settings);
  return {
    baseUrl: base.baseUrl,
    apiKey: base.apiKey,
    model: base.model,
    params: base.params,
  };
}
