import raw from "../data/profile-preset.json";
import type { Character, ChatMessage, ModelConfig, ProfileConfig, ProfileSnapshot, Role } from "./types";
import { interpolate } from "./context";
import { matchBrace, repairJson } from "./image-prompt";
import { clamp, safeJsonParse } from "./utils";

/**
 * 角色档案：一条随对话演化的原文。
 *
 * 起点是 `character.systemPrompt`（用户自己写的那段），每 N 轮由后台发一次
 * 「合并整理」请求，产出一版新的原文存进 profiles 表。注入时按当前会话已经
 * 聊到第几轮取对应版本 —— 所以第 0 版永远是用户的自定义，后面才是演化；
 * 回头看旧消息时拿到的也是那一版，不会串味。
 *
 * 产出形状固定为 `{"角色档案": "……"}`，程序只取这个键里的字符串，
 * 落库、注入、展示全部是原文，不做结构化拆解。
 */

const FALLBACK_EVERY = 6;
const FALLBACK_INSTRUCTION =
  '把上面这段对话带来的变化，合并进【当前角色档案】，输出更新后的档案原文。档案是一段连续的第三人称叙述，只写此刻的状态、关系与还没了结的事，不要复述剧情。只输出一个 JSON 对象：{"角色档案": "……"}';

const preset = raw as { every?: unknown; instruction?: unknown };

function readEvery(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? clamp(Math.round(n), 1, 100) : FALLBACK_EVERY;
}

function readInstruction(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : FALLBACK_INSTRUCTION;
}

/** 默认间隔（轮），来自 `src/data/profile-preset.json` */
export const DEFAULT_PROFILE_EVERY = readEvery(preset.every);

/** 默认合并指令，来自同一个 JSON */
export const DEFAULT_PROFILE_INSTRUCTION = readInstruction(preset.instruction);

export function defaultProfileConfig(): ProfileConfig {
  // 后台整理要花 token，默认关着让用户自己打开
  return { enabled: false, every: DEFAULT_PROFILE_EVERY, instruction: DEFAULT_PROFILE_INSTRUCTION };
}

/** 空间里存的 jsonb 可能缺字段 / 是坏值：读出来先过这一道 */
export function normalizeProfileConfig(value: unknown): ProfileConfig {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    enabled: row.enabled === true,
    every: readEvery(row.every),
    instruction: readInstruction(row.instruction),
  };
}

/**
 * 轮数 = 会话里 user 消息的条数。
 *
 * 不按 `messages.length / 2` 算：开场白是一条 assistant，消息数永远是奇数，
 * 除出来会一直差半轮；删过消息、截断之后那个比例也会失真。
 */
export function countRounds(messages: readonly { role: Role | string }[]): number {
  let n = 0;
  for (const message of messages) if (message.role === "user") n += 1;
  return n;
}

/** 这一轮聊完之后要不要整理：rounds > 0 且正好踩在间隔上 */
export function isProfileDue(rounds: number, every: number): boolean {
  return rounds > 0 && rounds % Math.max(1, every) === 0;
}

/**
 * 当前该注入哪一版：所有「覆盖轮数 ≤ 当前轮数」的版本里最后一份。
 *
 * 间隔没变过时它就等于 `floor(轮数 / N)` 那一项；写成「按 round 取」而不是直接
 * 用除法，是为了在整理失败过、或用户中途改了 N 之后仍然注入已知的最新一版，
 * 而不是跳到一份「未来」的档案上去。
 */
export function pickProfile(
  profiles: readonly ProfileSnapshot[],
  rounds: number,
): ProfileSnapshot | null {
  let picked: ProfileSnapshot | null = null;
  for (const snapshot of profiles) {
    if (snapshot.round > rounds) continue;
    if (!picked || snapshot.round >= picked.round) picked = snapshot;
  }
  return picked;
}

/** 注入用正文：有档案用档案，没有就退回角色设定原文（第 0 版） */
export function profileText(
  character: Pick<Character, "systemPrompt">,
  snapshot: ProfileSnapshot | null,
): string {
  return snapshot?.content.trim() || character.systemPrompt.trim();
}

/** 从第 `fromRound` 轮之后开始的消息（含那一轮的 user）：上次整理没覆盖到的部分 */
export function messagesSinceRound<T extends { role: Role | string }>(
  messages: readonly T[],
  fromRound: number,
): T[] {
  let seen = 0;
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i].role !== "user") continue;
    if (seen >= fromRound) return messages.slice(i);
    seen += 1;
  }
  return [];
}

/** 喂给模型的对话誊本：一行一句，带上谁在说话 */
export function transcriptOf(
  messages: readonly { role: Role | string; content: string }[],
  charName: string,
  userName: string,
): string {
  return messages
    .map((message) => {
      const text = message.content.trim();
      if (!text) return "";
      return `${message.role === "user" ? userName : charName}：${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

export interface ProfileRequestInput {
  /** 空间的共享系统提示词：让整理结果不跟世界设定打架 */
  spacePrompt: string;
  characterName: string;
  userName: string;
  /** 当前生效的那一版原文（没有档案时是角色设定原文） */
  currentText: string;
  /** 上次整理之后产生的对话 */
  transcript: string;
  instruction: string;
}

/**
 * 整理请求的消息栈：空间提示词 →（一条 user）本段对话 + 当前档案 + 合并指令。
 *
 * 证据与指令放进同一条 user 消息里：要求严格交替的网关不少，
 * 连发两条 user 会被合并甚至报错。
 */
export function buildProfileMessages(input: ProfileRequestInput): ChatMessage[] {
  const vars = { char: input.characterName, user: input.userName };
  const messages: ChatMessage[] = [];

  const system = interpolate(input.spacePrompt, vars).trim();
  if (system) messages.push({ role: "system", content: system });

  const archive = input.currentText.trim() || "（还没有档案，按下面这段对话新建一份）";
  messages.push({
    role: "user",
    content: [
      `【本段对话】\n${input.transcript.trim() || "（本段还没有对话）"}`,
      `【当前角色档案】\n${archive}`,
      `【任务】\n${interpolate(input.instruction, vars).trim()}`,
    ].join("\n\n"),
  });
  return messages;
}

/** 整理请求的模型参数：不流式、温度压低 —— 这一步要的是稳，不是发挥 */
export function profileModelConfig(config: ModelConfig): ModelConfig {
  const parsed = safeJsonParse<Record<string, unknown>>(config.params || "{}");
  const params = parsed.ok && parsed.value && typeof parsed.value === "object" ? parsed.value : {};
  return { ...config, params: JSON.stringify({ ...params, stream: false, temperature: 0.3 }) };
}

/* ------------------------------ 取档案原文 ------------------------------ */

const ARCHIVE_KEYS = ["角色档案", "角色档案原文", "档案", "character_profile", "characterprofile", "profile"];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_\-·:：]/g, "");
}

function pickArchiveValue(value: unknown, depth = 0): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    // 少数模型会把档案拆成几段塞进数组
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .join("\n\n");
  }
  if (value && typeof value === "object" && depth < 2) {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (ARCHIVE_KEYS.includes(normalizeKey(key))) {
        const text = pickArchiveValue(item, depth + 1);
        if (text) return text;
      }
    }
    // 没有认得的键：只有一个字符串值时就用它，别为了键名把内容丢掉
    const strings = Object.values(value as Record<string, unknown>).filter(
      (item): item is string => typeof item === "string" && Boolean(item.trim()),
    );
    if (strings.length === 1) return strings[0].trim();
  }
  return "";
}

/** 由严到松地解析一段对象文本（复用生图那条修复链，兜住全角标点 / 裸换行） */
function parseLooseObject(raw: string): Record<string, unknown> | null {
  for (let level = 0; level <= 4; level += 1) {
    try {
      const value = JSON.parse(repairJson(raw, level)) as unknown;
      if (value && typeof value === "object") {
        if (!Array.isArray(value)) return value as Record<string, unknown>;
        for (const item of value) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            return item as Record<string, unknown>;
          }
        }
      }
    } catch {
      /* 换下一档 */
    }
  }
  return null;
}

/**
 * 从模型的回复里取出档案原文。
 *
 * 优先认围栏块，再扫裸对象；都取不到时，只要回复里没有花括号（说明它干脆
 * 没给 JSON、直接把档案写成了正文）就把整段收下 —— 宁可用，也不要白跑一次请求。
 */
export function extractProfileText(reply: string): string {
  const text = (reply ?? "").trim();
  if (!text) return "";

  const candidates: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of text.matchAll(fence)) candidates.push(match[1]);
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    const end = matchBrace(text, i);
    if (end > i) candidates.push(text.slice(i, end));
  }

  for (const candidate of candidates) {
    const parsed = parseLooseObject(candidate);
    if (!parsed) continue;
    const picked = pickArchiveValue(parsed);
    if (picked) return picked;
  }

  return text.includes("{") ? "" : text;
}
