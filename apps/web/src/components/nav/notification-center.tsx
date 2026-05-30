"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AppDrawer } from "@/components/ui/app-drawer";
import { Button } from "@/components/ui/button";
import type { NotificationItem, NotificationListResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 30_000;

function eventSeverity(eventType: NotificationItem["eventType"]): "info" | "warning" | "blocker" {
  if (
    eventType === "publish_failed" ||
    eventType === "connector_down" ||
    eventType === "connector_credentials_expired" ||
    eventType === "scheduled_export_failed" ||
    eventType === "queue_dlq_threshold_exceeded"
  ) {
    return "blocker";
  }
  if (
    eventType === "import_failed" ||
    eventType === "import_repair_required" ||
    eventType === "readiness_blocker_detected" ||
    eventType === "mapping_validation_failed"
  ) {
    return "warning";
  }
  return "info";
}

function severityClasses(severity: "info" | "warning" | "blocker", readAt: string | null) {
  if (readAt) {
    return "border-slate-200 bg-white";
  }
  if (severity === "blocker") {
    return "border-red-200 bg-red-50/70";
  }
  if (severity === "warning") {
    return "border-amber-200 bg-amber-50/70";
  }
  return "border-blue-200 bg-blue-50/60";
}

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
    timeZone: "Asia/Kolkata",
  });
}

export function NotificationCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

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
    <AppDrawer
      open={open}
      onClose={() => setOpen(false)}
      title="Notifications"
      description={unreadCount > 0 ? `${unreadCount} unread` : "You're up to date"}
      width="lg"
      panelClassName="w-full max-w-md border-l border-slate-200 shadow-2xl"
      contentClassName="px-4 py-4"
      overlayClassName="bg-slate-900/20"
      closeLabel="Close notifications"
      headerActions={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void markAllRead()}
          disabled={submitting || unreadCount === 0}
        >
          Mark all read
        </Button>
      }
    >
      {loading ? <p className="px-2 py-6 text-sm text-slate-500">Loading notifications...</p> : null}
      {!loading && !hasItems ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
          <p className="text-sm font-medium text-slate-700">You're up to date</p>
          <p className="mt-1 text-sm text-slate-500">New import, publish, connector, mapping, and approval updates will appear here.</p>
        </div>
      ) : null}
      {!loading && hasItems ? (
        <>
        <ul className="space-y-3">
          {items.map((item) => {
            const severity = eventSeverity(item.eventType);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void openNotification(item)}
                  className={cn(
                    "w-full rounded-xl border px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50",
                    severityClasses(severity, item.readAt),
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            severity === "blocker"
                              ? "bg-red-100 text-red-700"
                              : severity === "warning"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-blue-100 text-blue-700",
                          )}
                        >
                          {severity}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{item.message}</p>
                      <p className="mt-2 text-xs text-slate-400">{formatTimestamp(item.createdAt)}</p>
                    </div>
                    {item.readAt ? null : <span className="mt-1 h-2.5 w-2.5 rounded-full bg-blue-600" aria-hidden />}
                  </div>
                  {item.actionLabel ? (
                    <p
                      className={cn(
                        "mt-3 text-xs font-semibold uppercase tracking-wide",
                        severity === "blocker"
                          ? "text-red-700"
                          : severity === "warning"
                            ? "text-amber-700"
                            : "text-blue-700",
                      )}
                    >
                      {item.actionLabel}
                    </p>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 border-t border-slate-100 pt-3 text-center">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="text-xs font-medium text-slate-500 hover:text-slate-800 hover:underline"
          >
            View all notifications
          </Link>
        </div>
        </>
      ) : null}
    </AppDrawer>
  ) : null;

  return (
    <>
      <button
        type="button"
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
