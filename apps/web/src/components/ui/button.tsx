import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  children: ReactNode;
};

export function Button({ className, variant = "primary", children, ...props }: Props) {
  return (
    <button
      className={cn(
        "rounded-md px-3 py-2 text-sm font-medium transition",
        variant === "primary"
          ? "bg-accent text-white hover:bg-teal-700"
          : "border border-border bg-white text-ink hover:bg-gray-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
