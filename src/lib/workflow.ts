import { chatCompletion } from "./llm";
import { interpolate } from "./context";
import { runScript } from "./script";
import { paramModel } from "./settings";
import type {
  Character,
  ChatMessage,
  ModelConfig,
  Role,
  TemplateNodeConfig,
  ScriptNodeConfig,
  LlmNodeConfig,
  Workflow,
  WorkflowNode,
  WorkflowNodeKind,
} from "./types";
import { safeJsonParse, uid } from "./utils";

/* ------------------------------- 节点构造 -------------------------------- */

export function createNode(kind: WorkflowNodeKind, x: number, y: number): WorkflowNode {
  const base = { id: uid("node"), kind, x, y };
  switch (kind) {
    case "input":
      return { ...base, title: "用户输入", config: {} };
    case "template":
      return {
        ...base,
        title: "提示词模板",
        config: {
          text: "{{input}}",
          role: "system" as Role,
          mode: "append" as const,
        },
      };
    case "script":
      return {
        ...base,
        title: "脚本处理",
        config: {
          code: `// ctx.messages 可读写，返回字符串或 { text, messages }\nlog("收到 " + ctx.messages.length + " 条消息");\nreturn ctx.input;`,
        },
      };
    case "llm":
      return { ...base, title: "模型调用", config: { params: "", persist: true } };
    case "output":
      return { ...base, title: "输出", config: {} };
  }
}

export const NODE_META: Record<
  WorkflowNodeKind,
  { label: string; hint: string; color: string; icon: string }
> = {
  input: { label: "输入", hint: "用户这句话", color: "#0b57d0", icon: "inbox" },
  template: { label: "模板", hint: "套一段固定话术", color: "#6750a4", icon: "braces" },
  script: { label: "脚本", hint: "改写或判断内容", color: "#8a6100", icon: "code" },
  llm: { label: "模型", hint: "让模型来写", color: "#00696d", icon: "sparkles" },
  output: { label: "输出", hint: "作为回复发出", color: "#3f6b32", icon: "flag" },
};

export function defaultWorkflow(): Workflow {
  const input = createNode("input", 80, 200);
  const llm = createNode("llm", 400, 200);
  const output = createNode("output", 720, 200);
  return {
    enabled: false,
    nodes: [input, llm, output],
    edges: [
      { id: uid("edge"), from: input.id, to: llm.id },
      { id: uid("edge"), from: llm.id, to: output.id },
    ],
  };
}

export function validateWorkflow(workflow: Workflow): string[] {
  const errors: string[] = [];
  const inputs = workflow.nodes.filter((n) => n.kind === "input");
  const outputs = workflow.nodes.filter((n) => n.kind === "output");
  if (inputs.length === 0) errors.push("缺少「输入」节点");
  if (outputs.length === 0) errors.push("缺少「输出」节点");
  if (workflow.edges.length === 0) errors.push("节点之间还没有连线");
  const ids = new Set(workflow.nodes.map((n) => n.id));
  for (const edge of workflow.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) errors.push("存在指向已删除节点的连线");
  }
  return errors;
}

/* -------------------------------- 执行器 --------------------------------- */

export interface WorkflowRunEvent {
  kind: "start" | "log" | "delta" | "end" | "error";
  nodeId?: string;
  nodeTitle?: string;
  message: string;
  level?: "info" | "warn" | "error";
}

export interface WorkflowRunResult {
  text: string;
  messages: ChatMessage[];
  errors: string[];
  logs: { nodeId: string; nodeTitle: string; message: string; level: string }[];
}

interface RunState {
  messages: ChatMessage[];
  text: string;
}

function nodeLogs(node: WorkflowNode, message: string, level: "info" | "warn" | "error" = "info") {
  return { nodeId: node.id, nodeTitle: node.title, message, level };
}

function interpolateNode(
  template: string,
  vars: Record<string, string>,
  outputs: Record<string, string>,
): string {
  const withNodes = template.replace(/\{\{\s*([\w-]+)\.output\s*\}\}/g, (_, id: string) => outputs[id] ?? "");
  return interpolate(withNodes, vars);
}

/**
 * 按出边深度优先执行工作流。
 * 输入节点以「上下文装配结果」作为初始消息栈，因此上下文编排与工作流可以叠加使用。
 */
export async function runWorkflow(params: {
  workflow: Workflow;
  character: Pick<Character, "name" | "systemPrompt" | "description">;
  initialMessages: ChatMessage[];
  input: string;
  userName: string;
  model: ModelConfig;
  signal?: AbortSignal;
  scriptTimeoutMs: number;
  onEvent?: (event: WorkflowRunEvent) => void;
}): Promise<WorkflowRunResult> {
  const {
    workflow,
    character,
    initialMessages,
    input,
    userName,
    model,
    signal,
    scriptTimeoutMs,
    onEvent,
  } = params;

  const logs: WorkflowRunResult["logs"] = [];
  const errors: string[] = [];
  const outputs: Record<string, string> = {};
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }

  let finalText = "";
  let finalMessages: ChatMessage[] = initialMessages;
  const historyText = initialMessages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const vars: Record<string, string> = {
    input,
    char: character.name,
    user: userName,
    history: historyText,
    time: new Date().toLocaleString("zh-CN"),
  };

  const entry = workflow.nodes.find((n) => n.kind === "input");
  if (!entry) {
    errors.push("工作流缺少输入节点，已回退到默认装配");
    return { text: "", messages: initialMessages, errors, logs };
  }

  const visit = async (node: WorkflowNode, state: RunState, depth: number): Promise<void> => {
    if (signal?.aborted) return;
    if (depth > 32) {
      errors.push("工作流层级过深，可能存在环");
      return;
    }
    onEvent?.({ kind: "start", nodeId: node.id, nodeTitle: node.title, message: `执行 ${node.title}` });

    let next: RunState = { messages: state.messages.map((m) => ({ ...m })), text: state.text };
    const pushLog = (message: string, level: "info" | "warn" | "error" = "info") => {
      logs.push(nodeLogs(node, message, level));
      onEvent?.({ kind: "log", nodeId: node.id, nodeTitle: node.title, message, level });
    };

    try {
      switch (node.kind) {
        case "input": {
          next = { messages: initialMessages.map((m) => ({ ...m })), text: input };
          pushLog(`载入上下文 ${initialMessages.length} 条 · 输入 ${input.length} 字`);
          break;
        }
        case "template": {
          const config = node.config as TemplateNodeConfig;
          const content = interpolateNode(config.text ?? "", vars, outputs).trim();
          if (config.mode === "replace") {
            next.messages = content ? [{ role: config.role ?? "system", content }] : [];
            next.text = content;
            pushLog(`替换消息栈为 ${config.role} 消息（${content.length} 字）`);
          } else if (content) {
            next.messages = [...next.messages, { role: config.role ?? "system", content }];
            next.text = content;
            pushLog(`追加 ${config.role} 消息（${content.length} 字）`);
          } else {
            pushLog("模板为空，跳过", "warn");
          }
          break;
        }
        case "script": {
          const config = node.config as ScriptNodeConfig;
          const result = await runScript(
            config.code ?? "",
            {
              messages: next.messages,
              input,
              vars,
              character,
              history: historyText,
            },
            scriptTimeoutMs,
            (line) => pushLog(line, "info"),
          );
          if (!result.ok) {
            errors.push(`${node.title}: ${result.error ?? "脚本失败"}`);
            pushLog(result.error ?? "脚本失败", "error");
          } else {
            if (result.messages?.length) {
              next.messages = result.messages as ChatMessage[];
              pushLog(`脚本重写消息栈（${next.messages.length} 条）`);
            }
            if (result.text) {
              next.text = result.text;
              next.messages = [...next.messages, { role: "assistant", content: result.text }];
            }
            pushLog(`脚本完成 · ${result.durationMs}ms`);
          }
          break;
        }
        case "llm": {
          const config = node.config as LlmNodeConfig;
          let nodeModel: ModelConfig = model;
          if (config.params?.trim()) {
            const parsed = safeJsonParse<Record<string, unknown>>(config.params);
            if (!parsed.ok) {
              errors.push(`${node.title}: 参数 JSON 无效（${parsed.error}）`);
              pushLog(`参数 JSON 无效：${parsed.error}`, "error");
            } else {
              const current = safeJsonParse<Record<string, unknown>>(model.params || "{}");
              const merged = {
                ...(current.ok ? current.value : {}),
                ...parsed.value,
              };
              nodeModel = { ...model, params: JSON.stringify(merged) };
            }
          }
          pushLog(`调用 ${paramModel(nodeModel.params)} · ${next.messages.length} 条消息`);
          const started = Date.now();
          const response = await chatCompletion({
            config: nodeModel,
            messages: next.messages,
            signal,
            onDelta: (_delta, full) => {
              onEvent?.({ kind: "delta", nodeId: node.id, nodeTitle: node.title, message: full });
            },
          });
          if (response.aborted) {
            pushLog("已停止生成", "warn");
            next.text = response.content;
            next.messages = [...next.messages, { role: "assistant", content: response.content }];
            return;
          }
          next.text = response.content;
          next.messages = [...next.messages, { role: "assistant", content: response.content }];
          pushLog(`完成 · ${Date.now() - started}ms · ${response.content.length} 字`);
          if (response.usage?.total_tokens) {
            pushLog(`用量 ${response.usage.prompt_tokens ?? "?"} → ${response.usage.completion_tokens ?? "?"} tokens`);
          }
          break;
        }
        case "output": {
          finalText = next.text;
          finalMessages = next.messages;
          pushLog(`输出 ${next.text.length} 字`);
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${node.title}: ${message}`);
      pushLog(message, "error");
      onEvent?.({ kind: "error", nodeId: node.id, nodeTitle: node.title, message });
      return;
    }

    outputs[node.id] = next.text;

    const targets = outgoing.get(node.id) ?? [];
    for (const targetId of targets) {
      const target = byId.get(targetId);
      if (target) await visit(target, { messages: next.messages, text: next.text }, depth + 1);
    }
  };

  await visit(entry, { messages: initialMessages, text: input }, 0);
  onEvent?.({ kind: "end", message: "工作流结束" });

  if (!finalText) {
    // 没有走到输出节点：退化为最后一个节点的文本
    finalText = Object.values(outputs).pop() ?? "";
  }

  return { text: finalText, messages: finalMessages, errors, logs };
}
