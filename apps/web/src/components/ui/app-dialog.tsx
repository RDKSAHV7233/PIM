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
      if (!dialog.open) dialog.showModal();
      const timer = window.setTimeout(() => {
        focusFirstElement(dialog);
      }, 0);
      return () => {
        window.clearTimeout(timer);
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
