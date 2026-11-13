import raw from "../data/image-preset.json";

/**
 * 生图预设的唯一来源：`src/data/image-preset.json`。
 * 想改「让模型怎么输出提示词」或「默认编排长什么样」，改那个 JSON 就行，
 * 这里只负责把它读成带类型的数据、并在字段缺失时兜底。
 */

/** 默认编排里的一块：`prompt` 那块由回复里的 JSON 自动填 */
export interface ImageBlockPreset {
  kind: "text" | "prompt";
  label: string;
  content?: string;
}

/** JSON 被改坏时的兜底：能出图，但不保证效果 */
const FALLBACK_DIRECTIVE =
  '【画面同步】每轮回复先输出一段 JSON 生图提示词（{"生图提示词": "……"}），再写正文，不要向 {{user}} 解释它的用途。';
const FALLBACK_SAMPLE = "表情：平静\n服饰：便服\n动作：站立";

const file = raw as {
  directive?: unknown;
  promptBlocks?: unknown;
  samplePrompt?: unknown;
};

function textOf(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readBlocks(value: unknown): ImageBlockPreset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ImageBlockPreset[] => {
    if (!item || typeof item !== "object") return [];
    const block = item as Record<string, unknown>;
    const kind = block.kind === "prompt" ? "prompt" : block.kind === "text" ? "text" : null;
    if (!kind) return [];
    const label = typeof block.label === "string" ? block.label.trim() : "";
    return [
      {
        kind,
        label: label || (kind === "prompt" ? "本轮生图提示词" : "硬编码提示词"),
        content: typeof block.content === "string" ? block.content : undefined,
      },
    ];
  });
}

function readPreset(): { directive: string; blocks: ImageBlockPreset[]; sample: string } {
  const directive = textOf(file.directive, "");
  const blocks = readBlocks(file.promptBlocks);
  // 「提示词」块是模型回复的落点，缺了就没法拼 prompt —— 无论如何补回来
  if (!blocks.some((block) => block.kind === "prompt")) {
    blocks.push({ kind: "prompt", label: "本轮生图提示词" });
  }
  const broken = !directive || blocks.length === 1;
  if (broken && import.meta.env.DEV) {
    console.warn("[image-preset] image-preset.json 缺少 directive 或 promptBlocks，已退回内置兜底");
  }
  return {
    directive: textOf(file.directive, FALLBACK_DIRECTIVE),
    blocks,
    sample: textOf(file.samplePrompt, FALLBACK_SAMPLE),
  };
}

const preset = readPreset();

/** 图生图开关打开时插进上下文的那条 system 指令 */
export const DEFAULT_IMAGE_DIRECTIVE = preset.directive;

/** 默认编排的块规格（不含 id / 启用状态） */
export const DEFAULT_IMAGE_BLOCK_SPECS: readonly ImageBlockPreset[] = preset.blocks;

/** 编排预览用的示例提示词 */
export const IMAGE_SAMPLE_PROMPT = preset.sample;
