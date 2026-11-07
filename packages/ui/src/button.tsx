"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "icon" | "icon-sm";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "bg-transparent text-fg border border-line-strong hover:bg-hover",
  ghost: "bg-transparent text-fg-secondary hover:bg-hover hover:text-fg",
  danger: "bg-danger-bg text-danger border border-transparent hover:border-danger/40",
};
const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 gap-1.5 text-xs",
  md: "h-8 px-3 gap-1.5 text-[13px]",
  icon: "h-8 w-8 justify-center",
  "icon-sm": "h-7 w-7 justify-center",
};

/** Кнопка-пилюля. Состояние загрузки не меняет ширину: иконка заменяется спиннером. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-medium tracking-[0.01em] transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});
