"use client";

import { useEffect, useRef, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";

export function MappingDirtyNavigationGuard() {
  const dirtyRef = useRef(false);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingHref, setPendingHref] = useState("");

  const setDirtyState = (nextDirty: boolean) => {
    dirtyRef.current = nextDirty;
    setIsDirty(nextDirty);
  };

  useEffect(() => {
    const isMappingEditEvent = (event: Event) => {
      const target = event.target;
      return target instanceof Element && Boolean(target.closest("form[data-mapping-dirty-form='true']"));
    };

    const markDirty = (event: Event) => {
      if (isMappingEditEvent(event)) {
        setDirtyState(true);
      }
    };

    const clearOnSubmit = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.matches("form[data-mapping-dirty-form='true']")) {
        setDirtyState(false);
      }
    };

    const confirmWizardNavigation = (event: MouseEvent) => {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const anchor = target.closest("a[data-mapping-nav='true']");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }
      const href = anchor.getAttribute("href");
      if (!href) {
        return;
      }
      event.preventDefault();
      setPendingHref(href);
    };

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    document.addEventListener("input", markDirty, true);
    document.addEventListener("change", markDirty, true);
    document.addEventListener("submit", clearOnSubmit, true);
    document.addEventListener("click", confirmWizardNavigation, true);
    window.addEventListener("beforeunload", warnBeforeUnload);

    return () => {
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("change", markDirty, true);
      document.removeEventListener("submit", clearOnSubmit, true);
      document.removeEventListener("click", confirmWizardNavigation, true);
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, []);

  const stayInWizard = () => {
    setPendingHref("");
  };

  const leaveWithoutSaving = () => {
    const href = pendingHref;
    setPendingHref("");
    setDirtyState(false);
    if (href) {
      window.location.assign(href);
    }
  };

  return (
    <AppDialog
      open={isDirty && !!pendingHref}
      title="Unsaved mapping changes"
      description="Save this mapping draft before changing steps or scope, or leave without saving these edits."
      onClose={stayInWizard}
    >
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {/* Staying is the safe, expected choice, so it carries the primary emphasis; leaving discards edits and is
            styled as a quiet destructive action rather than the dominant button. */}
        <Button type="button" variant="primary" onClick={stayInWizard}>
          Stay on this step
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="border-red-200 text-red-700 hover:bg-red-50"
          onClick={leaveWithoutSaving}
        >
          Leave without saving
        </Button>
      </div>
    </AppDialog>
  );
}
