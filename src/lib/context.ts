import type {
  AssembledContext,
  Character,
  ChatMessage,
  ContextBlock,
  Message,
} from "./types";
import { clamp, estimateTokens, uid } from "./utils";

export function newBlockId() {
  return uid("blk");
}

export function defaultContextBlocks(systemPromptHint = ""): ContextBlock[] {
  return [
    { id: newBlockId(), kind: "system", enabled: true, label: "角色系统提示" },
    { id: newBlockId(), kind: "image", enabled: true, content: DEFAULT_IMAGE_DIRECTIVE, label: "生图 JSON 预设" },
    { id: newBlockId(), kind: "history", enabled: true, from: -12, to: -1, label: "历史对话" },
    {
      id: newBlockId(),
      kind: "custom",
      enabled: !!systemPromptHint,
      role: "system",
      content: systemPromptHint,
      label: "自定义提示词",
    },
    { id: newBlockId(), kind: "user", enabled: true, label: "用户回复" },
  ];
}

/**
 * 图生图开关打开时插进上下文的那条 system 指令。
 * 它只负责「约定格式」，具体画面由聊天模型自己写；所以要能改 ——
 * 不同模型对代码块、键名的服从度不一样。
 */
export const DEFAULT_IMAGE_DIRECTIVE = `【画面同步】每轮回复的最后，追加一段 JSON（用三个反引号加 json 的代码块包裹），格式固定：
{"生图提示词": "……"}
「生图提示词」是给图生图模型的自然语言画面描述：以 {{char}} 为主体，写清此刻的外貌、表情、动作、服装、镜头距离与角度、光线、场景氛围，五官、发型与服装基调与三视图参考（正面 / 侧面 / 背面）保持一致；竖构图 2:3、人物居中偏上，画面里不要出现文字、字幕或对话气泡。这段 JSON 只用于生成画面，不要在正文里复述，也不要向 {{user}} 解释它的用途。`;

/** 旧预设里的比例文案，2:3 改造后需要静默替换（老角色卡 / 老设置里存着原文） */
const LEGACY_ASPECT_TEXT = "正方形 1:1 构图";
export const CURRENT_ASPECT_TEXT = "竖构图 2:3、人物居中偏上";

/** 底图改成三视图后，老预设里「与底图一致」的说法一并升级 */
const LEGACY_VIEW_TEXT = "五官、发型与服装基调与底图保持一致";
const CURRENT_VIEW_TEXT = "五官、发型与服装基调与三视图参考（正面 / 侧面 / 背面）保持一致";

/** 把老预设里的 1:1 换成 2:3；没命中就原样返回，可重复调用 */
export function upgradeImageAspect(content: string): string {
  return content.includes(LEGACY_ASPECT_TEXT)
    ? content.replace(LEGACY_ASPECT_TEXT, CURRENT_ASPECT_TEXT)
    : content;
}

/** 老预设 → 现行文案（比例 + 三视图）：可重复调用，用户自己改过的内容不动 */
export function upgradeImageDirective(content: string): string {
  const next = upgradeImageAspect(content);
  return next.includes(LEGACY_VIEW_TEXT) ? next.replace(LEGACY_VIEW_TEXT, CURRENT_VIEW_TEXT) : next;
}

export function defaultImageDirectiveBlock(): ContextBlock {
  return {
    id: newBlockId(),
    kind: "image",
    enabled: true,
    content: DEFAULT_IMAGE_DIRECTIVE,
    label: "生图 JSON 预设",
  };
}

/** 保证角色有一份生图 JSON 预设：插在系统提示后面，位置最稳 */
export function ensureImageDirectiveBlock(blocks: ContextBlock[]): ContextBlock[] {
  if (blocks.some((block) => block.kind === "image")) return blocks;
  const next = [...blocks];
  const systemAt = next.findIndex((block) => block.kind === "system");
  next.splice(systemAt + 1, 0, defaultImageDirectiveBlock());
  return next;
}

/** 模板插值：{{char}} / {{user}} / {{time}} / {{input}} */
export function interpolate(
  template: string,
  vars: { char?: string; user?: string; input?: string; time?: string; history?: string },
): string {
  if (!template) return "";
  return template.replace(/\{\{\s*(char|user|input|time|history)\s*\}\}/gi, (_, key: string) => {
    switch (key.toLowerCase()) {
      case "char":
        return vars.char ?? "";
      case "user":
        return vars.user ?? "";
      case "input":
        return vars.input ?? "";
      case "time":
        return vars.time ?? new Date().toLocaleString("zh-CN");
      case "history":
        return vars.history ?? "";
      default:
        return "";
    }
  });
}

/** 按负数下标切片历史：[-5,-1] = 倒数第 5 条到倒数第 1 条 */
export function sliceHistory(history: ChatMessage[], from: number, to: number): ChatMessage[] {
  const n = history.length;
  if (n === 0) return [];
  const norm = (i: number) => (i < 0 ? n + i : i);
  let start = clamp(norm(from), 0, n - 1);
  let end = clamp(norm(to), 0, n - 1);
  if (start > end) [start, end] = [end, start];
  return history.slice(start, end + 1);
}

export function describeHistoryBlock(from: number, to: number): string {
  const fmt = (i: number) => (i < 0 ? `倒数第 ${Math.abs(i)} 条` : `第 ${i + 1} 条`);
  if (from === 0 && to === -1) return "全部历史";
  return `${fmt(from)} → ${fmt(to)}`;
}

/**
 * 上下文装配：按块顺序产出 messages。
 * 连续同 role 的消息会被合并成一条，兼容要求严格交替的接口。
 */
export function assembleContext(params: {
  character: Pick<Character, "name" | "systemPrompt" | "contextBlocks">;
  history: Message[] | ChatMessage[];
  input: string;
  userName?: string;
  /** 图生图开关：关着时「生图 JSON 预设」不进入上下文 */
  imageEnabled?: boolean;
}): AssembledContext {
  const { character, history, input, userName = "你", imageEnabled = false } = params;
  const blocks = character.contextBlocks ?? [];

  const historyMessages: ChatMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const messages: ChatMessage[] = [];
  const trace: AssembledContext["trace"] = [];
  let hasUserBlock = false;

  // 老角色卡里可能没有这个块：开关打开时也补一条，保证「返回 JSON」的约定一定在上下文里。
  // 位置放在角色系统提示之后（没有系统块就放在最前），别抢在设定前面。
  const needsImageFallback = imageEnabled && !blocks.some((block) => block.kind === "image");
  let imageFallbackDone = !needsImageFallback;
  const pushImageFallback = () => {
    if (imageFallbackDone) return;
    imageFallbackDone = true;
    const content = interpolate(DEFAULT_IMAGE_DIRECTIVE, { char: character.name, user: userName });
    messages.push({ role: "system", content });
    trace.push({ blockId: "image-preset", kind: "image", count: 1, note: `system · ${content.length} 字` });
  };

  // 连系统块都没有：预设直接打头，别落到历史后面去
  if (!blocks.some((block) => block.kind === "system")) pushImageFallback();

  for (const block of blocks) {
    if (!block.enabled) {
      trace.push({ blockId: block.id, kind: block.kind, count: 0, note: "已禁用" });
      if (block.kind === "system") pushImageFallback();
      continue;
    }
    switch (block.kind) {
      case "system": {
        const text = character.systemPrompt?.trim();
        if (!text) {
          trace.push({ blockId: block.id, kind: block.kind, count: 0, note: "角色未填写系统提示" });
          break;
        }
        const content = interpolate(text, { char: character.name, user: userName });
        messages.push({ role: "system", content });
        trace.push({ blockId: block.id, kind: block.kind, count: 1, note: `system · ${text.length} 字` });
        break;
      }
      case "image": {
        if (!imageEnabled) {
          trace.push({ blockId: block.id, kind: block.kind, count: 0, note: "图生图未开启" });
          break;
        }
        const content = interpolate(block.content, { char: character.name, user: userName }).trim();
        if (!content) {
          trace.push({ blockId: block.id, kind: block.kind, count: 0, note: "内容为空" });
          break;
        }
        messages.push({ role: "system", content });
        trace.push({ blockId: block.id, kind: block.kind, count: 1, note: `system · ${content.length} 字` });
        break;
      }
      case "history": {
        const slice = sliceHistory(historyMessages, block.from, block.to);
        messages.push(...slice);
        trace.push({
          blockId: block.id,
          kind: block.kind,
          count: slice.length,
          note: `${describeHistoryBlock(block.from, block.to)} · 实际 ${slice.length} 条`,
        });
        break;
      }
      case "custom": {
        const content = interpolate(block.content, {
          char: character.name,
          user: userName,
          input,
        }).trim();
        if (!content) {
          trace.push({ blockId: block.id, kind: block.kind, count: 0, note: "内容为空" });
          break;
        }
        messages.push({ role: block.role, content });
        trace.push({ blockId: block.id, kind: block.kind, count: 1, note: `${block.role} · ${content.length} 字` });
        break;
      }
      case "user": {
        hasUserBlock = true;
        const content = input.trim();
        if (!content) {
          trace.push({ blockId: block.id, kind: block.kind, count: 0, note: "等待输入" });
          break;
        }
        messages.push({ role: "user", content });
        trace.push({ blockId: block.id, kind: block.kind, count: 1, note: `user · ${content.length} 字` });
        break;
      }
    }
    if (block.kind === "system") pushImageFallback();
  }

  if (!hasUserBlock && input.trim()) {
    messages.push({ role: "user", content: input.trim() });
  }

  const merged = mergeAdjacent(messages);
  const tokens = merged.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
  return { messages: merged, trace, tokens };
}

/**
 * 相邻同 role 直接连成一条（空行分隔）。
 * 多块 system、历史里被删掉一半的连续 user，都会冒出同 role 相邻；
 * 很多接口要求 user / assistant 严格交替，这里统一兜住。
 */
function mergeAdjacent(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const msg of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === msg.role) {
      out[out.length - 1] = { role: prev.role, content: `${prev.content}\n\n${msg.content}` };
    } else {
      out.push({ ...msg });
    }
  }
  return out;
}

export function blockKindMeta(kind: ContextBlock["kind"]): {
  label: string;
  hint: string;
  tone: string;
} {
  switch (kind) {
    case "system":
      return { label: "角色系统提示", hint: "来自角色卡设定", tone: "bg-primary-container text-on-primary-container" };
    case "history":
      return { label: "历史对话", hint: "支持负数下标切片", tone: "bg-surface-3 text-fg-muted" };
    case "custom":
      return { label: "自定义提示词", hint: "可指定 role", tone: "bg-secondary-container text-on-primary-container" };
    case "image":
      return { label: "生图 JSON 预设", hint: "system · 随图生图开关生效", tone: "bg-secondary-container text-on-primary-container" };
    case "user":
      return { label: "用户回复", hint: "当前输入", tone: "bg-surface-2 text-fg" };
  }
}
