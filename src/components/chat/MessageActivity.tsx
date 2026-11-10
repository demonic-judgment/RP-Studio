import { useEffect, useMemo, useState } from "react";
import {
  AgentActivity,
  agentActivityMessages,
  type AgentActivityItem,
} from "../agents/agent-activity";
import { ThinkingShimmer } from "../agents/loading-states/thinking-shimmer";
import type { Message } from "../../lib/types";

/** 运行期日志：工作流节点在执行时实时推给 store */
export interface RunLog {
  nodeTitle: string;
  message: string;
  level: string;
}

interface MessageActivityProps {
  message: Message;
  /** 这条消息正在写入 */
  running?: boolean;
  /** 本次运行的起始时间（毫秒时间戳），用来跑计时 */
  startedAt?: number | null;
  /** 流式期间的实时日志；不传时回落到 message.meta.logs */
  liveLogs?: RunLog[];
}

/**
 * 落库后的日志是 `[节点] 消息` 的字符串，运行期是结构化对象，
 * 这里把两种来源归一成同一条活动流。
 */
function parseLogs(logs?: string[]): RunLog[] {
  if (!logs?.length) return [];
  return logs.map((line) => {
    const matched = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(line);
    return matched
      ? { nodeTitle: matched[1], message: matched[2], level: "info" }
      : { nodeTitle: "", message: line, level: "info" };
  });
}

function formatElapsed(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`;
}

/**
 * 消息顶部的活动流：运行期显示当前阶段 + 计时，结束后收成一行可展开的执行轨迹。
 *
 * 后端只回正文、不回推理文本，所以「思考」这一段实际不存在——
 * 计时直接挂在「正在回复」上（见 agentActivityMessages.responding）。
 * 等模型开始返回 reasoning_content（MessageMeta.reasoning）时，
 * 这里会自动切回「正在思考 → 正在回复」，并把推理文本作为一条 text 项折叠进来。
 */
export function MessageActivity({
  message,
  running = false,
  startedAt,
  liveLogs,
}: MessageActivityProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [running]);

  const logs = running ? (liveLogs ?? []) : parseLogs(message.meta.logs);

  const items = useMemo<AgentActivityItem[]>(() => {
    const next: AgentActivityItem[] = [];
    if (message.meta.reasoning) {
      next.push({
        id: "reasoning",
        type: "text",
        content: message.meta.reasoning,
      });
    }
    logs.forEach((log, index) => {
      next.push({
        id: `${index}-${log.nodeTitle}`,
        type: "step",
        label: log.level === "error" ? `失败：${log.message}` : log.message,
        meta: log.nodeTitle || undefined,
        status: running && index === logs.length - 1 ? "active" : "complete",
      });
    });
    return next;
  }, [logs, message.meta.reasoning, running]);

  // 已经落库、又没有轨迹可看的消息不占位置
  if (!running && items.length === 0) return null;

  const duration = running
    ? startedAt
      ? Math.max(0, (now - startedAt) / 1000)
      : 0
    : Math.max(0, (message.meta.durationMs ?? 0) / 1000);

  const thinking = Boolean(message.meta.reasoning) && !message.content;

  return (
    <AgentActivity
      items={items}
      status={running ? "working" : "complete"}
      duration={duration}
      activeLabel={thinking ? agentActivityMessages.thinking : agentActivityMessages.responding}
      renderWorkingStatus={({ label, duration: elapsed }) => (
        <ThinkingShimmer className="truncate">
          {label}
          <span className="ml-1.5 font-normal tabular-nums">{formatElapsed(elapsed)}</span>
        </ThinkingShimmer>
      )}
      maxHeight={200}
      className="mb-1"
    />
  );
}
