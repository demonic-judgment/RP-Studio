import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { useStore } from "../../lib/store";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[74px] z-[80] flex flex-col items-center gap-2 px-4">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.button
            key={toast.id}
            layout
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            onClick={() => dismiss(toast.id)}
            className="pointer-events-auto flex max-w-[420px] items-start gap-2.5 rounded-2xl border border-line bg-surface/95 px-4 py-3 text-left shadow-float backdrop-blur-xl"
          >
            <span
              className={
                toast.variant === "error"
                  ? "mt-0.5 text-danger"
                  : toast.variant === "success"
                    ? "mt-0.5 text-success"
                    : "mt-0.5 text-fg-subtle"
              }
            >
              {toast.variant === "error" ? (
                <TriangleAlert size={15} />
              ) : toast.variant === "success" ? (
                <CheckCircle2 size={15} />
              ) : (
                <Info size={15} />
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-fg">{toast.title}</span>
              {toast.description && (
                <span className="mt-0.5 block break-words text-[12px] leading-relaxed text-fg-muted">
                  {toast.description}
                </span>
              )}
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
