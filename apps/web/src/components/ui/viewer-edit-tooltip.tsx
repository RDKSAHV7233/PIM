"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface ViewerEditTooltipProps {
  children: ReactNode;
  className?: string;
}

export function ViewerEditTooltip({ children, className }: ViewerEditTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      aria-label="Read-only permissions hint"
    >
      {children}
      {open && (
        <div
          role="tooltip"
          className="absolute right-0 top-full z-20 mt-2 w-72 rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-700 shadow-lg"
        >
          You have read-only access to this account. Contact your account admin to request edit
          permissions.
        </div>
      )}
    </div>
  );
}
