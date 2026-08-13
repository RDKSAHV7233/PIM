"use client";

import { useEffect } from "react";

type BrowserErrorReason = Error & { code?: unknown };

const EVENT_IDS = new WeakMap<object, string>();

export function BrowserErrorCapture() {
  useEffect(() => {
    function handleError(event: ErrorEvent) {
      const error = event.error instanceof Error ? event.error : undefined;
      sendBrowserError({
        sourceEventId: resolveSourceEventId(error ?? event),
        routeTemplate: window.location.pathname,
        errorName: safeIdentifier(error?.name ?? "ErrorEvent", "BrowserError"),
        errorCode: safeIdentifier(readCode(error) ?? error?.name ?? "BrowserError", "BrowserError"),
        category: "rendering",
        severity: "p2",
        occurredAt: new Date().toISOString(),
        frames: extractSafeFrames(error),
      });
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason as BrowserErrorReason | undefined;
      const error = reason instanceof Error ? reason : undefined;
      sendBrowserError({
        sourceEventId: resolveSourceEventId(error ?? event),
        routeTemplate: window.location.pathname,
        errorName: safeIdentifier(error?.name ?? "UnhandledRejection", "BrowserError"),
        errorCode: safeIdentifier(readCode(error) ?? error?.name ?? "UnhandledRejection", "BrowserError"),
        category: "unknown",
        severity: "p2",
        occurredAt: new Date().toISOString(),
        frames: extractSafeFrames(error),
      });
    }

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}

function sendBrowserError(payload: Record<string, unknown>): void {
  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/internal/error-authority/browser", blob)) {
        return;
      }
    }
    void fetch("/api/internal/error-authority/browser", {
      method: "POST",
      cache: "no-store",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body,
    }).catch(() => undefined);
  } catch {
    // Browser capture must never create a second user-facing failure.
  }
}

function resolveSourceEventId(value: unknown): string {
  if (value && (typeof value === "object" || typeof value === "function")) {
    const existing = EVENT_IDS.get(value);
    if (existing) {
      return existing;
    }
    const next = `browser:${createRuntimeEventId()}`;
    EVENT_IDS.set(value, next);
    return next;
  }
  return `browser:${createRuntimeEventId()}`;
}

function createRuntimeEventId(): string {
  const cryptoLike = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoLike?.randomUUID === "function") {
    return cryptoLike.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function readCode(error: BrowserErrorReason | undefined): string | undefined {
  const code = error?.code;
  return typeof code === "string" ? code : undefined;
}

function safeIdentifier(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim().slice(0, 80);
  return text && /^[A-Za-z0-9_.:-]+$/.test(text) ? text : fallback;
}

function extractSafeFrames(error: Error | undefined) {
  if (!error?.stack) {
    return undefined;
  }
  const frames = error.stack
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .map(parseStackLine)
    .filter((frame): frame is NonNullable<ReturnType<typeof parseStackLine>> => Boolean(frame))
    .slice(0, 10);
  return frames.length ? frames : undefined;
}

function parseStackLine(line: string):
  | {
      file: string;
      functionName?: string;
      line?: number;
      column?: number;
    }
  | undefined {
  const match = line.match(/^at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
  if (!match) {
    return undefined;
  }
  return {
    functionName: sanitizeFrameText(match[1], 160),
    file: sanitizeFrameText(match[2], 240) ?? "unknown",
    line: Number(match[3]),
    column: Number(match[4]),
  };
}

function sanitizeFrameText(value: unknown, maxLength: number): string | undefined {
  const text = String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/[A-Z]:\/Users\/[^/]+/gi, "{userhome}")
    .replace(/\/home\/[^/]+/gi, "{userhome}")
    .split("?")[0]
    ?.split("#")[0]
    ?.trim()
    .slice(0, maxLength);
  return text || undefined;
}
