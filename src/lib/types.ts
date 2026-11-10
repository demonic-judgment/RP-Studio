/** 领域模型 —— 数据库行、内存对象、工作流结构都以此为准 */

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

/* ------------------------------- 上下文块 ------------------------------- */

export interface ContextBlockBase {
  id: string;
  enabled: boolean;
  label?: string;
}

/** 角色系统提示词（来自角色卡的 systemPrompt） */
export interface SystemBlock extends ContextBlockBase {
  kind: "system";
}

/** 历史对话切片，from/to 支持负数下标：[-5,-1] = 倒数第 5 条到倒数第 1 条 */
export interface HistoryBlock extends ContextBlockBase {
  kind: "history";
  from: number;
  to: number;
}

/** 自定义提示词，可指定 role */
export interface CustomBlock extends ContextBlockBase {
  kind: "custom";
  role: Role;
  content: string;
}

/** 当前用户输入 */
export interface UserBlock extends ContextBlockBase {
  kind: "user";
}

export type ContextBlock = SystemBlock | HistoryBlock | CustomBlock | UserBlock;
export type ContextBlockKind = ContextBlock["kind"];

/* -------------------------------- 角色卡 -------------------------------- */

export interface QuickPhrase {
  id: string;
  label: string;
  content: string;
}

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 额外参数，JSON 文本，原样透传给后端 */
  params: string;
}

export type ModelOverride = Partial<ModelConfig>;

export interface Character {
  id: string;
  name: string;
  avatar: string;
  tagline: string;
  description: string;
  /** 初始消息：新建会话时作为角色的第一条消息写入 */
  greeting: string;
  systemPrompt: string;
  contextBlocks: ContextBlock[];
  quickPhrases: QuickPhrase[];
  workflow: Workflow;
  script: string;
  modelOverride: ModelOverride;
  createdAt: string;
  updatedAt: string;
}

export type CharacterDraft = Omit<Character, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

/* -------------------------------- 会话 --------------------------------- */

export interface Session {
  id: string;
  characterId: string;
  title: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

export type MessageStatus = "streaming" | "done" | "error" | "stopped";

export interface MessageMeta {
  model?: string;
  error?: string;
  logs?: string[];
  durationMs?: number;
  edited?: boolean;
  viaWorkflow?: boolean;
  /** 由角色卡「初始消息」自动写入的开场白 */
  greeting?: boolean;
}

export interface Message {
  id: string;
  sessionId: string;
  role: Role;
  content: string;
  status: MessageStatus;
  meta: MessageMeta;
  createdAt: string;
}

/* -------------------------------- 工作流 -------------------------------- */

export type WorkflowNodeKind = "input" | "template" | "script" | "llm" | "output";

export interface TemplateNodeConfig {
  text: string;
  role: Role;
  /** append 追加为一条消息；replace 用结果替换整个消息栈 */
  mode: "append" | "replace";
}

export interface ScriptNodeConfig {
  code: string;
}

export interface LlmNodeConfig {
  /** 额外参数覆盖，JSON 文本 */
  params: string;
  /** 是否把结果写入会话 */
  persist: boolean;
}

export type WorkflowNodeConfig =
  | TemplateNodeConfig
  | ScriptNodeConfig
  | LlmNodeConfig
  | Record<string, never>;

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  title: string;
  x: number;
  y: number;
  config: WorkflowNodeConfig;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
}

export interface Workflow {
  enabled: boolean;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/* -------------------------------- 设置 --------------------------------- */

export type ThemeMode = "light" | "dark" | "system";
export type DrawerId = "left" | "settings" | "character" | null;

export interface AppSettings {
  theme: ThemeMode;
  accent: string;
  userName: string;
  model: ModelConfig;
  scriptTimeoutMs: number;
  stream: boolean;
  enterToSend: boolean;
  showTokenEstimate: boolean;
}

/* ------------------------------ 装配结果 -------------------------------- */

export interface AssembledContext {
  messages: ChatMessage[];
  /** 每个块的贡献说明，用于预览面板 */
  trace: { blockId: string; kind: ContextBlockKind; count: number; note: string }[];
  tokens: number;
}
