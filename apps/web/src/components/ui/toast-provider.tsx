"use client";

import { useEffect, useMemo, useState } from "react";
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

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const contextValue = useMemo(
    () => ({
      pushToast: (tone: ToastTone, message: string) => {
        const id =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `toast-${Date.now()}-${++toastCounter}`;
        setToasts((current) => [...current, { id, tone, message }].slice(-3));
        window.setTimeout(() => {
          setToasts((current) => current.filter((item) => item.id !== id));
        }, 4_000);
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
              {toasts.map((toast) => (
                <div
                  key={toast.id}
                  role={toast.tone === "error" ? "alert" : "status"}
                  aria-live={toast.tone === "error" ? "assertive" : "polite"}
                  aria-atomic="true"
                  className={`rounded-md border px-3 py-2 text-sm shadow ${toneClass[toast.tone]}`}
                >
                  {toast.message}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}
