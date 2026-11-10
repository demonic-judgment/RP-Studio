/**
 * 中文默认文案。单个实例可以传 `labels` 覆盖，也可以用 LocaleProvider 全局提供。
 * 相比上游多一个 `responding`：后端只回正文、不回推理文本时，运行态标签直接用它。
 */
export const agentActivityMessages = {
  thinking: "正在思考",
  responding: "正在回复",
  searching: "正在检索",
  runningTools: "正在调用工具",
  workingTrace: "正在执行",
  workingMixed: "正在处理",
  thoughtFor: "思考 {duration}",
  respondedFor: "回复 {duration}",
  seconds: "{seconds} 秒",
  minutes: "{minutes} 分",
  minutesSeconds: "{minutes} 分 {seconds} 秒",
  searched: "已完成检索",
  ranToolsOne: "调用了 {count} 个工具",
  ranToolsOther: "调用了 {count} 个工具",
  traceSummary: "{toolCalls}，{messages}",
  toolCallsOne: "{count} 次工具调用",
  toolCallsOther: "{count} 次工具调用",
  messagesOne: "{count} 条消息",
  messagesOther: "{count} 条消息",
  completedStepsOne: "完成 {count} 个步骤",
  completedStepsOther: "完成 {count} 个步骤",
  moreResults: "另有 {count} 条",
  read: "读取",
  edit: "编辑",
  write: "写入",
  run: "运行",
};

export type AgentActivityMessages = typeof agentActivityMessages;

export type AgentActivityTranslate = (
  key: keyof AgentActivityMessages,
  values?: Record<string, string | number>,
) => string;
