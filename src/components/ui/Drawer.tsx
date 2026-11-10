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

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
    const timer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        "[data-autofocus], input, textarea, button",
      );
      target?.focus({ preventScroll: true });
    }, 120);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[3px] dark:bg-black/50"
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
              "fixed inset-y-0 z-50 flex flex-col bg-surface shadow-float outline-none",
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
