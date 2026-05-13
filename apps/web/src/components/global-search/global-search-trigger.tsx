"use client";

import { useEffect, useId, useState } from "react";
import { GlobalSearchModal } from "@/components/global-search/global-search-modal";

export function GlobalSearchTrigger() {
  const [open, setOpen] = useState(false);
  const dialogId = useId();

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    }

    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
        aria-label="Open global product search"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
      >
        <span className="hidden md:inline">Search products</span>
        <span className="md:hidden">Search</span>
        <kbd
          title="Shortcut: Cmd+K / Ctrl+K"
          className="hidden items-center gap-0.5 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 sm:inline-flex"
        >
          Cmd+K
        </kbd>
      </button>

      <GlobalSearchModal open={open} onClose={() => setOpen(false)} dialogId={dialogId} />
    </>
  );
}
