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
}): AssembledContext {
  const { character, history, input, userName = "你" } = params;
  const blocks = character.contextBlocks ?? [];

  const historyMessages: ChatMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const messages: ChatMessage[] = [];
  const trace: AssembledContext["trace"] = [];
  let hasUserBlock = false;

  for (const block of blocks) {
    if (!block.enabled) {
      trace.push({ blockId: block.id, kind: block.kind, count: 0, note: "已禁用" });
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
    case "user":
      return { label: "用户回复", hint: "当前输入", tone: "bg-surface-2 text-fg" };
  }
}
