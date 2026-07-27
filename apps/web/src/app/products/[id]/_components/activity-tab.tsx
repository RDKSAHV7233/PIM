import type { ReactNode } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { translateExportStatus } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import type { ProductActivityEvent } from "@/lib/api";
import type { ProductDetailPageData } from "./product-detail-types";

const ACTION_LABELS: Record<string, string> = {
  STATUS_TRANSITION: "Status changed",
  REVIEW_DECISION: "Review decision",
  APPROVAL_COMMENT_ADDED: "Approval comment added",
  PRODUCT_UPDATED: "Product updated",
};

// Raw HTTP-method audit rows are written by a generic request-audit interceptor and are
// redundant with the more specific action (e.g. STATUS_TRANSITION) already logged for the
// same request — skip them so the timeline doesn't show two entries per action.
const HTTP_METHOD_ACTIONS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

function describeAuditEvent(event: ProductActivityEvent): string {
  const label = ACTION_LABELS[event.action] ?? event.action;
  const metadata = event.metadata ?? {};
  const fromStatus = typeof metadata.fromStatus === "string" ? metadata.fromStatus : undefined;
  const toStatus = typeof metadata.toStatus === "string" ? metadata.toStatus : undefined;
  if (fromStatus && toStatus) {
    return `${label}: ${fromStatus} → ${toStatus}`;
  }
  return label;
}

type TimelineEntry = {
  id: string;
  timestamp: string;
  content: ReactNode;
};

export function ActivityTab({ data }: { data: ProductDetailPageData }) {
  const jobEntries: TimelineEntry[] = data.recentJobs.map((job) => ({
    id: `job-${job.id}`,
    timestamp: job.updatedAt,
    content: (
      <>
        <p className="font-mono text-xs text-slate-700">{job.id}</p>
        <p className="text-slate-600">
          {job.channel} | {translateExportStatus(job.status)} | {formatDateTime(job.updatedAt)}
        </p>
      </>
    ),
  }));

  const auditEntries: TimelineEntry[] = data.activityEvents
    .filter((event) => !HTTP_METHOD_ACTIONS.has(event.action))
    .map((event) => ({
      id: `audit-${event.id}`,
      timestamp: event.createdAt,
      content: (
        <>
          <p className="text-sm font-medium text-slate-800">{describeAuditEvent(event)}</p>
          <p className="text-slate-600">
            {event.actorRole} | {formatDateTime(event.createdAt)}
          </p>
        </>
      ),
    }));

  const entries = [...jobEntries, ...auditEntries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <Card hidden={data.activeTab !== "activity"}>
      <CardTitle>Activity</CardTitle>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-600">No activity yet.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              {entry.content}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
