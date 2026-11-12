import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Braces,
  Check,
  ChevronRight,
  Flag,
  Inbox,
  Maximize,
  Minus,
  Plus,
  Save,
  Sparkles,
  Terminal,
  Trash2,
  X,
  Code2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  Character,
  LlmNodeConfig,
  Message,
  ScriptNodeConfig,
  TemplateNodeConfig,
  Workflow,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeKind,
} from "../../lib/types";
import { createNode, NODE_META, runWorkflow, validateWorkflow } from "../../lib/workflow";
import { assembleContext } from "../../lib/context";
import { useStore } from "../../lib/store";
import { activeProfile, paramModel, resolveModelConfig } from "../../lib/settings";
import { safeJsonParse, uid } from "../../lib/utils";
import { Button, IconButton } from "../ui/Button";
import { Segmented } from "../ui/Tabs";
import { Switch } from "../ui/Form";

const NODE_W = 212;
const PORT_Y = 34;

const KIND_ICON: Record<WorkflowNodeKind, React.ReactNode> = {
  input: <Inbox size={13} />,
  template: <Braces size={13} />,
  script: <Code2 size={13} />,
  llm: <Sparkles size={13} />,
  output: <Flag size={13} />,
};

export function WorkflowEditor({
  open,
  workflow,
  character,
  messages,
  userName,
  onClose,
  onChange,
}: {
  open: boolean;
  workflow: Workflow;
  character: Character;
  messages: Message[];
  userName: string;
  onClose: () => void;
  onChange: (workflow: Workflow) => void;
}) {
  const settings = useStore((s) => s.settings);
  const toast = useStore((s) => s.toast);

  const [graph, setGraph] = useState<Workflow>(workflow);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState({ x: 40, y: 40, scale: 1 });
  const [linking, setLinking] = useState<{ from: string; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const [testInput, setTestInput] = useState("你好，介绍一下你自己。");
  const [running, setRunning] = useState(false);
  const [runLogs, setRunLogs] = useState<{ node: string; message: string; level: string }[]>([]);
  const [runResult, setRunResult] = useState<{ text: string; errors: string[] } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const fitToContent = useCallback((nodes: WorkflowNode[]) => {
    if (!nodes.length) return;
    const w = wrapRef.current?.clientWidth ?? 900;
    const h = wrapRef.current?.clientHeight ?? 600;
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + NODE_W));
    const maxY = Math.max(...nodes.map((n) => n.y + 130));
    const scale = Math.min(1, Math.max(0.35, Math.min((w - 110) / (maxX - minX), (h - 130) / (maxY - minY))));
    setView({
      x: (w - (maxX - minX) * scale) / 2 - minX * scale,
      y: Math.max(28, (h - (maxY - minY) * scale) * 0.4) - minY * scale,
      scale,
    });
  }, []);

  useEffect(() => {
    if (open) {
      setGraph(workflow);
      setSelected(null);
      setRunLogs([]);
      setRunResult(null);
      requestAnimationFrame(() => fitToContent(workflow.nodes));
    }
    // 只在打开时同步一次，避免父级保存后重置画布视图
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const errors = useMemo(() => validateWorkflow(graph), [graph]);
  const dirty = JSON.stringify(graph) !== JSON.stringify(workflow);
  const selectedNode = graph.nodes.find((n) => n.id === selected) ?? null;

  const requestClose = () => {
    if (dirty && !window.confirm("工作流有未应用的修改，关闭后本次调整会丢失。继续关闭？")) return;
    onClose();
  };

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
      return {
        x: (clientX - rect.left - view.x) / view.scale,
        y: (clientY - rect.top - view.y) / view.scale,
      };
    },
    [view],
  );

  const updateNode = (id: string, patch: Partial<WorkflowNode>) => {
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  };

  const patchConfig = (id: string, config: Record<string, unknown>) => {
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) =>
        n.id === id ? { ...n, config: { ...n.config, ...config } as WorkflowNode["config"] } : n,
      ),
    }));
  };

  const removeNode = (id: string) => {
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.filter((n) => n.id !== id),
      edges: g.edges.filter((e) => e.from !== id && e.to !== id),
    }));
    setSelected(null);
  };

  const addEdge = (from: string, to: string) => {
    if (from === to) return;
    setGraph((g) => {
      if (g.edges.some((e) => e.from === from && e.to === to)) return g;
      const edge: WorkflowEdge = { id: uid("edge"), from, to };
      return { ...g, edges: [...g.edges, edge] };
    });
  };

  const connectByPointer = (clientX: number, clientY: number) => {
    if (!linking) return;
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const nodeEl = el?.closest("[data-node-id]") as HTMLElement | null;
    if (nodeEl?.dataset.nodeId) addEdge(linking.from, nodeEl.dataset.nodeId);
    setLinking(null);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (linking) setLinking(null);
        else requestClose();
      }
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      if ((e.key === "Delete" || e.key === "Backspace") && selected && !typing) {
        e.preventDefault();
        removeNode(selected);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected, linking, onClose, dirty]);

  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const delta = -e.deltaY * 0.0015;
    const next = Math.min(1.6, Math.max(0.45, view.scale * (1 + delta)));
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const wx = (px - view.x) / view.scale;
    const wy = (py - view.y) / view.scale;
    setView({ scale: next, x: px - wx * next, y: py - wy * next });
  };

  const runTest = async () => {
    setRunning(true);
    setRunLogs([]);
    setRunResult(null);
    const assembled = assembleContext({
      character,
      history: messages,
      input: testInput,
      userName,
      imageEnabled: settings.imageEnabled,
    });
    const model = resolveModelConfig(settings);
    const result = await runWorkflow({
      workflow: graph,
      character,
      initialMessages: assembled.messages,
      input: testInput,
      userName,
      model,
      scriptTimeoutMs: settings.scriptTimeoutMs,
      onEvent: (event) => {
        if (event.kind === "log" || event.kind === "error") {
          setRunLogs((prev) => [
            ...prev,
            { node: event.nodeTitle ?? "系统", message: event.message, level: event.level ?? "info" },
          ]);
        }
      },
    });
    setRunResult({ text: result.text, errors: result.errors });
    setRunning(false);
  };

  if (!open) return null;

  const summary = (node: WorkflowNode) => {
    if (node.kind === "template") {
      const c = node.config as TemplateNodeConfig;
      return `${c.role} · ${c.mode} · ${(c.text ?? "").slice(0, 24) || "空模板"}`;
    }
    if (node.kind === "script") {
      const c = node.config as ScriptNodeConfig;
      return `${(c.code ?? "").split("\n").length} 行脚本`;
    }
    if (node.kind === "llm") {
      const c = node.config as LlmNodeConfig;
      return c.params?.trim() ? "参数覆盖已启用" : paramModel(resolveModelConfig(settings).params) || "使用全局模型";
    }
    if (node.kind === "input") return "上下文装配结果 + 用户输入";
    return "写入最终回复";
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-container text-on-primary-container">
            <Braces size={15} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-fg">
              <span className="hidden sm:inline">工作流编排 · </span>
              {character.name}
            </p>
            <p className="hidden truncate text-[10.5px] text-fg-subtle sm:block">
              {graph.nodes.length} 节点 · {graph.edges.length} 连线
            </p>
          </div>
        </div>

        <div className="ml-3 flex min-w-0 flex-1 items-center gap-1.5">
          {errors.length === 0 ? (
            <span className="hidden items-center gap-1 rounded-full bg-success/10 px-inset-pill py-1.5 text-[10.5px] text-success sm:flex">
              <Check size={11} /> 结构完整
            </span>
          ) : (
            <span className="hidden items-center gap-1 rounded-full bg-warning/10 px-inset-pill py-1.5 text-[10.5px] text-warning sm:flex">
              {errors[0]}
            </span>
          )}
          {dirty && <span className="text-[10.5px] text-fg-subtle">未保存</span>}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div className="mr-1 hidden items-center gap-2 sm:flex">
            <span className="text-[11px] text-fg-muted">启用</span>
            <Switch
              checked={graph.enabled}
              onChange={(enabled) => setGraph((g) => ({ ...g, enabled }))}
              label="启用工作流"
            />
          </div>
          <Button size="sm" variant="outline" onClick={runTest} disabled={running} leading={<Sparkles size={13} />}>
            {running ? "运行中…" : "试运行"}
          </Button>
          <Button
            size="sm"
            variant="primary"
            leading={<Save size={13} />}
            onClick={() => {
              onChange(graph);
              toast({ title: "已应用到角色卡", description: "记得在角色卡里保存", variant: "success" });
            }}
          >
            应用
          </Button>
          <IconButton label="退出全屏" onClick={requestClose} className="h-8 w-8">
            <X size={16} />
          </IconButton>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* 画布 */}
        <div
          ref={wrapRef}
          className="relative min-w-0 flex-1 overflow-hidden bg-bg"
          style={{
            backgroundImage:
              "radial-gradient(color-mix(in oklab, var(--fg) 12%, transparent) 1px, transparent 1px)",
            backgroundSize: `${22 * view.scale}px ${22 * view.scale}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
          onPointerMove={(e) => {
            if (panning) {
              setView((v) => ({ ...v, x: panning.ox + (e.clientX - panning.sx), y: panning.oy + (e.clientY - panning.sy) }));
            }
            if (linking) {
              const world = toWorld(e.clientX, e.clientY);
              setLinking({ ...linking, x: world.x, y: world.y });
            }
          }}
          onPointerUp={(e) => {
            setPanning(null);
            if (linking) connectByPointer(e.clientX, e.clientY);
          }}
          onPointerLeave={() => setPanning(null)}
          onWheel={onWheel}
        >
          <div
            ref={canvasRef}
            className="absolute inset-0"
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget) return;
              setSelected(null);
              setPanning({ sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y });
            }}
          >
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            >
              <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
                {graph.edges.map((edge) => {
                  const from = graph.nodes.find((n) => n.id === edge.from);
                  const to = graph.nodes.find((n) => n.id === edge.to);
                  if (!from || !to) return null;
                  const x1 = from.x + NODE_W;
                  const y1 = from.y + PORT_Y;
                  const x2 = to.x;
                  const y2 = to.y + PORT_Y;
                  const dx = Math.max(56, Math.abs(x2 - x1) * 0.5);
                  const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
                  return (
                    <g key={edge.id}>
                      <path d={path} stroke="var(--border-strong)" strokeWidth={2} fill="none" />
                      <path d={path} stroke="var(--primary)" strokeWidth={1.5} fill="none" strokeDasharray="3 5" opacity={0.55} />
                      <circle cx={x2} cy={y2} r={3} fill="var(--primary)" />
                    </g>
                  );
                })}
                {linking &&
                  (() => {
                    const from = graph.nodes.find((n) => n.id === linking.from);
                    if (!from) return null;
                    const x1 = from.x + NODE_W;
                    const y1 = from.y + PORT_Y;
                    const x2 = linking.x;
                    const y2 = linking.y;
                    const dx = Math.max(56, Math.abs(x2 - x1) * 0.5);
                    return (
                      <path
                        d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                        stroke="var(--primary)"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        fill="none"
                      />
                    );
                  })()}
              </svg>

              {graph.nodes.map((node) => {
                const meta = NODE_META[node.kind];
                return (
                  <div
                    key={node.id}
                    data-node-id={node.id}
                    onPointerDown={(e) => {
                      setSelected(node.id);
                      e.stopPropagation();
                    }}
                    className="absolute rounded-2xl bg-surface shadow-card transition-shadow"
                    style={{
                      left: node.x,
                      top: node.y,
                      width: NODE_W,
                      boxShadow:
                        selected === node.id
                          ? "0 0 0 3px color-mix(in oklab, var(--primary) 22%, transparent), var(--shadow-md)"
                          : undefined,
                    }}
                  >
                    <div
                      className="flex cursor-grab items-center gap-2 rounded-t-2xl border-b border-line px-inset-sm py-2.5 active:cursor-grabbing"
                      onPointerDown={(e) => {
                        if ((e.target as HTMLElement).closest("[data-port]")) return;
                        e.stopPropagation();
                        setSelected(node.id);
                        const startX = e.clientX;
                        const startY = e.clientY;
                        const originX = node.x;
                        const originY = node.y;
                        const move = (ev: PointerEvent) => {
                          updateNode(node.id, {
                            x: Math.round(originX + (ev.clientX - startX) / view.scale),
                            y: Math.round(originY + (ev.clientY - startY) / view.scale),
                          });
                        };
                        const up = () => {
                          document.removeEventListener("pointermove", move);
                          document.removeEventListener("pointerup", up);
                        };
                        document.addEventListener("pointermove", move);
                        document.addEventListener("pointerup", up);
                      }}
                    >
                      <span
                        className="flex h-5 w-5 items-center justify-center rounded-md"
                        style={{ background: `color-mix(in oklab, ${meta.color} 16%, transparent)`, color: meta.color }}
                      >
                        {KIND_ICON[node.kind]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg">{node.title}</span>
                      <span className="font-mono text-[9px] uppercase tracking-wide text-fg-subtle">{node.kind}</span>
                    </div>
                    <div className="px-2.5 py-2 text-[10.5px] leading-relaxed text-fg-subtle">
                      <p className="line-clamp-2">{summary(node)}</p>
                    </div>
                    {node.kind !== "input" && (
                      <div
                        data-port="in"
                        onPointerUp={(e) => {
                          e.stopPropagation();
                          if (linking) addEdge(linking.from, node.id);
                          setLinking(null);
                        }}
                        className="absolute -left-[7px] top-[27px] h-3.5 w-3.5 rounded-full border-2 border-surface bg-primary/70 transition-transform hover:scale-125"
                        title="输入"
                      />
                    )}
                    {node.kind !== "output" && (
                      <div
                        data-port="out"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          const world = toWorld(e.clientX, e.clientY);
                          setLinking({ from: node.id, x: world.x, y: world.y });
                        }}
                        className="absolute -right-[7px] top-[27px] h-3.5 w-3.5 cursor-crosshair rounded-full border-2 border-surface bg-primary transition-transform hover:scale-125"
                        title="拖出连线"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 节点面板 */}
          <div className="absolute left-3 top-3 z-10 w-[148px] rounded-2xl bg-surface/95 p-inset-tight shadow-card backdrop-blur dark:bg-surface-2/95">
            <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-subtle">
              添加节点
            </p>
            <div className="space-y-0.5">
              {(["template", "script", "llm", "output", "input"] as WorkflowNodeKind[]).map((kind) => {
                const meta = NODE_META[kind];
                return (
                  <button
                    key={kind}
                    onClick={() => {
                      const anchor = graph.nodes.find((n) => n.id === selected);
                      const index = graph.nodes.length;
                      const x = anchor ? anchor.x + NODE_W + 64 : 80 + (index % 4) * 60;
                      const y = anchor ? anchor.y + 40 : 80 + index * 48;
                      const node = createNode(kind, x, y);
                      setGraph((g) => ({ ...g, nodes: [...g.nodes, node] }));
                      setSelected(node.id);
                    }}
                    className="flex w-full items-center gap-1.5 rounded-lg px-inset-sm py-2 text-left text-[11px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                  >
                    <span style={{ color: meta.color }}>{KIND_ICON[kind]}</span>
                    {meta.label}
                    <Plus size={10} className="ml-auto text-fg-subtle" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* 缩放 */}
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-0.5 rounded-xl bg-surface/95 p-inset-tight shadow-card backdrop-blur dark:bg-surface-2/95">
            <IconButton label="缩小" onClick={() => setView((v) => ({ ...v, scale: Math.max(0.45, v.scale - 0.1) }))}>
              <ZoomOut size={14} />
            </IconButton>
            <button
              onClick={() => setView({ x: 40, y: 40, scale: 1 })}
              className="min-w-[46px] rounded-md px-inset-tight py-1.5 text-[10.5px] tabular-nums text-fg-muted hover:bg-surface-2"
            >
              {Math.round(view.scale * 100)}%
            </button>
            <IconButton label="放大" onClick={() => setView((v) => ({ ...v, scale: Math.min(1.6, v.scale + 0.1) }))}>
              <ZoomIn size={14} />
            </IconButton>
            <IconButton
              label="适应画布"
              onClick={() => fitToContent(graph.nodes)}
            >
              <Maximize size={13} />
            </IconButton>
          </div>

          {/* 运行日志 */}
          {(runLogs.length > 0 || runResult || running) && (
            <div className="absolute bottom-3 left-1/2 z-10 w-[min(520px,calc(100%-24px))] -translate-x-1/2 overflow-hidden rounded-2xl bg-surface/95 shadow-float backdrop-blur dark:bg-surface-2/95">
              <div className="flex items-center justify-between border-b border-line px-inset-sm py-2">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-fg-muted">
                  <Terminal size={12} /> 试运行
                </span>
                <div className="flex items-center gap-2">
                  {runResult && (
                    <span className={`text-[10.5px] ${runResult.errors.length ? "text-danger" : "text-success"}`}>
                      {runResult.errors.length ? `${runResult.errors.length} 个错误` : "完成"}
                    </span>
                  )}
                  <button onClick={() => { setRunLogs([]); setRunResult(null); }} className="text-fg-subtle hover:text-fg">
                    <X size={12} />
                  </button>
                </div>
              </div>
              <div className="max-h-36 overflow-y-auto px-3 py-2 font-mono text-[10.5px] leading-relaxed">
                {runLogs.map((log, i) => (
                  <div key={i} className="flex gap-1.5">
                    <span className="shrink-0 text-fg-subtle">[{log.node}]</span>
                    <span className={log.level === "error" ? "text-danger" : "text-fg-muted"}>{log.message}</span>
                  </div>
                ))}
                {running && <div className="text-fg-subtle">运行中…</div>}
                {runResult?.text && (
                  <div className="mt-1 whitespace-pre-wrap border-t border-line pt-1 text-fg-muted">
                    输出：{runResult.text.slice(0, 400)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 检查器 */}
        {selectedNode && (
          <aside className="absolute inset-y-0 right-0 z-20 flex w-[min(320px,86vw)] flex-col border-l border-line bg-surface shadow-float sm:relative sm:z-auto sm:w-[300px] sm:shadow-none">
            <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
              <span className="text-[12px] font-semibold text-fg">节点设置</span>
              <IconButton label="关闭设置" onClick={() => setSelected(null)} className="h-7 w-7">
                <X size={14} />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <label className="block">
                <span className="mb-1 block text-[11px] text-fg-subtle">标题</span>
                <input
                  value={selectedNode.title}
                  onChange={(e) => updateNode(selectedNode.id, { title: e.target.value })}
                  className="h-8 w-full rounded-lg bg-surface-2 px-inset-md text-[12px] outline-none focus:ring-2 focus:ring-[var(--ring)]/15"
                />
              </label>

              <div className="rounded-xl bg-surface-2/60 px-inset-lg py-2.5 text-[11px] leading-relaxed text-fg-subtle">
                {NODE_META[selectedNode.kind].hint}
                {selectedNode.kind === "template" && (
                  <span className="mt-1 block font-mono text-[10px]">
                    变量：{"{{input}} {{char}} {{user}} {{history}} {{nodeId.output}}"}
                  </span>
                )}
              </div>

              {selectedNode.kind === "template" && (
                <>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-fg-subtle">模板内容</span>
                    <textarea
                      value={(selectedNode.config as TemplateNodeConfig).text ?? ""}
                      onChange={(e) => patchConfig(selectedNode.id, { text: e.target.value })}
                      className="min-h-[110px] w-full resize-y rounded-lg bg-surface-2 px-inset-md py-2.5 font-mono text-[11.5px] leading-relaxed outline-none focus:ring-2 focus:ring-[var(--ring)]/15"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-fg-subtle">角色</span>
                    <Segmented
                      size="sm"
                      value={(selectedNode.config as TemplateNodeConfig).role ?? "system"}
                      onChange={(role) => patchConfig(selectedNode.id, { role })}
                      options={[
                        { id: "system", label: "system" },
                        { id: "user", label: "user" },
                        { id: "assistant", label: "assistant" },
                      ]}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-fg-subtle">写入方式</span>
                    <Segmented
                      size="sm"
                      value={(selectedNode.config as TemplateNodeConfig).mode ?? "append"}
                      onChange={(mode) => patchConfig(selectedNode.id, { mode })}
                      options={[
                        { id: "append", label: "追加" },
                        { id: "replace", label: "替换消息栈" },
                      ]}
                    />
                  </label>
                </>
              )}

              {selectedNode.kind === "script" && (
                <label className="block">
                  <span className="mb-1 block text-[11px] text-fg-subtle">脚本代码</span>
                  <textarea
                    value={(selectedNode.config as ScriptNodeConfig).code ?? ""}
                    onChange={(e) => patchConfig(selectedNode.id, { code: e.target.value })}
                    spellCheck={false}
                    className="min-h-[220px] w-full resize-y rounded-lg bg-surface-2 px-inset-md py-2.5 font-mono text-[11px] leading-relaxed outline-none focus:ring-2 focus:ring-[var(--ring)]/15"
                  />
                </label>
              )}

              {selectedNode.kind === "llm" && (
                <label className="block">
                  <span className="mb-1 block text-[11px] text-fg-subtle">额外参数（JSON）</span>
                  <textarea
                    value={(selectedNode.config as LlmNodeConfig).params ?? ""}
                    onChange={(e) => patchConfig(selectedNode.id, { params: e.target.value })}
                    spellCheck={false}
                    placeholder='{"temperature": 1.2}'
                    className="min-h-[110px] w-full resize-y rounded-lg bg-surface-2 px-inset-md py-2.5 font-mono text-[11px] leading-relaxed outline-none focus:ring-2 focus:ring-[var(--ring)]/15"
                  />
                  {!(safeJsonParse((selectedNode.config as LlmNodeConfig).params ?? "").ok) && (
                    <span className="mt-1 block text-[10.5px] text-danger">JSON 无效，运行时将报错</span>
                  )}
                  <span className="mt-1 block text-[10.5px] text-fg-subtle">
                    模型：{paramModel(resolveModelConfig(settings).params) || "未配置"} · 档案「
                    {activeProfile(settings).name}」
                  </span>
                </label>
              )}

              <div className="flex items-center justify-between rounded-xl border border-line px-inset-lg py-2.5">
                <span className="text-[11px] text-fg-muted">节点 ID（模板里用它取值）</span>
                <span className="max-w-[150px] truncate font-mono text-[10px] text-fg-subtle">{selectedNode.id}</span>
              </div>

              <Button
                variant="danger"
                size="sm"
                className="w-full"
                leading={<Trash2 size={13} />}
                onClick={() => removeNode(selectedNode.id)}
              >
                删除节点
              </Button>
            </div>

            <div className="border-t border-line p-3">
              <p className="mb-1.5 text-[10.5px] uppercase tracking-[0.1em] text-fg-subtle">试运行输入</p>
              <textarea
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                className="min-h-[64px] w-full resize-y rounded-lg bg-surface-2 px-inset-md py-2.5 text-[11.5px] leading-relaxed outline-none focus:ring-2 focus:ring-[var(--ring)]/15"
              />
            </div>
          </aside>
        )}

        {/* 未选中时的提示 */}
        <div className="pointer-events-none absolute bottom-4 right-4 hidden items-center gap-2 text-[10.5px] text-fg-subtle sm:flex">
          <Minus size={11} />
          拖动节点移动 · 从右侧圆点拖出连线 · Delete 删除
          <ChevronRight size={11} />
        </div>
      </div>
    </div>
  );
}
