"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { NotificationItem, NotificationListResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

// ── Severity helpers (mirrors notification-center.tsx) ────────────────────────

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

function severityBadgeClasses(severity: "info" | "warning" | "blocker") {
  if (severity === "blocker") return "bg-red-100 text-red-700";
  if (severity === "warning") return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
}

function severityActionClasses(severity: "info" | "warning" | "blocker") {
  if (severity === "blocker") return "text-red-700";
  if (severity === "warning") return "text-amber-700";
  return "text-blue-700";
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
}

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

// ── Page component ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const csrfToken = useMemo(() => readCookie("pim_csrf_token"), []);

  const fetchPage = useCallback(async (cursor?: string | null) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) {
      params.set("cursor", cursor);
      params.set("pagination", "cursor");
    }
    const response = await fetch(`/api/notifications?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as NotificationListResponse;
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const data = await fetchPage(null);
        if (data) {
          setItems(Array.isArray(data.items) ? data.items : []);
          setUnreadCount(Number(data.unreadCount ?? 0));
          setNextCursor(data.nextCursor ?? null);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchPage]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchPage(nextCursor);
      if (data) {
        setItems((prev) => [...prev, ...(Array.isArray(data.items) ? data.items : [])]);
        setUnreadCount(Number(data.unreadCount ?? 0));
        setNextCursor(data.nextCursor ?? null);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  async function markAllRead() {
    if (submitting || unreadCount === 0) return;
    setSubmitting(true);
    const previousItems = items;
    const previousUnread = unreadCount;
    const readAt = new Date().toISOString();
    setItems((current) =>
      current.map((item) => (item.readAt ? item : { ...item, readAt })),
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
        setUnreadCount(previousUnread);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function openNotification(item: NotificationItem) {
    if (submitting) return;
    setSubmitting(true);
    if (!item.readAt) {
      const readAt = new Date().toISOString();
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, readAt } : entry)),
      );
      setUnreadCount((current) => Math.max(0, current - 1));
    }
    try {
      if (!item.readAt) {
        await fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
          },
        });
      }
      if (item.actionUrl) {
        router.push(item.actionUrl);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const hasItems = items.length > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Notifications"
          description="Full history of import, publish, connector, mapping, and approval updates."
          breadcrumb={
            <nav className="mb-1 text-xs text-slate-500">
              <Link href="/" className="hover:underline">Home</Link>
              <span className="mx-1">/</span>
              <span>Notifications</span>
            </nav>
          }
        />
        <div className="shrink-0 pt-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void markAllRead()}
            disabled={submitting || unreadCount === 0}
          >
            Mark all read
          </Button>
        </div>
      </div>

      {unreadCount > 0 ? (
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{unreadCount}</span> unread notification{unreadCount !== 1 ? "s" : ""}
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
          ))}
        </div>
      ) : null}

      {!loading && !hasItems ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-16 text-center">
          <p className="text-sm font-medium text-slate-700">You're up to date</p>
          <p className="mt-1 text-sm text-slate-500">
            New import, publish, connector, mapping, and approval updates will appear here.
          </p>
        </div>
      ) : null}

      {!loading && hasItems ? (
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
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            severityBadgeClasses(severity),
                          )}
                        >
                          {severity}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{item.message}</p>
                      <p className="mt-2 text-xs text-slate-400">{formatTimestamp(item.createdAt)}</p>
                      {item.actionLabel ? (
                        <p
                          className={cn(
                            "mt-2 text-xs font-semibold uppercase tracking-wide",
                            severityActionClasses(severity),
                          )}
                        >
                          {item.actionLabel}
                        </p>
                      ) : null}
                    </div>
                    {item.readAt ? null : (
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600" aria-hidden />
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!loading && nextCursor ? (
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading..." : "Load more"}
          </Button>
        </div>
      ) : null}

      {!loading && hasItems && !nextCursor ? (
        <p className="text-center text-xs text-slate-400">All notifications loaded</p>
      ) : null}
    </div>
  );
}
