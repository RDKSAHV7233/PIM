import { cn } from "@/lib/utils";

interface BrandLogoProps {
  variant?: "compact" | "lockup";
  className?: string;
}

function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 84 84"
      aria-hidden="true"
      className={cn("h-10 w-10 shrink-0 drop-shadow-[0_6px_18px_rgba(37,99,235,0.28)]", className)}
    >
      <defs>
        <linearGradient id="tej-blue-top" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
        <linearGradient id="tej-blue-bottom" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id="tej-orange" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="100%" stopColor="#fb923c" />
        </linearGradient>
      </defs>
      <polygon
        points="5,17 44,17 31,30 17,30"
        fill="url(#tej-blue-top)"
        stroke="#1d4ed8"
        strokeWidth="1.25"
      />
      <polygon
        points="46,17 72,17 59,30 33,30"
        fill="url(#tej-orange)"
        stroke="#f59e0b"
        strokeWidth="1.25"
      />
      <polygon
        points="17,35 44,35 57,47 31,62 17,50"
        fill="url(#tej-blue-bottom)"
        stroke="#2563eb"
        strokeWidth="1.25"
      />
      <polygon
        points="17,52 31,62 17,78"
        fill="#1e40af"
        stroke="#1e3a8a"
        strokeWidth="1.25"
      />
    </svg>
  );
}

export function BrandLogo({ variant = "compact", className }: BrandLogoProps) {
  if (variant === "compact") {
    return (
      <div className={cn("inline-flex items-center gap-2", className)}>
        <BrandMark className="h-9 w-9" />
        <span
          className="text-2xl font-black italic tracking-tight text-slate-950"
          style={{ transform: "skewX(-10deg)" }}
        >
          TEJ
        </span>
      </div>
    );
  }

  return (
    <div className={cn("inline-flex flex-col items-start gap-2", className)}>
      <div className="inline-flex items-center gap-3">
        <BrandMark className="h-14 w-14" />
        <span
          className="text-4xl font-black italic tracking-tight text-slate-950"
          style={{ transform: "skewX(-10deg)" }}
        >
          TEJ
        </span>
      </div>
      <div className="pl-[4.25rem] text-[10px] font-medium uppercase tracking-[0.34em] text-slate-500">
        Product Information Management
      </div>
    </div>
  );
}
