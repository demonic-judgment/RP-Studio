import { motion } from "motion/react";
import { useId, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: { id: T; label: string; icon?: ReactNode; badge?: ReactNode }[];
  className?: string;
}) {
  const layoutId = useId();
  return (
    <div className={cn("flex items-center gap-1 overflow-x-auto no-scrollbar", className)}>
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors",
              active ? "text-fg" : "text-fg-subtle hover:text-fg-muted",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-lg bg-surface-2"
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {tab.icon}
              {tab.label}
              {tab.badge}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { id: T; label: ReactNode }[];
  className?: string;
  size?: "sm" | "md";
}) {
  const layoutId = useId();
  return (
    <div className={cn("inline-flex w-full rounded-xl bg-surface-2 p-1", className)}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              "relative flex-1 rounded-[9px] font-medium transition-colors",
              size === "sm" ? "h-7 text-[12px]" : "h-8 text-[12.5px]",
              active ? "text-fg" : "text-fg-subtle hover:text-fg-muted",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: "spring", stiffness: 500, damping: 36 }}
                className="absolute inset-0 rounded-[9px] bg-surface shadow-soft"
              />
            )}
            <span className="relative flex h-full items-center justify-center gap-1.5 px-2">
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Pill({
  children,
  className,
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "primary" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "primary" && "bg-primary-container text-on-primary-container",
        tone === "default" && "bg-surface-2 text-fg-muted",
        tone === "muted" && "border border-line text-fg-subtle",
        className,
      )}
    >
      {children}
    </span>
  );
}
