"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { NotificationItem, NotificationListResponse } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";

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
  if (severity === "blocker") {
    return "bg-red-100 text-red-700";
  }
  if (severity === "warning") {
    return "bg-amber-100 text-amber-700";
  }
  return "bg-blue-100 text-blue-700";
}

function severityActionClasses(severity: "info" | "warning" | "blocker") {
  if (severity === "blocker") {
    return "text-red-700";
  }
  if (severity === "warning") {
    return "text-amber-700";
  }
  return "text-blue-700";
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return formatDateTime(date);
}

function readCookie(name: string): string {
  if (typeof document === "undefined") {
    return "";
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

type NotificationFeedState = "loading" | "available" | "restricted" | "unavailable";
type NotificationActionState = "idle" | "submitting";
type NotificationFailure =
  | { kind: "session_expired"; status: number; body?: unknown }
  | { kind: "restricted" }
  | { kind: "unavailable" };
type NotificationFetchResult =
  | { state: "available"; value: NotificationListResponse }
  | { state: "failure"; failure: NotificationFailure };

const PAGE_SIZE = 20;

function isUnavailableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function NotificationsStatusState({
  title,
  description,
  tone,
  onRetry,
}: {
  title: string;
  description: string;
  tone: "restricted" | "unavailable";
  onRetry?: (() => void) | null;
}) {
  const isUnavailable = tone === "unavailable";
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`rounded-xl border px-4 py-5 shadow-sm ${
        isUnavailable ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"
      }`}
    >
      <h2 className={`text-sm font-semibold ${isUnavailable ? "text-amber-900" : "text-slate-900"}`}>
        {title}
      </h2>
      <p className={`mt-2 text-sm ${isUnavailable ? "text-amber-900/90" : "text-slate-700"}`}>
        {description}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {onRetry ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRetry}
          >
            Retry notifications
          </Button>
        ) : null}
        <Link
          href="/dashboard"
          className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Open dashboard
        </Link>
      </div>
    </div>
  );
}

function applyFailureState(failure: NotificationFailure): NotificationFeedState {
  if (failure.kind === "restricted") {
    return "restricted";
  }
  if (failure.kind === "unavailable") {
    return "unavailable";
  }
  return "loading";
}

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [feedState, setFeedState] = useState<NotificationFeedState>("loading");
  const [actionState, setActionState] = useState<NotificationActionState>("idle");
  const [actionNotice, setActionNotice] = useState<NotificationFailure | null>(null);
  const csrfToken = useMemo(() => readCookie("pim_csrf_token"), []);

  const redirectToLogin = useCallback((failure: { status: number; body?: unknown }) => {
    window.location.assign(buildLoginRedirect("/notifications", failure));
  }, []);

  const fetchPage = useCallback(async (cursor?: string | null): Promise<NotificationFetchResult> => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) {
      params.set("cursor", cursor);
      params.set("pagination", "cursor");
    }
    const response = await fetch(`/api/notifications?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    if (response.ok) {
      return {
        state: "available",
        value: (await response.json()) as NotificationListResponse,
      };
    }
    const body = await parseJsonSafely(response);
    if (response.status === 401) {
      return {
        state: "failure",
        failure: { kind: "session_expired", status: response.status, body },
      };
    }
    if (response.status === 403) {
      const errorCode =
        body && typeof body === "object" ? String((body as { error?: unknown }).error ?? "").trim().toUpperCase() : "";
      if (errorCode === "TENANT_SUSPENDED") {
        return {
          state: "failure",
          failure: { kind: "session_expired", status: response.status, body },
        };
      }
      return {
        state: "failure",
        failure: { kind: "restricted" },
      };
    }
    return {
      state: "failure",
      failure: { kind: isUnavailableStatus(response.status) ? "unavailable" : "restricted" },
    };
  }, []);

  const loadInitialFeed = useCallback(async () => {
    setFeedState("loading");
    setActionNotice(null);
    const result = await fetchPage(null);
    if (result.state === "failure") {
      if (result.failure.kind === "session_expired") {
        redirectToLogin(result.failure);
        return;
      }
      setItems([]);
      setUnreadCount(0);
      setNextCursor(null);
      setFeedState(applyFailureState(result.failure));
      return;
    }
    setItems(Array.isArray(result.value.items) ? result.value.items : []);
    setUnreadCount(Number(result.value.unreadCount ?? 0));
    setNextCursor(result.value.nextCursor ?? null);
    setFeedState("available");
  }, [fetchPage, redirectToLogin]);

  useEffect(() => {
    void loadInitialFeed();
  }, [loadInitialFeed]);

  async function loadMore() {
    if (!nextCursor || feedState !== "available" || actionState === "submitting") {
      return;
    }
    setActionState("submitting");
    setActionNotice(null);
    try {
      const result = await fetchPage(nextCursor);
      if (result.state === "failure") {
        if (result.failure.kind === "session_expired") {
          redirectToLogin(result.failure);
          return;
        }
        setActionNotice(result.failure);
        return;
      }
      setItems((previousItems) => [
        ...previousItems,
        ...(Array.isArray(result.value.items) ? result.value.items : []),
      ]);
      setUnreadCount(Number(result.value.unreadCount ?? 0));
      setNextCursor(result.value.nextCursor ?? null);
    } finally {
      setActionState("idle");
    }
  }

  async function markAllRead() {
    if (actionState === "submitting" || unreadCount === 0 || feedState !== "available") {
      return;
    }
    setActionState("submitting");
    setActionNotice(null);
    const previousItems = items;
    const previousUnread = unreadCount;
    const readAt = new Date().toISOString();
    setItems((current) => current.map((item) => (item.readAt ? item : { ...item, readAt })));
    setUnreadCount(0);
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
      });
      if (response.ok) {
        return;
      }
      const body = await parseJsonSafely(response);
      setItems(previousItems);
      setUnreadCount(previousUnread);
      if (response.status === 401 || (response.status === 403 && body && typeof body === "object" && String((body as { error?: unknown }).error ?? "").trim().toUpperCase() === "TENANT_SUSPENDED")) {
        redirectToLogin({ status: response.status, body });
        return;
      }
      setActionNotice({ kind: response.status === 403 ? "restricted" : "unavailable" });
    } finally {
      setActionState("idle");
    }
  }

  async function openNotification(item: NotificationItem) {
    if (actionState === "submitting") {
      return;
    }
    setActionState("submitting");
    setActionNotice(null);
    const didOptimisticallyRead = !item.readAt;
    const optimisticReadAt = new Date().toISOString();
    if (didOptimisticallyRead) {
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, readAt: optimisticReadAt } : entry)),
      );
      setUnreadCount((current) => Math.max(0, current - 1));
    }
    try {
      if (didOptimisticallyRead) {
        const response = await fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
          },
        });
        if (!response.ok) {
          const body = await parseJsonSafely(response);
          setItems((current) =>
            current.map((entry) => (entry.id === item.id ? { ...entry, readAt: item.readAt } : entry)),
          );
          setUnreadCount((current) => current + 1);
          if (response.status === 401 || (response.status === 403 && body && typeof body === "object" && String((body as { error?: unknown }).error ?? "").trim().toUpperCase() === "TENANT_SUSPENDED")) {
            redirectToLogin({ status: response.status, body });
            return;
          }
          setActionNotice({ kind: response.status === 403 ? "restricted" : "unavailable" });
        }
      }
      if (item.actionUrl) {
        router.push(item.actionUrl);
      }
    } finally {
      setActionState("idle");
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
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>
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
            disabled={actionState === "submitting" || unreadCount === 0 || feedState !== "available"}
          >
            Mark all read
          </Button>
        </div>
      </div>

      {actionNotice?.kind === "restricted" ? (
        <NotificationsStatusState
          title="Notification updates are restricted"
          description="You can still view the current feed, but marking notifications as read is limited for your role right now."
          tone="restricted"
        />
      ) : actionNotice?.kind === "unavailable" ? (
        <NotificationsStatusState
          title="Notification updates are temporarily unavailable"
          description="The notification feed is visible, but update actions could not be confirmed. Try again in a moment."
          tone="unavailable"
        />
      ) : null}

      {feedState === "restricted" ? (
        <NotificationsStatusState
          title="Notifications are restricted"
          description="Your role can open the workspace, but the notification feed is not available to it."
          tone="restricted"
        />
      ) : null}

      {feedState === "unavailable" ? (
        <NotificationsStatusState
          title="Notifications are temporarily unavailable"
          description="We could not load the notification feed right now. The page is held in an unavailable state instead of showing a false empty inbox."
          tone="unavailable"
          onRetry={() => void loadInitialFeed()}
        />
      ) : null}

      {feedState === "available" && unreadCount > 0 ? (
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{unreadCount}</span> unread notification{unreadCount !== 1 ? "s" : ""}
        </p>
      ) : null}

      {feedState === "loading" ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
          ))}
        </div>
      ) : null}

      {feedState === "available" && !hasItems ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-16 text-center">
          <p className="text-sm font-medium text-slate-700">You're up to date</p>
          <p className="mt-1 text-sm text-slate-500">
            New import, publish, connector, mapping, and approval updates will appear here.
          </p>
        </div>
      ) : null}

      {feedState === "available" && hasItems ? (
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

      {feedState === "available" && nextCursor ? (
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void loadMore()}
            disabled={actionState === "submitting"}
          >
            {actionState === "submitting" ? "Loading..." : "Load more"}
          </Button>
        </div>
      ) : null}

      {feedState === "available" && hasItems && !nextCursor ? (
        <p className="text-center text-xs text-slate-400">All notifications loaded</p>
      ) : null}
    </div>
  );
}
