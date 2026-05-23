"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ToastContext, type ToastTone, setToastDispatcher } from "./toast";

interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

let toastCounter = 0;

const toneClass: Record<ToastTone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  error: "border-red-200 bg-red-50 text-red-900",
  info: "border-slate-200 bg-white text-slate-900",
};

// Success toasts are confirmations — auto-dismiss is correct UX.
// Error and info toasts may require the user to read and act on them,
// so they get a manual dismiss button in addition to auto-dismiss.
const DISMISSIBLE_TONES = new Set<ToastTone>(["error", "info"]);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const timerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    setMounted(true);
  }, []);

  const removeToast = useCallback((id: string) => {
    const timer = timerRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timerRef.current.delete(id);
    }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const contextValue = useMemo(
    () => ({
      pushToast: (tone: ToastTone, message: string) => {
        const id =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `toast-${Date.now()}-${++toastCounter}`;
        setToasts((current) => [...current, { id, tone, message }].slice(-3));
        const timer = setTimeout(() => {
          timerRef.current.delete(id);
          setToasts((current) => current.filter((item) => item.id !== id));
        }, 4_000);
        timerRef.current.set(id, timer);
      },
    }),
    [],
  );

  useEffect(() => {
    setToastDispatcher(contextValue.pushToast);
    return () => setToastDispatcher(null);
  }, [contextValue]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {mounted
        ? createPortal(
            <div
              className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
              role="region"
              aria-label="Notifications"
              aria-live="polite"
              aria-atomic="false"
            >
              {toasts.map((item) => (
                <div
                  key={item.id}
                  role={item.tone === "error" ? "alert" : "status"}
                  aria-live={item.tone === "error" ? "assertive" : "polite"}
                  aria-atomic="true"
                  className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow ${toneClass[item.tone]}`}
                >
                  <span className="flex-1">{item.message}</span>
                  {DISMISSIBLE_TONES.has(item.tone) && (
                    <button
                      type="button"
                      onClick={() => removeToast(item.id)}
                      aria-label="Dismiss notification"
                      className="ml-1 flex-shrink-0 opacity-60 hover:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-current"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}
