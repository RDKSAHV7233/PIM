import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...props }: Props) {
  return (
    <select
      className={cn(
        "w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}
