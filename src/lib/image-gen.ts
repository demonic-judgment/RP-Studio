import type { ImageProfile } from "./types";
import { normalizeEndpoint } from "./settings";
import { safeJsonParse } from "./utils";
import { composeReferenceSheet, dataUrlToBlob, prepareGeneratedImage } from "./image";

/**
 * 绘图请求：默认走 OpenAI 兼容的图生图（multipart 打 /v1/images/edits，
 * 三视图参考图作为文件上传）。文生图只是没有底图时的退路，走 JSON /v1/images/generations。
 *
 * 参数 JSON 是「请求体」的同义词：JSON 模式整体作为 body，multipart 模式逐字段
 * 写进表单（对象/数组序列化成 JSON 字符串）。应用只额外注入 prompt 与 image。
 */

export interface ImageRequest {
  config: ImageProfile;
  prompt: string;
  /**
   * 三视图参考图（data URL 或 http(s) 链接），顺序即 正 / 侧 / 背。
   * 文生图可为空；图生图至少要有一张。
   */
  baseImages?: string[];
  signal?: AbortSignal;
}

export interface ImageResult {
  /** data URL 或外链 */
  url: string;
  model: string;
}

type ImagePayload = {
  data?: { b64_json?: string; url?: string }[] | string;
  images?: (string | { url?: string; b64_json?: string })[];
  output?: unknown;
  url?: string;
  b64_json?: string;
  error?: { message?: string } | string;
  message?: string;
};

/** base64 头部判断真实格式：网关常把 jpeg 当 png 声明 */
function sniffMime(base64: string): string {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBOR")) return "image/png";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  if (base64.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

function asImageUrl(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    const text = value.trim();
    if (/^(data:image\/|https?:\/\/|blob:)/i.test(text)) return text;
    // 只有裸 base64 的情况
    if (text.length > 128 && !/[\s:]/.test(text.slice(0, 64))) {
      return `data:${sniffMime(text)};base64,${text}`;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    const record = value as { url?: unknown; b64_json?: unknown };
    if (typeof record.b64_json === "string" && record.b64_json.trim()) {
      return `data:${sniffMime(record.b64_json)};base64,${record.b64_json}`;
    }
    if (typeof record.url === "string" && record.url.trim()) return record.url.trim();
  }
  return undefined;
}

/** 各家网关的返回形状不一样，挨个试：data[].url / data[].b64_json / images[] / url */
function pickImageUrl(payload: ImagePayload): string | undefined {
  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      const url = asImageUrl(item);
      if (url) return url;
    }
  } else if (typeof payload.data === "string") {
    const url = asImageUrl(payload.data);
    if (url) return url;
  }
  if (Array.isArray(payload.images)) {
    for (const item of payload.images) {
      const url = asImageUrl(item);
      if (url) return url;
    }
  }
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      const url = asImageUrl(item);
      if (url) return url;
    }
  }
  return asImageUrl({ url: payload.url, b64_json: payload.b64_json });
}

function errorMessage(payload: ImagePayload, fallback: string): string {
  const err = payload.error;
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object" && typeof err.message === "string") return err.message;
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  return fallback;
}

function parseParams(raw: string): Record<string, unknown> {
  const parsed = safeJsonParse<Record<string, unknown>>(raw || "{}");
  if (!parsed.ok) throw new Error(`生图参数不是合法 JSON：${parsed.error}`);
  const value = parsed.value;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readErrorMessage(text: string, status: number): string {
  let detail = text;
  try {
    const json = JSON.parse(text) as ImagePayload;
    detail = errorMessage(json, text);
  } catch {
    /* 网关可能直接甩一段 HTML，截断就行 */
  }
  return `生图失败 ${status}${detail ? ` · ${detail.slice(0, 300)}` : ""}`;
}

/**
 * 三视图是固定的一组图：解出来的 Blob 缓存住，重画 / 连续几轮都不用再解一次。
 * 用 Map 而不是单个变量：一组最多三张，按 URL 命中。
 */
const blobCache = new Map<string, Blob>();
const BLOB_CACHE_LIMIT = 6;

/** 参考图可能是 data URL，也可能是外链：统一取成 Blob 再进表单 */
async function sourceToBlob(src: string): Promise<Blob> {
  if (src.startsWith("data:")) {
    const cached = blobCache.get(src);
    if (cached) return cached;
    const blob = dataUrlToBlob(src);
    if (blobCache.size >= BLOB_CACHE_LIMIT) blobCache.clear();
    blobCache.set(src, blob);
    return blob;
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error(`参考图读取失败（${res.status}）`);
  return await res.blob();
}

function blobName(blob: Blob): string {
  const type = blob.type.toLowerCase();
  if (type.includes("jpeg") || type.includes("jpg")) return "image.jpg";
  if (type.includes("webp")) return "image.webp";
  return "image.png";
}

/**
 * 图生图的表单：一张参考图用 `image`（所有网关都认），多张用 `image[]`
 * （gpt-image-1 系的多图入参）。params 里的字段原样铺进去，最后覆盖 prompt。
 */
function buildEditForm(params: Record<string, unknown>, prompt: string, blobs: Blob[]): FormData {
  const form = new FormData();
  const field = blobs.length > 1 ? "image[]" : "image";
  for (const blob of blobs) form.append(field, blob, blobName(blob));
  for (const [key, value] of Object.entries(params)) {
    if (value == null || key === "prompt" || key === "image" || key === "image[]") continue;
    if (typeof value === "string") {
      if (value.trim()) form.append(key, value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      form.append(key, String(value));
    } else {
      form.append(key, JSON.stringify(value));
    }
  }
  form.set("prompt", prompt);
  return form;
}

export async function requestImage({
  config,
  prompt,
  baseImages,
  signal,
}: ImageRequest): Promise<ImageResult> {
  const endpoint = normalizeEndpoint(config.endpoint);
  if (!endpoint) throw new Error("尚未配置生图 endpoint");
  const params = parseParams(config.params);
  const model = typeof params.model === "string" ? params.model.trim() : "";

  let res: Response;
  if (config.mode === "edit") {
    const sources = (baseImages ?? []).filter((src) => Boolean(src && src.trim()));
    if (!sources.length) {
      throw new Error("图生图需要底图：在角色卡里上传三视图参考图，或把生图档案切成文生图");
    }
    const blobs = await Promise.all(sources.map(sourceToBlob));
    const headers = config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined;
    const send = (files: Blob[]) =>
      fetch(endpoint, {
        method: "POST",
        // 不要手写 Content-Type：multipart 的 boundary 由浏览器补
        headers,
        body: buildEditForm(params, prompt, files),
        signal,
      });

    res = await send(blobs);
    /**
     * 多图入参是 gpt-image-1 起的扩展，不少中转网关只认单文件 `image`。
     * 被 4xx 拒掉时把三视图横向拼成一张再试一次 —— 与其让用户对着
     * 「unexpected field image[]」自己猜，不如自动退一步。
     */
    if (!res.ok && blobs.length > 1 && res.status >= 400 && res.status < 500) {
      await res.text().catch(() => "");
      const sheet = await composeReferenceSheet(blobs);
      if (sheet) res = await send([sheet]);
    }
  } else {
    if (!model) throw new Error("生图参数里缺少 model，无法发起请求");
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ ...params, prompt }),
      signal,
    });
  }

  if (!res.ok) {
    let text = "";
    try {
      text = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(readErrorMessage(text, res.status));
  }

  const payload = (await res.json()) as ImagePayload;
  const url = pickImageUrl(payload);
  if (!url) throw new Error(errorMessage(payload, "接口没有返回图片（检查返回格式或 response_format）"));
  return { url, model };
}

/**
 * 生成结果落库前先收成本地 data URL：
 * - 外链（OpenAI 的临时 URL）会过期，能抓就抓；
 * - b64 原图动辄 1MB+，压到 1024 长边 WebP 后约一两百 KB。
 * 抓不到（CORS）就退回原链接，至少这一次能显示。
 */
export async function storeImageLocally(url: string): Promise<string> {
  try {
    // 网关多半返回 b64_json（已经被包成 data URL）：直接 atob 解，别再走一遍 fetch
    if (url.startsWith("data:")) {
      const blob = dataUrlToBlob(url);
      if (!blob.type.startsWith("image/")) return url;
      return await prepareGeneratedImage(blob);
    }
    const res = await fetch(url);
    if (!res.ok) return url;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return url;
    return await prepareGeneratedImage(blob);
  } catch {
    return url;
  }
}
