import type { ButtonHTMLAttributes, ReactNode } from "react";
import { colors } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  children: ReactNode;
};

export function Button({ className, variant = "primary", children, ...props }: Props) {
  const primaryStyle = {
    backgroundColor: colors.accent,
    color: "#ffffff",
  };

  return (
    <button
      suppressHydrationWarning
      className={cn(
        "rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary"
          ? "hover:opacity-90"
          : "border border-border bg-white text-ink hover:bg-gray-50",
        className,
      )}
      style={variant === "primary" ? primaryStyle : undefined}
      {...props}
    >
      {children}
    </button>
  );
}
