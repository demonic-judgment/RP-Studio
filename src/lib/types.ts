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

/** 空间共享的系统提示词（来自空间设置的 systemPrompt） */
export interface SystemBlock extends ContextBlockBase {
  kind: "system";
}

/**
 * 当前角色的专属系统提示词（来自角色的 systemPrompt）。
 * 编排是空间的，所有角色共用一份；每个角色只替换这一块的文字。
 */
export interface CharacterPromptBlock extends ContextBlockBase {
  kind: "character";
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

/**
 * 图生图 JSON 预设：图生图开关打开时进入上下文的一条 system 指令，
 * 要求聊天模型在回复末尾附上「生图提示词」JSON。内容可在空间设置里改。
 */
export interface ImageDirectiveBlock extends ContextBlockBase {
  kind: "image";
  content: string;
}

export type ContextBlock =
  | SystemBlock
  | CharacterPromptBlock
  | HistoryBlock
  | CustomBlock
  | UserBlock
  | ImageDirectiveBlock;
export type ContextBlockKind = ContextBlock["kind"];

/* -------------------------------- 空间 --------------------------------- */

export interface QuickPhrase {
  id: string;
  label: string;
  content: string;
}

/** 一次请求实际用到的模型参数（由档案解析而来） */
export interface ModelConfig {
  /** 完整 endpoint，原样请求，不做路径拼接，例如 https://api.openai.com/v1/chat/completions */
  endpoint: string;
  apiKey: string;
  /**
   * 请求体参数，JSON 文本。model / stream / temperature / top_p 等都写在这里，
   * 应用只额外注入 messages。
   */
  params: string;
}

/** 全局保存的一条命名模型档案 */
export interface ModelProfile extends ModelConfig {
  id: string;
  /** 展示名，仅用于界面区分 */
  name: string;
}

/**
 * 一个空间：共享的舞台。
 * 提示词工程、上下文编排、工作流、脚本、底图库都挂在它身上 —— 空间里的角色共用这一套。
 */
export interface Space {
  id: string;
  name: string;
  avatar: string;
  /** 空间共享的系统提示词，由编排里的「空间系统提示」块注入 */
  systemPrompt: string;
  /**
   * 底图库：空间里可以导入多张，每个角色挑其中一张当自己的参考图。
   * 存 data URL 或外链。
   */
  imageSeeds: string[];
  contextBlocks: ContextBlock[];
  quickPhrases: QuickPhrase[];
  workflow: Workflow;
  script: string;
  createdAt: string;
  updatedAt: string;
}

export type SpaceDraft = Partial<Omit<Space, "id" | "createdAt" | "updatedAt">> & { id?: string };

/**
 * 空间里的一个角色：真正跟你对话的那一位。
 * 只放「这个人是谁」——名字、外貌、开场白、设定提示词，以及用空间哪张底图。
 */
export interface Character {
  id: string;
  spaceId: string;
  name: string;
  avatar: string;
  /** 初始消息：新建会话时作为角色的第一条消息写入 */
  greeting: string;
  /**
   * 角色设定提示词：由编排里的「角色专属提示」块注入，
   * 同时是会话首页展示给用户看的那段人物设定。
   */
  systemPrompt: string;
  /**
   * 从空间底图库里选中的那张（data URL 或外链）。图生图每轮拿它当参考重新画，
   * 不叠加上一张的结果；为空时退回空间底图库的第一张。
   */
  activeSeed: string;
  /** 同空间内的排序，越小越靠前 */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type CharacterDraft = Partial<Omit<Character, "id" | "createdAt" | "updatedAt">> & {
  id?: string;
  spaceId?: string;
};

/* -------------------------------- 会话 --------------------------------- */

export interface Session {
  id: string;
  /** 会话属于哪个空间：删空间时整层跟着走 */
  spaceId: string;
  /** 会话挂在哪个角色上：每个角色有自己独立的一套会话 */
  characterId: string;
  title: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

export type MessageStatus = "streaming" | "done" | "error" | "stopped";

/** 重新生成时留下的一版回答；按生成先后排列 */
export interface MessageVariant {
  content: string;
  createdAt: string;
  /** 这一版生成时的状态，切回来时一并还原（失败的那一版切走再切回不能丢） */
  status?: MessageStatus;
  /** 这一版正文里摘出来的生图提示词：切版本时画面也要跟着对上 */
  imagePrompt?: string;
}

export interface MessageMeta {
  model?: string;
  error?: string;
  logs?: string[];
  durationMs?: number;
  edited?: boolean;
  viaWorkflow?: boolean;
  /** 由角色「初始消息」自动写入的开场白 */
  greeting?: boolean;
  /**
   * 回答的历史版本（含当前这一版）。重新生成时沿用原消息的 id，
   * 把新回答追加进来，气泡底下的「‹ 2 / 3 ›」才能来回切。
   */
  variants?: MessageVariant[];
  /** 当前版本在 variants 里的下标；content 始终等于它 */
  variantIndex?: number;
  /**
   * 模型返回的推理文本（reasoning_content）。当前后端只透出正文，
   * 这条字段留给接上推理流之后使用：有值时活动流会先走「正在思考」。
   */
  reasoning?: string;
  /**
   * 从这条回复里摘出来的生图提示词（回复正文里的那段 JSON 不会进气泡）。
   * 存 raw 而不是拼装结果：提示词块改了之后重新生图应该跟着新编排走。
   */
  imagePrompt?: string;
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

/* -------------------------------- 生图 --------------------------------- */

/**
 * edit = 图生图：multipart 上传底图打到 /v1/images/edits（默认，推荐）。
 * generate = 文生图：整体 JSON 打到 /v1/images/generations（没有底图时的退路）。
 */
export type ImageModelMode = "edit" | "generate";

export interface ImageProfile {
  id: string;
  /** 展示名，仅用于界面区分 */
  name: string;
  /** 完整 endpoint，原样请求，不做路径拼接 */
  endpoint: string;
  apiKey: string;
  /**
   * 请求参数，JSON 文本。multipart 模式逐字段写进表单，JSON 模式整体作为请求体；
   * 应用只额外注入 prompt（图生图还会注入 image 文件）。
   */
  params: string;
  mode: ImageModelMode;
}

export interface ImagePromptTextBlock {
  id: string;
  kind: "text";
  enabled: boolean;
  label?: string;
  /** 支持 {{char}} / {{user}} / {{prompt}} */
  content: string;
}

/** 模型返回的生图提示词插入点；位置决定它在最终提示词里的先后 */
export interface ImagePromptPromptBlock {
  id: string;
  kind: "prompt";
  enabled: boolean;
  label?: string;
}

export type ImagePromptBlock = ImagePromptTextBlock | ImagePromptPromptBlock;
export type ImagePromptBlockKind = ImagePromptBlock["kind"];

/** 悬浮画面组件的位置与宽度（px，宽度是绝对值，默认按聊天列宽的一半算出来） */
export interface ImageWidgetGeometry {
  x: number;
  y: number;
  width: number;
}

/**
 * 一张生成结果。二维结构：
 * - 第一维 `messageId` —— 绑定哪条聊天气泡；
 * - 第二维同 `messageId` 下的多条记录 —— 这个气泡的多次重新生图，按 createdAt 排列。
 * 重新生图只追加新行，旧图一律保留。
 */
export interface MessageImage {
  id: string;
  sessionId: string;
  /** 生成时正在对话的那个角色 */
  characterId: string;
  messageId: string;
  /** 实际送进模型的完整提示词（提示词块拼装后的结果） */
  prompt: string;
  /** 从回复 JSON 里取到的原始提示词，重新生图时复用它 */
  rawPrompt: string;
  /** 这次用的底图；固定底图模式下通常为 null（表示用的是角色选中的那张） */
  baseImageId: string | null;
  url: string;
  model: string;
  status: "done" | "error";
  error?: string;
  createdAt: string;
}

/** 正在生图 / 上一次失败的状态，和聊天的 stream 分开，聊天可以继续 */
export interface ImageRunState {
  running: boolean;
  sessionId: string | null;
  messageId: string | null;
  startedAt: number | null;
  error: string | null;
}

/* -------------------------------- 设置 --------------------------------- */

export type ThemeMode = "light" | "dark" | "system";
export type DrawerId = "left" | "settings" | "space" | "character" | null;

/**
 * 主页最底层背景图。`url` 既可能是外链，也可能是本地上传后压成的 data URL
 * （图片直接进 settings 的 jsonb，不另建表；上传时统一缩到长边 2560 再转 webp）。
 */
export interface BackgroundConfig {
  url: string;
  /** 图片自身不透明度，0.1-1 */
  opacity: number;
  /** 高斯模糊半径（px），0-24 */
  blur: number;
}

export interface AppSettings {
  theme: ThemeMode;
  accent: string;
  userName: string;
  /** 未设置时走默认的强调色光斑背景 */
  background?: BackgroundConfig;
  /** 模型档案列表，至少一条 */
  models: ModelProfile[];
  /** 当前激活档案的 id */
  activeModelId: string;
  /** 图生图总开关：关闭后不解析 / 不生成 / 不显示悬浮画面 */
  imageEnabled: boolean;
  /** 生图档案列表，至少一条；默认图生图 */
  imageModels: ImageProfile[];
  /** 当前激活的生图档案 id */
  activeImageModelId: string;
  /** 生图提示词的硬编码块，顺序即拼装顺序 */
  imagePromptBlocks: ImagePromptBlock[];
  /** 悬浮画面组件的位置与宽度，未设置时按聊天列宽的一半初始化 */
  imageWidget?: ImageWidgetGeometry;
  scriptTimeoutMs: number;
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
