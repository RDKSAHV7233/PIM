"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function ProductDirtyNavigationGuard() {
  const dirtyRef = useRef(false);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingHref, setPendingHref] = useState("");

  const setDirtyState = (nextDirty: boolean) => {
    dirtyRef.current = nextDirty;
    setIsDirty(nextDirty);
  };

  useEffect(() => {
    const isProductEditEvent = (event: Event) => {
      const target = event.target;
      return target instanceof Element && Boolean(target.closest("form[data-product-dirty-form='true']"));
    };

    const markDirty = (event: Event) => {
      if (isProductEditEvent(event)) setDirtyState(true);
    };

    const clearOnSubmit = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.matches("form[data-product-dirty-form='true']")) {
        setDirtyState(false);
      }
    };

    const confirmProductTabNavigation = (event: MouseEvent) => {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[data-product-tab-link='true']");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      event.preventDefault();
      setPendingHref(href);
    };

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    document.addEventListener("input", markDirty, true);
    document.addEventListener("change", markDirty, true);
    document.addEventListener("submit", clearOnSubmit, true);
    document.addEventListener("click", confirmProductTabNavigation, true);
    window.addEventListener("beforeunload", warnBeforeUnload);

    return () => {
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("change", markDirty, true);
      document.removeEventListener("submit", clearOnSubmit, true);
      document.removeEventListener("click", confirmProductTabNavigation, true);
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, []);

  const stayOnTab = () => {
    setPendingHref("");
  };

  const leaveWithoutSaving = () => {
    const href = pendingHref;
    setPendingHref("");
    setDirtyState(false);
    if (href) window.location.assign(href);
  };

  if (!isDirty || !pendingHref) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="product-unsaved-changes-title"
        aria-describedby="product-unsaved-changes-description"
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
      >
        <h2 id="product-unsaved-changes-title" className="text-base font-semibold text-slate-950">
          Unsaved changes
        </h2>
        <p id="product-unsaved-changes-description" className="mt-2 text-sm leading-6 text-slate-600">
          Save product changes before switching tabs, or leave without saving this edit.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={stayOnTab}>
            Stay on this tab
          </Button>
          <Button type="button" variant="destructive" onClick={leaveWithoutSaving}>
            Leave without saving
          </Button>
        </div>
      </div>
    </div>
  );
}
