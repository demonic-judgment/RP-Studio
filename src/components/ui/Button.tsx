import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

type Variant = "primary" | "soft" | "ghost" | "outline" | "danger";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leading?: ReactNode;
  trailing?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-on-primary shadow-soft hover:bg-primary-hover disabled:bg-primary/40 disabled:text-on-primary/70",
  soft: "bg-primary-container text-on-primary-container hover:bg-primary-container/70",
  ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
  outline: "border border-line bg-surface text-fg hover:bg-surface-2 hover:border-line-strong",
  danger: "bg-danger/10 text-danger hover:bg-danger/16",
};

const sizes: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-2.5 text-[13px]",
  md: "h-10 gap-2 rounded-xl px-4 text-sm",
  lg: "h-11 gap-2 rounded-xl px-5 text-sm",
  icon: "h-10 w-10 justify-center rounded-xl",
  "icon-sm": "h-8 w-8 justify-center rounded-lg",
};

export function Button({
  variant = "ghost",
  size = "md",
  className,
  leading,
  trailing,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex select-none items-center font-medium transition-[background-color,color,border-color,transform,box-shadow,opacity] duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {leading}
      {children}
      {trailing}
    </button>
  );
}

export function IconButton({
  label,
  className,
  ...props
}: ButtonProps & { label: string }) {
  return (
    <Button
      aria-label={label}
      title={label}
      size="icon-sm"
      variant="ghost"
      className={cn("text-fg-subtle", className)}
      {...props}
    />
  );
}
