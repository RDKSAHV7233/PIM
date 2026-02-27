import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return <section className={cn("rounded-lg border border-border bg-surface p-4 shadow-sm", className)}>{children}</section>;
}

interface CardTitleProps {
  children: ReactNode;
}

export function CardTitle({ children }: CardTitleProps) {
  return <h2 className="mb-3 text-lg font-semibold text-ink">{children}</h2>;
}
