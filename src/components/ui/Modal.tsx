import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { IconButton } from "./Button";

/**
 * 居中的模态对话框。挂到 body 上，因此可以叠在 Drawer 之上；
 * Esc 在捕获阶段处理并阻断冒泡，避免同时关掉下层的抽屉。
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  ariaLabel,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = panelRef.current.querySelectorAll<HTMLElement>(
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
    document.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        "[data-autofocus], input, textarea, select",
      );
      target?.focus({ preventScroll: true });
    }, 90);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-[3px] dark:bg-black/55"
          />
          <div className="pointer-events-none fixed inset-0 z-[61] flex items-center justify-center px-4 py-6">
            <motion.div
              key="modal-panel"
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel ?? (typeof title === "string" ? title : "对话框")}
              initial={{ opacity: 0, y: 14, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.99 }}
              transition={{ type: "spring", stiffness: 440, damping: 38, mass: 0.5 }}
              className={cn(
                "pointer-events-auto flex max-h-[min(88vh,780px)] w-full flex-col overflow-hidden rounded-2xl bg-surface shadow-float outline-none",
                className ?? "max-w-[520px]",
              )}
            >
              <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-4">
                <div className="min-w-0">
                  <h2 className="truncate text-[14.5px] font-semibold tracking-[-0.01em] text-fg">
                    {title}
                  </h2>
                  {subtitle && (
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-subtle">{subtitle}</p>
                  )}
                </div>
                <IconButton label="关闭" onClick={onClose}>
                  <X size={16} />
                </IconButton>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-1">{children}</div>

              {footer && (
                <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-5 py-3">
                  {footer}
                </footer>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
