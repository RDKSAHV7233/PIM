"use client";

import { createContext, useContext } from "react";

export type ToastTone = "success" | "error" | "info";

type ToastContextValue = {
  pushToast: (tone: ToastTone, message: string) => void;
};

export const ToastContext = createContext<ToastContextValue | null>(null);

let externalPushToast: ToastContextValue["pushToast"] | null = null;

export function setToastDispatcher(pushToast: ToastContextValue["pushToast"] | null) {
  externalPushToast = pushToast;
}

export const toast = {
  success(message: string) {
    externalPushToast?.("success", message);
  },
  error(message: string) {
    externalPushToast?.("error", message);
  },
  info(message: string) {
    externalPushToast?.("info", message);
  },
};

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
