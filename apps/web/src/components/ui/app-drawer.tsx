"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { focusFirstElement, getFocusableElements } from "@/lib/focus-management";
import { cn } from "@/lib/utils";

interface AppDrawerProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: "sm" | "md" | "lg";
  side?: "left" | "right";
  headerActions?: ReactNode;
  panelClassName?: string;
  contentClassName?: string;
  overlayClassName?: string;
  closeLabel?: string;
}

const widthClasses: Record<NonNullable<AppDrawerProps["width"]>, string> = {
  sm: "w-80",
  md: "w-96",
  lg: "w-[32rem]",
};

export function AppDrawer({
  open,
  title,
  description,
  onClose,
  children,
  width = "md",
  side = "right",
  headerActions,
  panelClassName,
  contentClassName,
  overlayClassName,
  closeLabel = "Close drawer",
}: AppDrawerProps) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
      return;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = getFocusableElements(drawerRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        drawerRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleEscape);
    const timer = window.setTimeout(() => {
      focusFirstElement(drawerRef.current);
      closeButtonRef.current?.focus();
    }, 0);
    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        aria-label={closeLabel}
        className={cn("fixed inset-0 z-40 bg-slate-950/40", overlayClassName)}
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        aria-modal="true"
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "fixed inset-y-0 z-50 flex max-w-full flex-col bg-white shadow-xl transition-transform",
          side === "left" ? "left-0" : "right-0",
          widthClasses[width],
          panelClassName,
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-slate-950">{title}</h2>
            {description ? <div className="mt-1 text-sm text-slate-500">{description}</div> : null}
          </div>
          <div className="ml-4 flex items-center gap-2">
            {headerActions}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              aria-label={closeLabel}
            >
              &times;
            </button>
          </div>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto p-4", contentClassName)}>{children}</div>
      </aside>
    </>
  );
}
