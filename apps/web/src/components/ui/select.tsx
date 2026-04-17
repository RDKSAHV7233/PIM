import { useId } from "react";
import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  error?: string;
};

export function NativeSelect({ className, error, id, "aria-describedby": ariaDescribedBy, ...props }: SelectProps) {
  const fallbackId = useId();
  const selectId = id ?? fallbackId;
  const errorId = error ? `${selectId}-error` : undefined;
  const describedBy = [ariaDescribedBy, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <>
      {/* TODO: upgrade to ComboBox for 50+ option lists */}
      <select
        suppressHydrationWarning
        id={selectId}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={cn(
          "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500",
          error ? "border-red-500 focus:border-red-500 focus:ring-red-500" : undefined,
          className,
        )}
        {...props}
      />
      {error ? <p id={errorId} className="mt-1 text-xs text-red-600">{error}</p> : null}
    </>
  );
}

export function Select(props: SelectProps) {
  return <NativeSelect {...props} />;
}

export default Select;
