import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { IconButton } from "./Button";

export function Drawer({
  open,
  onClose,
  side = "right",
  children,
  className,
  ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  children: ReactNode;
  className?: string;
  ariaLabel: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // onClose 通常是内联箭头函数，每次渲染都是新引用；用 ref 取最新值，
  // 避免下面的副作用因为父组件重渲染而反复执行（会连带抢走输入框焦点）。
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key !== "Tab" || !panel) return;
      const nodes = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  // 只在打开时聚焦一次：等入场动画开始后再落焦点。
  // 依赖里不能放 onClose / 任何会随输入变化的值，否则每次按键都会重新聚焦、把光标顶掉。
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        "[data-autofocus], input, textarea, button",
      );
      target?.focus({ preventScroll: true });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* 遮罩层只做不透明度动画，不带 backdrop-filter：
              全屏 backdrop-blur 在淡入淡出的每一帧都要把整个视口重新模糊一遍，
              移动端这是最贵的一笔开销（底下还压着内容列自己的 backdrop-blur-xl，
              等于模糊叠模糊）。挪掉 3px 模糊、把压暗从 25% 提到 30% 补回层次。 */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/30 dark:bg-black/55"
          />
          <motion.aside
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            initial={{ x: side === "right" ? "100%" : "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: side === "right" ? "100%" : "-100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 40, mass: 0.55 }}
            className={cn(
              "drawer-panel fixed inset-y-0 z-50 flex flex-col bg-surface shadow-float outline-none",
              side === "right" ? "right-0 border-l border-line" : "left-0 border-r border-line",
              className ?? "w-[min(400px,100vw)]",
            )}
          >
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function DrawerHeader({
  title,
  subtitle,
  onClose,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 pb-4 pt-5",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-fg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12px] leading-relaxed text-fg-subtle">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {children}
        {onClose && <IconButton label="关闭" onClick={onClose}><X size={16} /></IconButton>}
      </div>
    </header>
  );
}
