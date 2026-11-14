import type {
  AssembledContext,
  Character,
  ChatMessage,
  ContextBlock,
  Message,
  Space,
} from "./types";
import { clamp, estimateTokens, uid } from "./utils";
import { DEFAULT_IMAGE_DIRECTIVE } from "./image-presets";

export function newBlockId() {
  return uid("blk");
}

export function defaultContextBlocks(): ContextBlock[] {
  return [
    { id: newBlockId(), kind: "system", enabled: true, label: "空间系统提示" },
    { id: newBlockId(), kind: "character", enabled: true, label: "角色专属提示" },
    { id: newBlockId(), kind: "image", enabled: true, content: DEFAULT_IMAGE_DIRECTIVE, label: "生图 JSON 预设" },
    { id: newBlockId(), kind: "history", enabled: true, from: -12, to: -1, label: "历史对话" },
    { id: newBlockId(), kind: "user", enabled: true, label: "用户回复" },
  ];
}

/**
 * 生图 JSON 预设的正文在 `src/data/image-preset.json` 里，这里只做转出。
 * 它只负责「约定格式」，具体画面由聊天模型自己写；所以要能改 ——
 * 不同模型对代码块、键名的服从度不一样。
 *
 * 放在回复**开头**：JSON 一旦闭合就能先开画，正文继续往下打，两条线并行。
 */
export { DEFAULT_IMAGE_DIRECTIVE };

/** 旧默认：整段被认出来的话，升级时换成上面那版（用户自己改过的不动） */
const LEGACY_IMAGE_DIRECTIVE = `【画面同步】每轮回复的最后，追加一段 JSON（用三个反引号加 json 的代码块包裹），格式固定：
{"生图提示词": "……"}
「生图提示词」是给图生图模型的自然语言画面描述：以 {{char}} 为主体，写清此刻的外貌、表情、动作、服装、镜头距离与角度、光线、场景氛围，五官、发型与服装基调与三视图参考（面部大图 / 正面 / 背面）保持一致；竖构图 2:3、人物居中偏上，画面里不要出现文字、字幕或对话气泡。这段 JSON 只用于生成画面，不要在正文里复述，也不要向 {{user}} 解释它的用途。`;

/** 旧预设里的比例文案，2:3 改造后需要静默替换（老角色卡 / 老设置里存着原文） */
const LEGACY_ASPECT_TEXT = "正方形 1:1 构图";
export const CURRENT_ASPECT_TEXT = "竖构图 2:3、人物居中偏上";

/**
 * 底图口径的历代说法：一张底图 →「正面 / 侧面 / 背面」→「面部大图 / 正面 / 背面」
 * →「正面证件照 / 侧面全身照 / 背面俯视照」→ 单张「正面 3/4 视角」→ 不再注入视角。
 * 视角不再由预设写死：写死了就会顶掉用户自己编排里的构图（想要全身却一直被拉成 3/4），
 * 现在只做减法 —— 把历代预设补进去的视图括号清掉，视角留给提示词编排自己写。
 * 顺序：先清括号，再把「三视图参考」这种措辞收成「底图」。
 */
const DROPPED_VIEW_TEXTS = [
  "（正面 / 侧面 / 背面）",
  "（面部大图 / 正面 / 背面）",
  "（正面证件照 / 侧面全身照 / 背面俯视照）",
  "（正面 3/4 视角）",
];
const LEGACY_VIEW_TEXTS: Array<[legacy: string, current: string]> = [
  ["基于三视图创作", "基于底图创作"],
  ["三视图底图", "底图"],
  ["三视图参考", "底图"],
];

/** 把老预设里的 1:1 换成 2:3；没命中就原样返回，可重复调用 */
export function upgradeImageAspect(content: string): string {
  return content.includes(LEGACY_ASPECT_TEXT)
    ? content.replace(LEGACY_ASPECT_TEXT, CURRENT_ASPECT_TEXT)
    : content;
}

/**
 * 老预设 → 现行文案（比例 + 底图口径）：可重复调用，用户自己改过的内容不动。
 * 先整段比上一代默认原文（相等 = 没动过，直接换成新版：JSON 挪到回复开头），
 * 再做短语替换。顺序不能反 —— 短语替换会改掉旧原文，之后就比不上了。
 * 视图括号只删不补（替换目标不包含替换源，所以可以反复跑）。
 */
export function upgradeImageDirective(content: string): string {
  if (content.trim() === LEGACY_IMAGE_DIRECTIVE.trim()) return DEFAULT_IMAGE_DIRECTIVE;
  let next = upgradeImageAspect(content);
  for (const phrase of DROPPED_VIEW_TEXTS) {
    if (next.includes(phrase)) next = next.split(phrase).join("");
  }
  for (const [legacy, current] of LEGACY_VIEW_TEXTS) {
    if (next.includes(legacy)) next = next.split(legacy).join(current);
  }
  return next;
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

/** 保证空间有一份生图 JSON 预设：插在系统提示后面，位置最稳 */
export function ensureImageDirectiveBlock(blocks: ContextBlock[]): ContextBlock[] {
  if (blocks.some((block) => block.kind === "image")) return blocks;
  const next = [...blocks];
  const systemAt = next.findIndex((block) => block.kind === "system");
  next.splice(systemAt + 1, 0, defaultImageDirectiveBlock());
  return next;
}

/**
 * 保证空间编排里能放「角色专属提示」。
 * 编排是空间级的、所有角色共用一份；没有这个块，角色的专属提示词就没有落点。
 * 老数据（迁移前的上下文数组）在读取时补一条，插在系统提示之后。
 */
export function ensureCharacterBlock(blocks: ContextBlock[]): ContextBlock[] {
  if (blocks.some((block) => block.kind === "character")) return blocks;
  const next = [...blocks];
  const at = next.findIndex((block) => block.kind === "system");
  next.splice(at + 1, 0, {
    id: newBlockId(),
    kind: "character",
    enabled: true,
    label: "角色专属提示",
  });
  return next;
}

/** 模板插值：{{char}} / {{user}} / {{time}} / {{input}}（{{prompt}} 是 {{input}} 的别名） */
export function interpolate(
  template: string,
  vars: { char?: string; user?: string; input?: string; time?: string; history?: string },
): string {
  if (!template) return "";
  return template.replace(/\{\{\s*(char|user|input|prompt|time|history)\s*\}\}/gi, (_, key: string) => {
    switch (key.toLowerCase()) {
      case "char":
        return vars.char ?? "";
      case "user":
        return vars.user ?? "";
      // 生图提示词块里习惯写 {{prompt}}，语义就是本轮那句 input
      case "input":
      case "prompt":
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
 *
 * 块来自 `space`（空间是编排的唯一持有者）；`character` 只贡献自己的名字与专属提示词。
 */
export function assembleContext(params: {
  space: Pick<Space, "systemPrompt" | "contextBlocks">;
  character: Pick<Character, "name" | "systemPrompt">;
  history: Message[] | ChatMessage[];
  input: string;
  userName?: string;
  /** 图生图开关：关着时「生图 JSON 预设」不进入上下文 */
  imageEnabled?: boolean;
}): AssembledContext {
  const { space, character, history, input, userName = "你", imageEnabled = false } = params;
  const blocks = space.contextBlocks ?? [];
  const charVars = { char: character.name, user: userName };

  const historyMessages: ChatMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const messages: ChatMessage[] = [];
  const trace: AssembledContext["trace"] = [];
  let hasUserBlock = false;

  // 老编排里可能没有这两块：开关 / 有内容时也补一条，保证提示词一定在上下文里。
  // 位置放在空间系统提示之后（没有系统块就放在最前），别抢在设定前面。
  const needsCharacterFallback =
    !blocks.some((block) => block.kind === "character") && Boolean(character.systemPrompt.trim());
  let characterFallbackDone = !needsCharacterFallback;
  const pushCharacterFallback = () => {
    if (characterFallbackDone) return;
    characterFallbackDone = true;
    const content = interpolate(character.systemPrompt, charVars).trim();
    if (!content) return;
    messages.push({ role: "system", content });
    trace.push({
      blockId: "character-fallback",
      kind: "character",
      count: 1,
      note: `system · ${content.length} 字`,
    });
  };

  const needsImageFallback = imageEnabled && !blocks.some((block) => block.kind === "image");
  let imageFallbackDone = !needsImageFallback;
  const pushImageFallback = () => {
    if (imageFallbackDone) return;
    imageFallbackDone = true;
    const content = interpolate(DEFAULT_IMAGE_DIRECTIVE, charVars);
    messages.push({ role: "system", content });
    trace.push({ blockId: "image-preset", kind: "image", count: 1, note: `system · ${content.length} 字` });
  };

  // 连系统块都没有：两个兜底直接打头，别落到历史后面去
  if (!blocks.some((block) => block.kind === "system")) {
    pushCharacterFallback();
    pushImageFallback();
  }

  for (const block of blocks) {
    if (!block.enabled) {
      trace.push({ blockId: block.id, kind: block.kind, count: 0, note: "已禁用" });
      if (block.kind === "system") {
        pushCharacterFallback();
        pushImageFallback();
      }
      continue;
    }
    switch (block.kind) {
      case "system": {
        const text = space.systemPrompt?.trim();
        if (!text) {
          trace.push({ blockId: block.id, kind: block.kind, count: 0, note: "空间未填写共享提示" });
          break;
        }
        const content = interpolate(text, charVars);
        messages.push({ role: "system", content });
        trace.push({ blockId: block.id, kind: block.kind, count: 1, note: `system · ${text.length} 字` });
        break;
      }
      case "character": {
        const text = character.systemPrompt?.trim();
        if (!text) {
          trace.push({ blockId: block.id, kind: block.kind, count: 0, note: "当前角色未填写专属提示" });
          break;
        }
        const content = interpolate(text, charVars);
        messages.push({ role: "system", content });
        trace.push({ blockId: block.id, kind: block.kind, count: 1, note: `system · ${text.length} 字` });
        break;
      }
      case "image": {
        if (!imageEnabled) {
          trace.push({ blockId: block.id, kind: block.kind, count: 0, note: "图生图未开启" });
          break;
        }
        const content = interpolate(block.content, charVars).trim();
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
        const content = interpolate(block.content, { ...charVars, input }).trim();
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
    if (block.kind === "system") {
      pushCharacterFallback();
      pushImageFallback();
    }
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

const UNKNOWN_BLOCK_META = {
  label: "未知块",
  hint: "来自更早的版本，可以删掉",
  tone: "bg-surface-3 text-fg-muted",
};

/**
 * 块类型 → 展示文案。
 * 入参放宽到 string：数据库里的 jsonb 是历史数据，块类型可能是这一版已经不认的值
 * （或者干脆缺字段）。以前这里 switch 没有 default，取到 `.tone` 就整页崩，
 * 所以现在任何不认识的 kind 都落到「未知块」，界面不至于白屏。
 */
export function blockKindMeta(kind: ContextBlock["kind"] | string | undefined): {
  label: string;
  hint: string;
  tone: string;
} {
  switch (kind) {
    case "system":
      return { label: "空间系统提示", hint: "来自空间设置", tone: "bg-primary-container text-on-primary-container" };
    case "character":
      return { label: "角色专属提示", hint: "来自当前角色", tone: "bg-primary-container text-on-primary-container" };
    case "history":
      return { label: "历史对话", hint: "下标可填负数", tone: "bg-surface-3 text-fg-muted" };
    case "custom":
      return { label: "自定义提示词", hint: "建议写设定补充", tone: "bg-secondary-container text-on-primary-container" };
    case "image":
      return { label: "生图 JSON 预设", hint: "顶栏开关控制", tone: "bg-secondary-container text-on-primary-container" };
    case "user":
      return { label: "用户回复", hint: "当前输入", tone: "bg-surface-2 text-fg" };
    default:
      return UNKNOWN_BLOCK_META;
  }
}

/** 已知的块类型；读数时用它筛掉脏数据，也用来判断某个块还能不能编辑 */
export const CONTEXT_BLOCK_KINDS = ["system", "character", "history", "custom", "image", "user"] as const;

export function isKnownBlockKind(kind: unknown): kind is ContextBlock["kind"] {
  return typeof kind === "string" && (CONTEXT_BLOCK_KINDS as readonly string[]).includes(kind);
}

/**
 * 把库里的 jsonb 编排规整成能渲染的块数组。
 *
 * 有一段开发期的 `jsonb_agg` 写法把整行当元素聚合了，库里留下了
 * `{ elem: {…真块…}, ord: 1 }` 这种被套了一层的块：它没有 `kind`，
 * 点到「上下文」页就在 `blockKindMeta(...).tone` 上白屏。这里顺手解包，
 * 并给缺字段的块补默认值。
 *
 * 不认识的 kind 原样保留（只补 id / enabled）——让用户自己看见再删，
 * 比读的时候悄悄吞掉安全。
 */
export function normalizeContextBlocks(value: unknown): ContextBlock[] {
  if (!Array.isArray(value)) return [];
  const out: ContextBlock[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const wrapped = row.elem && typeof row.elem === "object" && !("kind" in row);
    const block = wrapped ? (row.elem as Record<string, unknown>) : row;
    if (wrapped) console.warn("[context] 解包了一个被套层的编排块（早期聚合写法留下的）", row);
    // 连 kind 都没有的块留着也渲染不出来，直接跳过
    if (typeof block.kind !== "string" || !block.kind) continue;
    out.push({
      ...(block as object),
      id: typeof block.id === "string" && block.id ? block.id : newBlockId(),
      kind: block.kind,
      enabled: block.enabled !== false,
    } as ContextBlock);
  }
  return out;
}
