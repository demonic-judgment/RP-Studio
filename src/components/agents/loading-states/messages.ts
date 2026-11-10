/** 中文默认文案。单个实例可以传 `labels` 覆盖，也可以用 LocaleProvider 全局提供。 */
export const loadingStatesMessages = {
  thinking: "正在思考",
  churning: "处理中",
  inProgress: "{label}，进行中",
  reasoning: "推理",
  phraseThinking: "思考中",
  phraseReading: "读取上下文",
  phraseConnecting: "串联线索",
  phraseForming: "组织回复",
};

export type LoadingStatesMessages = typeof loadingStatesMessages;
