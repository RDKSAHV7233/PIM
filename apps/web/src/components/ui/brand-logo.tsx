import { cn } from "@/lib/utils";

interface BrandLogoProps {
  variant?: "compact" | "lockup";
  className?: string;
}

function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/brand/app_icon.svg"
      alt=""
      aria-hidden="true"
      className={cn("h-10 w-10 shrink-0 rounded-2xl drop-shadow-[0_12px_32px_rgba(99,102,241,0.32)]", className)}
    />
  );
}

export function BrandLogo({ variant = "compact", className }: BrandLogoProps) {
  if (variant === "compact") {
    return (
      <div className={cn("inline-flex items-center gap-2", className)}>
        <BrandMark className="h-9 w-9" />
        <div className="flex flex-col leading-none">
          <span className="text-xl font-semibold tracking-tight text-slate-950">Vexa</span>
          <span className="text-[10px] font-medium uppercase tracking-[0.28em] text-slate-500">PIM</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-3 rounded-[22px] border border-violet-100/80 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_rgba(255,255,255,0.98)_58%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.95))] px-4 py-3 shadow-[0_20px_44px_rgba(148,163,184,0.18)] ring-1 ring-white/70",
        className,
      )}
    >
      <BrandMark className="h-11 w-11 rounded-[18px] shadow-[0_14px_34px_rgba(99,102,241,0.24)]" />
      <div className="flex min-w-0 flex-col leading-none">
        <div className="flex items-baseline gap-2">
          <span className="text-[1.85rem] font-semibold tracking-tight text-slate-950">Vexa</span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.32em] text-indigo-500">PIM</span>
        </div>
        <span className="mt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
          Product information manager
        </span>
      </div>
    </div>
  );
}
