import type { ImagePromptBlock, ImagePromptBlockKind } from "./types";
import { interpolate } from "./context";

/**
 * 生图提示词的解析与拼装。
 *
 * 约定：聊天模型在正文里返回一段 JSON，其中某个键是绘图提示词
 * （推荐键名「生图提示词」，也认 image_prompt 等常见写法）。
 * 这段 JSON 不显示在气泡里，只把提示词存进消息 meta，再按「生图提示词块」的
 * 顺序和硬编码片段拼成最终送进绘图模型的 prompt。
 */

/** 强特征键：命中就认定这段 JSON 是生图指令（比较时忽略空格 / 下划线 / 大小写） */
const STRONG_KEYS = [
  "生图提示词",
  "绘图提示词",
  "画面提示词",
  "图像提示词",
  "出图提示词",
  "画面描述",
  // 模型偶尔偷懒，只写「生图」「绘图」——中文里这几个词几乎只出现在这个场景
  "生图",
  "绘图",
  "出图",
  "配图",
  "image_prompt",
  "imageprompt",
  "imagePrompt",
  "drawing_prompt",
];

/** 弱特征键：只有当这个对象里几乎没有别的字段时才认，避免误吃普通 JSON */
const WEAK_KEYS = ["prompt", "positive_prompt"];

function normalizeKey(key: string): string {
  return key.replace(/[\s_-]/g, "").toLowerCase();
}

/**
 * 键名匹配放宽一点：模型经常自作主张叫「本轮生图提示词」「生图提示词v2」
 * 「image_prompt_cn」。强键要求归一化后完全相等，其余按组合特征认。
 */
function isStrongKey(key: string): boolean {
  const norm = normalizeKey(key);
  if (STRONG_KEYS.some((candidate) => normalizeKey(candidate) === norm)) return true;
  if (/(生图|绘图|画面|图像|出图)/.test(key) && /提示词|描述/.test(key)) return true;
  if (/image/i.test(key) && /prompt/i.test(key)) return true;
  return false;
}

function pickPromptValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const joined = value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .join("，");
    return joined.trim() || undefined;
  }
  if (value && typeof value === "object") {
    // 少数模板会写成 {"生图提示词": {"text": "..."}}
    const record = value as Record<string, unknown>;
    for (const key of ["text", "prompt", "content", "描述", "提示词"]) {
      const inner = pickPromptValue(record[key]);
      if (inner) return inner;
    }
  }
  return undefined;
}

/** 从一个已解析的对象里找出生图提示词：顶层强键 → 嵌套两层的强键 → 顶层弱键 */
function pickPrompt(obj: Record<string, unknown>): string | undefined {
  const strong = pickStrongPrompt(obj, 0);
  if (strong) return strong;

  const entries = Object.entries(obj);
  if (entries.length <= 3) {
    for (const [key, value] of entries) {
      const norm = normalizeKey(key);
      if (WEAK_KEYS.some((candidate) => normalizeKey(candidate) === norm)) {
        const prompt = pickPromptValue(value);
        if (prompt) return prompt;
      }
    }
  }
  return undefined;
}

function pickStrongPrompt(obj: Record<string, unknown>, depth: number): string | undefined {
  for (const [key, value] of Object.entries(obj)) {
    if (!isStrongKey(key)) continue;
    const prompt = pickPromptValue(value);
    if (prompt) return prompt;
  }
  // 有的模板把画面包了一层：{"画面": {"生图提示词": "..."}}，或者 {"shots": [{...}]}
  if (depth < 2) {
    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const inner = pickStrongPrompt(item as Record<string, unknown>, depth + 1);
            if (inner) return inner;
          }
        }
      } else if (value && typeof value === "object") {
        const inner = pickStrongPrompt(value as Record<string, unknown>, depth + 1);
        if (inner) return inner;
      }
    }
  }
  return undefined;
}

/* ------------------------------ 容错解析 ------------------------------ */

/**
 * 只在「结构位」上把全角标点掰成半角：字符串内部的中文标点原样保留。
 * 早先是全局 replace，结果提示词里的「，」被换成半角逗号、中文引号把整条字符串截断。
 */
function normalizeStructural(raw: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === "\\") {
        out += ch + (raw[i + 1] ?? "");
        i += 1;
        continue;
      }
      const closes = quote === '"' ? ch === '"' || ch === "”" : ch === "'" || ch === "’";
      if (closes) {
        quote = null;
        out += '"';
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') {
      quote = '"';
      out += ch;
      continue;
    }
    if (ch === "“" || ch === "＂") {
      quote = "”";
      out += '"';
      continue;
    }
    if (ch === "'" || ch === "‘") {
      quote = "’";
      out += '"';
      continue;
    }
    if (ch === "｛") {
      out += "{";
      continue;
    }
    if (ch === "｝") {
      out += "}";
      continue;
    }
    if (ch === "［") {
      out += "[";
      continue;
    }
    if (ch === "］") {
      out += "]";
      continue;
    }
    if (ch === "：") {
      out += ":";
      continue;
    }
    if (ch === "，") {
      out += ",";
      continue;
    }
    out += ch;
  }
  return out;
}

/** 字符串里不能有裸换行：模型写多行提示词时几乎必犯，转成 \n 才 parse 得动 */
function escapeBreaksInsideStrings(raw: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (const ch of raw) {
    if (inString) {
      if (escape) {
        escape = false;
        out += ch;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        out += ch;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      if (ch === "\n") {
        out += "\\n";
        continue;
      }
      if (ch === "\r") continue;
      if (ch === "\t") {
        out += "\\t";
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

/** 裸键名 {生图提示词:"…"} —— JSON 里必须带引号 */
function quoteBareKeys(raw: string): string {
  return raw.replace(
    /([{,]\s*)([A-Za-z_$\u4e00-\u9fa5][^:,\s"{}[\]]{0,40})\s*:/g,
    '$1"$2":',
  );
}

/**
 * 由严到松地试解析：能过第 0 档就绝不动后面的档位，
 * 因为越往后的修补越可能改坏内容（全角标点、尾逗号、裸键名…）。
 */
function repairJson(raw: string, level: number): string {
  let text = raw;
  if (level >= 1) text = normalizeStructural(text);
  if (level >= 2) text = escapeBreaksInsideStrings(text);
  if (level >= 3) text = text.replace(/,\s*([}\]])/g, "$1");
  if (level >= 4) text = quoteBareKeys(text);
  return text;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  for (let level = 0; level <= 4; level += 1) {
    try {
      const value = JSON.parse(repairJson(raw, level)) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
      // [{"生图提示词": "…"}]：取数组里的第一个对象
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            return item as Record<string, unknown>;
          }
        }
      }
    } catch {
      /* 换下一档再试 */
    }
  }
  return null;
}

/**
 * 最后的兜底：整段 JSON 已经烂到 parse 不动（少个括号、被截断、值里有裸引号），
 * 就按「"键名" : "值"」直接把那句话抠出来，并往外扩到包住它的大括号一起摘掉。
 */
function scrapePrompt(text: string): { prompt: string; start: number; end: number } | null {
  const key = `[^"'”’\\n]{0,10}(?:生图|绘图|画面|图像|出图)[^"'”’\\n]{0,10}提示词|image[_\\s-]?prompt|drawing[_\\s-]?prompt`;
  const re = new RegExp(`["“'](?:${key})["”']\\s*[:：]\\s*["“]([\\s\\S]*?)["”]`, "i");
  const match = re.exec(text);
  if (!match) return null;
  const prompt = match[1].replace(/\\n/g, "\n").trim();
  if (!prompt) return null;

  const open = text.lastIndexOf("{", match.index);
  const close = open >= 0 ? matchBrace(text, open) : -1;
  return {
    prompt,
    start: open >= 0 ? open : match.index,
    end: close > open ? close : text.length,
  };
}

/** 找到与 start 处 `{` 配对的 `}`，返回结束下标（不含）；不配对返回 -1 */
function matchBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** 只留着位置、内容抹成空格的副本，用来做括号扫描时不误吃代码块内部 */
function maskRanges(text: string, ranges: { start: number; end: number }[]): string {
  if (!ranges.length) return text;
  const chars = text.split("");
  for (const range of ranges) {
    for (let i = range.start; i < range.end && i < chars.length; i++) {
      if (chars[i] !== "\n") chars[i] = " ";
    }
  }
  return chars.join("");
}

/** 未闭合的片段是不是「正在打生图 JSON」——是就先藏起来，别让它闪在气泡里 */
function looksLikeImageJson(fragment: string): boolean {
  const head = fragment.slice(0, 160);
  if (/"(生图|绘图|画面|图像|出图)[^"]{0,10}提示词/.test(head)) return true;
  if (/"[\w\s-]{0,20}prompt"\s*[:：]/i.test(head)) return true;
  // 刚打出一个 `{` 或 `{"`，还没到键名：先按下不表，最多闪几百毫秒
  return /^\{\s*["']?\s*$/.test(head);
}

/** 未闭合围栏：跳过语言标记看正文，空正文或刚起手 `{` 都算「正在打 JSON」 */
function unclosedFenceIsImageJson(fragment: string): boolean {
  const body = fragment.replace(/^[^\n`]*\r?\n/, "");
  const head = body.slice(0, 200);
  if (/"(生图|绘图|画面|图像|出图)[^"]{0,10}提示词/.test(head)) return true;
  if (/"[\w\s-]{0,20}prompt"\s*[:：]/i.test(head)) return true;
  return body.trim() === "" || /^\{\s*["']?\s*$/.test(body.slice(0, 40));
}

export interface ExtractedImagePrompt {
  /** 从气泡里应该显示的正文（生图 JSON 已摘掉） */
  text: string;
  /** 摘出来的生图提示词，没找到就是空串 */
  prompt: string;
  /** 尾部有未闭合的生图片段被一起藏掉了（流式过程中） */
  pending: boolean;
}

/** 反复出现的空行收一收，别因为摘掉一段 JSON 留下三四个空行 */
function tidy(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractImagePrompt(content: string): ExtractedImagePrompt {
  if (!content) return { text: "", prompt: "", pending: false };
  // 绝大多数回复里没有 JSON，先做一次廉价判断，别每帧都全量扫描
  if (!content.includes("{") && !content.includes("｛") && !content.includes("```")) {
    return { text: content, prompt: "", pending: false };
  }

  // 全角大括号就地换半角（长度不变，索引仍对得上）：整段用 ｛｝ 的回复以前直接被漏掉
  const src = content.replace(/｛/g, "{").replace(/｝/g, "}");

  const spans: { start: number; end: number }[] = [];
  let prompt = "";

  // 1) 代码围栏里的 JSON：整段（含围栏）都摘掉
  //    开围栏要求语言标记后换行，避免把行内 ``` 当成块的开头
  const fenceRe = /```([^\n`]*)\r?\n([\s\S]*?)```/g;
  let fenceMatch: RegExpExecArray | null;
  const fences: { start: number; end: number }[] = [];
  while ((fenceMatch = fenceRe.exec(src))) {
    const start = fenceMatch.index;
    const end = start + fenceMatch[0].length;
    fences.push({ start, end });
    const body = fenceMatch[2].trim();
    const obj = parseJsonObject(body);
    // 整段 parse 不动时再退一步：从围栏正文里抠那句话
    const found = (obj ? pickPrompt(obj) : undefined) ?? scrapePrompt(body)?.prompt;
    if (found) {
      spans.push({ start, end });
      if (!prompt) prompt = found;
    }
  }

  // 2) 裸 JSON：在代码围栏之外逐个括号配对，解析成功且带生图键才摘
  const masked = maskRanges(src, fences);
  let unclosedAt = -1;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== "{") continue;
    const end = matchBrace(masked, i);
    if (end === -1) {
      unclosedAt = i;
      break;
    }
    const obj = parseJsonObject(src.slice(i, end));
    const found = obj ? pickPrompt(obj) : undefined;
    if (found) {
      // [{"生图提示词": "…"}]：连外层方括号一起摘，否则正文里会剩一对孤零零的 []
      const start = src[i - 1] === "[" && src[end] === "]" ? i - 1 : i;
      const stop = start < i ? end + 1 : end;
      spans.push({ start, end: stop });
      if (!prompt) prompt = found;
      i = end - 1;
    }
    // 解析失败时只前进一格：以前这里直接跳到 end，正文里先冒出来的那个 `{`
    // （台词里的括号、被截断的旧片段）会把真正的 JSON 整段吞掉
  }

  let pending = false;
  let cut = src.length;

  // 3) 未闭合的围栏 / 括号：只在看着像生图 JSON 时截断展示
  if (unclosedAt !== -1) {
    if (looksLikeImageJson(src.slice(unclosedAt))) {
      pending = true;
      cut = Math.min(cut, unclosedAt);
    }
  }
  // 未闭合的 ``` 围栏：数一数出现次数，奇数说明最后一个还没收尾
  const fenceTicks = src.split("```").length - 1;
  if (fenceTicks % 2 === 1) {
    const open = src.lastIndexOf("```");
    if (open >= 0 && unclosedFenceIsImageJson(src.slice(open + 3))) {
      pending = true;
      cut = Math.min(cut, open);
    }
  }

  // 4) 兜底：整段 parse 不动（少括号 / 被截断 / 值里有裸引号）时，按「键名：值」抠一句
  if (!prompt) {
    const scraped = scrapePrompt(src);
    if (scraped) {
      prompt = scraped.prompt;
      spans.push({ start: scraped.start, end: scraped.end });
      cut = Math.min(cut, scraped.end);
    }
  }

  if (!spans.length && !pending) {
    if (import.meta.env.DEV && /生图|绘图|image[_ ]?prompt/i.test(src)) {
      console.warn("[生图] 回复里像是有生图 JSON，但没解析出来，原文：", content.slice(0, 400));
    }
    return { text: content, prompt: "", pending: false };
  }

  // 5) 按区间拼回正文；落在截断点之后的片段自然被丢掉
  spans.sort((a, b) => a.start - b.start);
  let text = "";
  let cursor = 0;
  for (const span of spans) {
    if (span.start >= cut) break;
    if (span.start > cursor) text += src.slice(cursor, span.start);
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < cut) text += src.slice(cursor, cut);

  return { text: tidy(text), prompt, pending };
}

export interface ImagePromptTrace {
  id: string;
  kind: ImagePromptBlockKind;
  note: string;
  chars: number;
}

export interface AssembledImagePrompt {
  text: string;
  trace: ImagePromptTrace[];
}

export const imageBlockLabel: Record<ImagePromptBlockKind, { label: string; hint: string; tone: string }> = {
  text: {
    label: "硬编码提示词",
    hint: "支持变量",
    tone: "bg-surface-3 text-fg-muted",
  },
  prompt: {
    label: "生图提示词",
    hint: "模型返回的 JSON",
    tone: "bg-primary-container text-on-primary-container",
  },
};

/**
 * 按块的顺序拼出最终 prompt。块之间用换行连接 —— 自然语言流式提示词里
 * 换行比逗号更能让模型分清「画风」和「这一轮发生了什么」。
 */
export function assembleImagePrompt(params: {
  blocks: ImagePromptBlock[];
  /** 只用于 {{char}} 变量；角色外形不再作为独立块自动注入 */
  characterName?: string;
  userName?: string;
  prompt: string;
}): AssembledImagePrompt {
  const { blocks, characterName = "", userName = "你", prompt } = params;
  const parts: string[] = [];
  const trace: ImagePromptTrace[] = [];

  for (const block of blocks) {
    if (!block.enabled) {
      trace.push({ id: block.id, kind: block.kind, note: "已禁用", chars: 0 });
      continue;
    }
    const content =
      block.kind === "text"
        ? interpolate(block.content, { char: characterName, user: userName, input: prompt }).trim()
        : prompt.trim();

    if (!content) {
      trace.push({ id: block.id, kind: block.kind, note: "内容为空", chars: 0 });
      continue;
    }
    parts.push(content);
    trace.push({ id: block.id, kind: block.kind, note: `${content.length} 字`, chars: content.length });
  }

  // 块全被禁用 / 全为空时退回模型给的那句，总比发一个空 prompt 出去强
  const text = parts.length ? parts.join("\n") : prompt.trim();
  return { text, trace };
}
