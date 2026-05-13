import { cn } from "@/lib/utils";

interface JsonPreviewProps {
  value: string;
  className?: string;
}

export function JsonPreview({ value, className }: JsonPreviewProps) {
  return (
    <pre
      className={cn(
        "overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700",
        className,
      )}
    >
      {value}
    </pre>
  );
}
