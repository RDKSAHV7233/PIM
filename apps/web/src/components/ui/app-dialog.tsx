"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { focusFirstElement } from "@/lib/focus-management";
import { cn } from "@/lib/utils";

interface AppDialogProps {
  dialogId?: string;
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}

const sizeClass: Record<NonNullable<AppDialogProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

export function AppDialog({ dialogId, open, title, description, onClose, children, size = "md" }: AppDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;

      // showModal() throws InvalidStateError if the <dialog> (or an ancestor)
      // isn't actually being rendered yet — e.g. it's still sitting inside a
      // Next.js streaming placeholder that hasn't been spliced into the live
      // DOM. That's a transient state, not a real failure, so retry across a
      // few animation frames instead of leaving the dialog silently unopened.
      let cancelled = false;
      let rafId: number | null = null;
      let cleanupFocusTimer: number | null = null;
      let attempt = 0;
      const maxAttempts = 30; // ~0.5s at 60fps, generous for a transient stream delay

      const tryOpen = () => {
        if (cancelled) return;
        if (dialog.open) return;
        try {
          dialog.showModal();
        } catch (error) {
          // Only the documented transient case is worth retrying. Any other
          // failure retrying 30x would just delay the same outcome by ~0.5s
          // while hiding a real bug — surface it immediately instead.
          const isTransientStreamingRace = error instanceof DOMException && error.name === "InvalidStateError";
          if (!isTransientStreamingRace) {
            console.error("AppDialog: showModal() failed", error);
            return;
          }
          attempt += 1;
          if (attempt < maxAttempts) {
            rafId = window.requestAnimationFrame(tryOpen);
          }
          return;
        }
        cleanupFocusTimer = window.setTimeout(() => {
          focusFirstElement(dialog);
        }, 0);
      };

      tryOpen();

      return () => {
        cancelled = true;
        if (rafId !== null) window.cancelAnimationFrame(rafId);
        if (cleanupFocusTimer !== null) window.clearTimeout(cleanupFocusTimer);
      };
    } else {
      if (dialog.open) dialog.close();
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  return (
    <dialog
      id={dialogId}
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cn(
        "w-full rounded-lg border border-slate-200 bg-white p-5 shadow-xl",
        "[&::backdrop]:bg-slate-950/40",
        sizeClass[size],
      )}
    >
      <h2 id={titleId} className="text-base font-semibold text-slate-950">{title}</h2>
      {description ? (
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </dialog>
  );
}
