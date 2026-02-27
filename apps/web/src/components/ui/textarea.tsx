import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...props }: Props) {
  return (
    <textarea
      className={cn(
        "w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-slate-400 focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}
