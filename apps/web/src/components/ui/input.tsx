import { useId } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  error?: string;
};

export function Input({ className, error, id, "aria-describedby": ariaDescribedBy, ...props }: Props) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [ariaDescribedBy, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <>
      <input
        suppressHydrationWarning
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={cn(
          "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100",
          error ? "border-red-500 focus:border-red-500 focus:ring-red-100" : undefined,
          className,
        )}
        {...props}
      />
      {error ? <p id={errorId} className="mt-1 text-xs text-red-600">{error}</p> : null}
    </>
  );
}
