"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NotificationItem, NotificationListResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 30_000;

function readCookie(name: string): string {
  if (typeof document === "undefined") {
    return "";
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("h-5 w-5", className)}
    >
      <path d="M6.5 9a5.5 5.5 0 1 1 11 0v4.2l1.5 2.8H5l1.5-2.8V9Z" />
      <path d="M9.5 18a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
}

export function NotificationCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }
      return;
    }
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
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
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    const focusTimer = window.setTimeout(() => {
      const focusable = getFocusableElements(drawerRef.current);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        drawerRef.current?.focus();
      }
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/notifications?limit=12", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as NotificationListResponse;
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setUnreadCount(Number(payload.unreadCount ?? 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => {
      void loadNotifications();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  const hasItems = items.length > 0;
  const csrfToken = useMemo(() => readCookie("pim_csrf_token"), []);

  async function markAllRead() {
    setSubmitting(true);
    const previousItems = items;
    const previousUnreadCount = unreadCount;
    const readAt = new Date().toISOString();
    setItems((current) =>
      current.map((item) =>
        item.readAt
          ? item
          : {
              ...item,
              readAt,
            },
      ),
    );
    setUnreadCount(0);
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
      });
      if (!response.ok) {
        setItems(previousItems);
        setUnreadCount(previousUnreadCount);
        await loadNotifications();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function openNotification(item: NotificationItem) {
    setSubmitting(true);
    if (!item.readAt) {
      const readAt = new Date().toISOString();
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                readAt,
              }
            : entry,
        ),
      );
      setUnreadCount((current) => Math.max(0, current - 1));
    }
    try {
      if (!item.readAt) {
        const response = await fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
          },
        });
        if (!response.ok) {
          await loadNotifications();
        }
      }
      setOpen(false);
      if (item.actionUrl) {
        router.push(item.actionUrl);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const drawer = open ? (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/20"
        aria-label="Close notifications"
        onClick={() => setOpen(false)}
      />
      <aside
        ref={drawerRef}
        className="absolute inset-y-0 right-0 flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        tabIndex={-1}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Notifications</h2>
            <p className="text-sm text-slate-500">{unreadCount > 0 ? `${unreadCount} unread` : "You're up to date"}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={submitting || unreadCount === 0}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Mark all read
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? <p className="px-2 py-6 text-sm text-slate-500">Loading notifications...</p> : null}
          {!loading && !hasItems ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
              <p className="text-sm font-medium text-slate-700">You're up to date</p>
              <p className="mt-1 text-sm text-slate-500">New import, publish, and approval updates will appear here.</p>
            </div>
          ) : null}
          {!loading && hasItems ? (
            <ul className="space-y-3">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void openNotification(item)}
                    className={cn(
                      "w-full rounded-xl border px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50",
                      item.readAt ? "border-slate-200 bg-white" : "border-blue-200 bg-blue-50/60",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                        <p className="mt-1 text-sm text-slate-600">{item.message}</p>
                        <p className="mt-2 text-xs text-slate-400">{formatTimestamp(item.createdAt)}</p>
                      </div>
                      {item.readAt ? null : <span className="mt-1 h-2.5 w-2.5 rounded-full bg-blue-600" aria-hidden />}
                    </div>
                    {item.actionLabel ? <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-blue-700">{item.actionLabel}</p> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </aside>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className="relative rounded-md border border-slate-200 bg-white px-2.5 py-2 text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
        aria-label="Open notifications"
      >
        <BellIcon />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>
      {drawer ? createPortal(drawer, document.body) : null}
    </>
  );
}
