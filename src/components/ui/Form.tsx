import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import { cn } from "../../lib/utils";

export function Field({
  label,
  hint,
  error,
  children,
  className,
  action,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {(label || action) && (
        <div className="flex items-center justify-between gap-2">
          {label && <span className="text-[12.5px] font-medium text-fg-muted">{label}</span>}
          {action}
        </div>
      )}
      {children}
      {error ? (
        <p className="text-[11.5px] leading-relaxed text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[11.5px] leading-relaxed text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

const inputBase =
  "w-full rounded-xl bg-surface-2 px-inset-lg text-sm text-fg placeholder:text-fg-subtle transition-[box-shadow,background-color] duration-200 focus:outline-none focus:ring-4 focus:ring-[var(--ring)]/15";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputBase, "h-10", className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(inputBase, "min-h-[80px] resize-y py-3 leading-relaxed", className)}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        inputBase,
        "h-10 appearance-none bg-[length:14px] bg-[right_10px_center] bg-no-repeat pr-8",
        className,
      )}
      style={{ backgroundImage: "var(--select-caret)" }}
    >
      {children}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  size = "md",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  const small = size === "sm";
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full p-[3px] transition-colors duration-300 disabled:opacity-50",
        small ? "h-[20px] w-[34px]" : "h-[26px] w-[46px]",
        checked ? "bg-primary" : "bg-surface-3",
      )}
    >
      <span
        className={cn(
          "block rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          small ? "h-3.5 w-3.5" : "h-5 w-5",
          checked ? (small ? "translate-x-[14px]" : "translate-x-[20px]") : "translate-x-0",
        )}
      />
    </button>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-[var(--primary)] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-soft"
        style={{
          background: `linear-gradient(to right, var(--primary) ${((value - min) / (max - min)) * 100}%, var(--surface-3) ${((value - min) / (max - min)) * 100}%)`,
        }}
      />
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-fg-muted">
        {value}
        {suffix ?? ""}
      </span>
    </div>
  );
}
