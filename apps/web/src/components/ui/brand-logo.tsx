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
    <div className={cn("inline-flex rounded-2xl bg-slate-950 px-4 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.12)] ring-1 ring-slate-200", className)}>
      <img src="/brand/dark_logo.svg" alt="Vexa PIM" className="h-14 w-auto sm:h-16" />
    </div>
  );
}
