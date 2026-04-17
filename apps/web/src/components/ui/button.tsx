import type { ButtonHTMLAttributes, ReactNode } from "react";
import { colors } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost" | "dark" | "link";
export type ButtonSize = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  children: ReactNode;
};

const baseClasses = "rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-60";

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-2 text-sm",
  lg: "px-4 py-2.5 text-sm",
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "text-white hover:opacity-90",
  secondary: "border border-border bg-white text-ink hover:bg-gray-50",
  destructive: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
  ghost: "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
  dark: "bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-700",
  link: "p-0 text-blue-700 underline-offset-2 hover:underline",
};

export function buttonVariants({
  variant = "primary",
  size = "md",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
} = {}) {
  return cn(baseClasses, sizeClasses[size], variantClasses[variant]);
}

export function Button({ className, variant = "primary", size = "md", isLoading = false, children, disabled, ...props }: Props) {
  const primaryStyle = {
    backgroundColor: colors.accent,
    color: "#ffffff",
  };

  return (
    <button
      suppressHydrationWarning
      className={cn(buttonVariants({ variant, size }), className)}
      style={variant === "primary" ? primaryStyle : undefined}
      disabled={disabled || isLoading}
      aria-busy={isLoading ? true : undefined}
      {...props}
    >
      {isLoading ? (
        <>
          <svg
            className="mr-2 inline h-3.5 w-3.5 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
            <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span className="sr-only">Loading...</span>
        </>
      ) : null}
      {children}
    </button>
  );
}
