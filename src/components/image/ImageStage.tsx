import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  Images,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useStore, groupImages } from "../../lib/store";
import type { Message, MessageImage, ImageWidgetGeometry } from "../../lib/types";
import { clamp, cn, formatTime } from "../../lib/utils";
import { IconButton } from "../ui/Button";
import { Modal } from "../ui/Modal";

/** 聊天正文列的宽度上限，和 MessageList 里那个 max-w-[760px] 保持一致 */
const THREAD_MAX = 760;
/** 桌面端左侧边栏宽度，和 Sidebar 的 w-[304px] 保持一致 */
const SIDEBAR_WIDTH = 304;
const MIN_WIDTH = 180;
/** 画面是 2:3 竖图：高度恒等于宽度 × 1.5，缩放只改一个数 */
const ASPECT = 1.5;

/**
 * 悬浮画面：默认宽度取聊天列的一半，可拖动、可拖右下角缩放。
 * 显示的是「当前这条气泡的某一版图」——第一维跟气泡走，第二维用左右翻页切换。
 */
function clampBox(
  box: ImageWidgetGeometry,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
): ImageWidgetGeometry {
  // 2:3：高度跟着宽度走，缩放只改宽度；两个方向都要留出 24px 边距
  const maxWidth = Math.max(
    MIN_WIDTH,
    Math.min(viewportWidth - 24, Math.round((viewportHeight - 24) / ASPECT)),
  );
  const width = clamp(box.width, MIN_WIDTH, maxWidth);
  const height = Math.round(width * ASPECT);
  return {
    width,
    x: clamp(box.x, 8, Math.max(8, viewportWidth - width - 8)),
    y: clamp(box.y, 8, Math.max(8, viewportHeight - height - 8)),
  };
}

/**
 * 找不到聊天正文列时的兜底宽度：
 * 桌面端先是 304 宽的左栏，剩下的才是内容列；正文列左右各有内边距（sm 起 24px），
 * 再被 max-w-760 卡住。
 */
function fallbackThreadWidth(): number {
  const sidebar = window.innerWidth >= 1024 ? SIDEBAR_WIDTH : 0;
  const padding = window.innerWidth < 640 ? 32 : 48;
  return Math.min(window.innerWidth - sidebar - padding, THREAD_MAX);
}

/**
 * 默认宽 = 聊天正文列的一半，而不是整个内容区的一半。
 * 正文列是气泡实际占用的那一条（max-w-760），内容区在桌面上还要先扣掉左栏，
 * 按内容区算会让缩略图看起来比聊天气泡宽一大截。
 */
function initialBox(saved?: ImageWidgetGeometry): ImageWidgetGeometry {
  const thread = document.querySelector<HTMLElement>("[data-chat-thread]");
  const rect = thread?.getBoundingClientRect();
  const threadWidth = rect && rect.width > 80 ? rect.width : fallbackThreadWidth();
  const width = saved?.width ?? Math.round(threadWidth * 0.5);
  const right = rect && rect.width > 80 ? rect.right : window.innerWidth / 2 + threadWidth / 2;
  // 没有保存过就贴着正文列的右缘、顶栏以下放
  const x = saved?.x ?? right - width - 12;
  const y = saved?.y ?? 88;
  return clampBox({ x, y, width });
}

export function ImageStage() {
  const enabled = useStore((s) => s.settings.imageEnabled);
  const savedBox = useStore((s) => s.settings.imageWidget);
  const characters = useStore((s) => s.characters);
  const activeCharacterId = useStore((s) => s.activeCharacterId);
  const messages = useStore((s) => s.messages);
  const images = useStore((s) => s.images);
  const imageView = useStore((s) => s.imageView);
  const imageRun = useStore((s) => s.imageRun);
  const generateImage = useStore((s) => s.generateImage);
  const focusImage = useStore((s) => s.focusImage);
  const removeImage = useStore((s) => s.removeImage);
  const setImageWidget = useStore((s) => s.setImageWidget);

  const [box, setBox] = useState<ImageWidgetGeometry>(() => initialBox(savedBox));
  const [dragging, setDragging] = useState<"move" | "resize" | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const boxRef = useRef(box);
  const measuredRef = useRef(false);

  /**
   * 首次挂载时兄弟节点还没进 DOM，量不到聊天正文列，只能按公式估。
   * 提交后补量一次（paint 之前），把默认宽 / 位置对齐到真实列宽；
   * 保存过几何的用户不动，避免覆盖他自己拖过的尺寸。
   */
  useLayoutEffect(() => {
    if (measuredRef.current || savedBox?.width) return;
    measuredRef.current = true;
    setBox((prev) => {
      const next = initialBox();
      if (Math.abs(next.width - prev.width) < 6 && Math.abs(next.x - prev.x) < 6) return prev;
      return next;
    });
  }, [savedBox?.width]);
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origin: ImageWidgetGeometry;
  } | null>(null);

  useEffect(() => {
    boxRef.current = box;
  }, [box]);

  // 窗口尺寸变了要收进可视区，否则窄屏上整个组件会跑到屏幕外
  useEffect(() => {
    const onResize = () => setBox((prev) => clampBox(prev));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (drag.mode === "move") {
        setBox(clampBox({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy }));
      } else {
        setBox(clampBox({ ...drag.origin, width: drag.origin.width + dx }));
      }
    };
    const onUp = () => {
      setDragging(null);
      dragRef.current = null;
      // 拖动过程中只改内存，松手才落库
      void setImageWidget(boxRef.current, { persist: true });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, setImageWidget]);

  const startDrag = (mode: "move" | "resize") => (event: React.PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, origin: boxRef.current };
    setDragging(mode);
  };

  const character = characters.find((c) => c.id === activeCharacterId) ?? null;
  const groups = useMemo(() => groupImages(images), [images]);
  const group = useMemo(() => {
    if (!groups.length) return null;
    const byView = imageView ? groups.find((item) => item.messageId === imageView.messageId) : null;
    return byView ?? groups[groups.length - 1];
  }, [groups, imageView]);
  const current = useMemo(() => {
    if (!group) return null;
    return group.images.find((img) => img.id === imageView?.imageId) ?? group.images[group.images.length - 1];
  }, [group, imageView]);
  const variantIndex = current && group ? group.images.findIndex((img) => img.id === current.id) : -1;
  // 还没有生成图时，先拿角色底图当预览
  const seedUrl = character?.imageSeeds?.find((src) => Boolean(src)) ?? "";
  const displayUrl = current?.url ?? seedUrl;
  const isSeedOnly = !current && Boolean(seedUrl);
  // 有图可以照着再画一版；没图但有生图提示词时也允许手动起一张
  const hasPrompt = useMemo(
    () => messages.some((m) => m.role === "assistant" && Boolean(m.meta.imagePrompt)),
    [messages],
  );
  const canRedraw = images.length > 0 || hasPrompt;
  const running = imageRun.running;
  const error = running ? null : imageRun.error;

  const redraw = useCallback(() => {
    if (running) return;
    // 只传「画给哪条气泡」：底图由 store 取这一组的入图底图，
    // 让同一气泡的所有版本都从同一个起点长出来，而不是上一版接着画
    void generateImage(current ? { messageId: current.messageId } : undefined);
  }, [current, generateImage, running]);

  const stepVariant = (delta: number) => {
    if (!group) return;
    const next = group.images[variantIndex + delta];
    if (next) focusImage(next.messageId, next.id);
  };

  if (!enabled || !character) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        style={{
          left: box.x,
          top: box.y,
          width: box.width,
          height: Math.round(box.width * ASPECT),
          touchAction: "none",
        }}
        role="group"
        aria-label="角色画面"
        onPointerDown={startDrag("move")}
        className={cn(
          "group fixed z-30 select-none overflow-hidden rounded-[22px] bg-surface-2 shadow-float ring-1 ring-black/[0.06] dark:ring-white/[0.1]",
          dragging === "move" ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        {displayUrl ? (
          <img
            src={displayUrl}
            alt={current?.rawPrompt ?? `${character.name}的画面`}
            draggable={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 border border-dashed border-line/80 bg-surface text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-2 text-fg-subtle">
              <Images size={18} />
            </span>
            <p className="px-4 text-[12px] font-medium text-fg-muted">还没有画面</p>
            <p className="px-5 text-[11px] leading-relaxed text-fg-subtle">
              先在角色卡里传一张正面全身照的底图，再开始对话 —— 画面会跟着每轮回复变化。
            </p>
          </div>
        )}

        {/* 生图进行中：压一层浅色遮罩，别把旧画面整个盖掉 */}
        <AnimatePresence>
          {running && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/55 backdrop-blur-[2px]"
            >
              <Loader2 size={20} className="animate-spin text-primary" />
              <span className="text-[11.5px] font-medium text-fg-muted">正在绘制…</span>
            </motion.div>
          )}
        </AnimatePresence>

        {isSeedOnly && !running && (
          <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-black/35 px-2 py-0.5 text-[10px] text-white/90 backdrop-blur-sm">
            角色底图
          </span>
        )}

        {error && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 rounded-xl bg-danger/90 px-2.5 py-1.5 text-[10.5px] leading-snug text-white shadow-card transition-opacity duration-200 group-hover:opacity-0">
            <p className="line-clamp-2 break-words">{error}</p>
          </div>
        )}

        {/* 右上角工具条：平时淡出，hover / 聚焦时淡入 */}
        <div
          className={cn(
            "absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity duration-200",
            "group-hover:opacity-100 focus-within:opacity-100",
            dragging && "pointer-events-none",
          )}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <StageButton label={running ? "正在绘制" : "重新生图"} onClick={redraw} disabled={running || !canRedraw}>
            <RotateCcw size={13} className={running ? "opacity-60" : undefined} />
          </StageButton>
          <StageButton label="全部画面" onClick={() => setGalleryOpen(true)} disabled={!images.length}>
            <Images size={13} />
          </StageButton>
        </div>

        {/* 第二维：同一气泡下的多张图左右翻 */}
        {group && group.images.length > 1 && (
          <div
            className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/45 to-transparent px-2 pb-2 pt-6 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <StageButton label="上一张" onClick={() => stepVariant(-1)} disabled={variantIndex <= 0} tone="dark">
              <ChevronLeft size={13} />
            </StageButton>
            <span className="min-w-[42px] text-center text-[11px] tabular-nums text-white/90">
              {variantIndex + 1} / {group.images.length}
            </span>
            <StageButton
              label="下一张"
              onClick={() => stepVariant(1)}
              disabled={variantIndex >= group.images.length - 1}
              tone="dark"
            >
              <ChevronRight size={13} />
            </StageButton>
          </div>
        )}

        {/* 缩放：右下角一个不显眼的手柄 */}
        <div
          role="separator"
          aria-label="调整画面尺寸"
          onPointerDown={(e) => {
            e.stopPropagation();
            startDrag("resize")(e);
          }}
          className="absolute bottom-0 right-0 flex h-6 w-6 cursor-nwse-resize items-end justify-end p-1 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <span className="h-2.5 w-2.5 rounded-[2px] border-b-2 border-r-2 border-white/80 drop-shadow" />
        </div>
      </motion.div>

      <ImageGallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        groups={groups}
        messages={messages}
        activeId={current?.id ?? ""}
        onPick={(messageId, imageId) => {
          focusImage(messageId, imageId);
          setGalleryOpen(false);
        }}
        onRemove={(id) => void removeImage(id)}
      />
    </>
  );
}

function StageButton({
  label,
  onClick,
  disabled,
  tone = "light",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "light" | "dark";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-md transition-colors disabled:opacity-35",
        tone === "light"
          ? "bg-white/80 text-[#2a2723] hover:bg-white dark:bg-black/55 dark:text-white/90 dark:hover:bg-black/70"
          : "bg-black/25 text-white/90 hover:bg-black/45",
      )}
    >
      {children}
    </button>
  );
}

/**
 * 全量画面：按气泡分组列出所有版本。
 * 这是「中途演化的图不能丢」的落脚点 —— 组件上只能看到当前一组，历史都收在这里。
 */
function ImageGallery({
  open,
  onClose,
  groups,
  messages,
  activeId,
  onPick,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  groups: { messageId: string; images: MessageImage[] }[];
  messages: Message[];
  activeId: string;
  onPick: (messageId: string, imageId: string) => void;
  onRemove: (id: string) => void;
}) {
  const total = groups.reduce((sum, group) => sum + group.images.length, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="全部画面"
      subtitle={`${total} 张 · 重新生图的旧版本都留在这里，随时切回`}
      className="max-w-[720px]"
      footer={
        <p className="text-[11px] text-fg-subtle">点缩略图切换到那一版，画面组件会跟着跳过去。</p>
      }
    >
      <div className="space-y-5 pb-2">
        {groups.map((group, index) => {
          const message = messages.find((m) => m.id === group.messageId);
          return (
            <section key={group.messageId}>
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full bg-surface-2 px-inset-pill py-1 text-[10.5px] text-fg-subtle">
                  第 {index + 1} 组
                </span>
                <span className="text-[11px] tabular-nums text-fg-subtle">
                  {message ? formatTime(message.createdAt) : ""} · {group.images.length} 张
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {group.images.map((image) => {
                  const active = image.id === activeId;
                  return (
                    <div key={image.id} className="group/tile relative">
                      <button
                        type="button"
                        onClick={() => onPick(image.messageId, image.id)}
                        aria-label="查看这张画面"
                        className={cn(
                          "block aspect-[2/3] w-full overflow-hidden rounded-xl bg-surface-2 transition-all",
                          active
                            ? "ring-2 ring-primary ring-offset-2 ring-offset-surface"
                            : "hover:-translate-y-0.5 hover:shadow-card",
                        )}
                      >
                        <img
                          src={image.url}
                          alt={image.rawPrompt}
                          draggable={false}
                          className="h-full w-full object-cover"
                        />
                      </button>
                      <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover/tile:opacity-100 focus-within:opacity-100">
                        <IconButton
                          label="删除这张"
                          onClick={() => onRemove(image.id)}
                          className="h-6 w-6 bg-black/45 text-white backdrop-blur-md hover:bg-black/60 hover:text-white"
                        >
                          <Trash2 size={11} />
                        </IconButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!groups.length && (
          <p className="py-6 text-center text-[12px] text-fg-subtle">
            还没有生成过画面。开启图生图后，角色每条回复都会带一张图。
          </p>
        )}
      </div>
    </Modal>
  );
}
