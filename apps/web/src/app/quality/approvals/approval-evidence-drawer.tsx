"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AppDrawer } from "@/components/ui/app-drawer";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip } from "@/components/ui/status-chip";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import type { ProductRevision } from "@/lib/api";

interface ApprovalEvidenceDrawerProps {
  productTitle: string;
  productHref: string;
  productQualityHref: string;
  blockingCount: number;
  warningCount: number;
  revisions: ProductRevision[];
}

function formatRevisionValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function summarizeDecisionNote(note: string | null | undefined): string | null {
  const normalized = String(note ?? "").trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
}

function formatRevisionTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown timestamp" : date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

export function ApprovalEvidenceDrawer({
  productTitle,
  productHref,
  productQualityHref,
  blockingCount,
  warningCount,
  revisions,
}: ApprovalEvidenceDrawerProps) {
  const [open, setOpen] = useState(false);
  const latestRevision = revisions[0] ?? null;
  const latestFields = latestRevision?.changedFields.slice(0, 2) ?? [];
  const latestNote = summarizeDecisionNote((latestRevision as unknown as Record<string, unknown>)?.decisionNote as string | null);

  const historyTimeline = useMemo<TimelineItem[]>(
    () =>
      revisions.map((revision): TimelineItem => ({
        id: revision.revisionId,
        title: `${revision.action} by ${revision.actorLabel} (${revision.actorRole})`,
        meta: formatRevisionTimestamp(revision.createdAt),
        description:
          revision.changedFields.length > 0
            ? revision.changedFields
                .slice(0, 3)
                .map(
                  (field) =>
                    `${field.label}: ${formatRevisionValue(field.before)} to ${formatRevisionValue(field.after)}`,
                )
                .join(" | ")
            : "No field-level changes recorded in this revision entry.",
        tone:
          revision.action === "REVIEW_DECISION"
            ? "info"
            : revision.summary.changedSectionCount > 1
              ? "warning"
              : "neutral",
      })),
    [revisions],
  );

  const drawer = open ? (
    <AppDrawer
      open={open}
      onClose={() => setOpen(false)}
      title="Approval Evidence"
      description={`Review field-level changes for ${productTitle} before recording a final decision.`}
      width="lg"
      panelClassName="w-full max-w-3xl border-l border-slate-200 shadow-2xl"
      contentClassName="space-y-4 px-4 py-4"
      closeLabel={`Close approval evidence for ${productTitle}`}
      headerActions={
        <Link
          href={productQualityHref}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Open product quality
        </Link>
      }
    >
      <Card>
        <CardTitle>Review Coverage</CardTitle>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusChip
            label={blockingCount > 0 ? `${blockingCount} blocking issues` : "No blocking issues"}
            tone={blockingCount > 0 ? "danger" : "success"}
          />
          <StatusChip
            label={warningCount > 0 ? `${warningCount} warnings` : "No warnings"}
            tone={warningCount > 0 ? "warning" : "neutral"}
          />
          <StatusChip
            label={revisions.length > 0 ? `${revisions.length} revision entries` : "No revision history yet"}
            tone={revisions.length > 0 ? "info" : "neutral"}
          />
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Use revision evidence first, then open the product workflow only when you need deeper readiness context.
        </p>
      </Card>

      {latestRevision ? (
        <Card>
          <CardTitle>Latest Revision Summary</CardTitle>
          <div className="space-y-3 text-sm text-slate-700">
            <p>
              <strong>Reviewer activity:</strong> {latestRevision.actorLabel} ({latestRevision.actorRole})
            </p>
            <p>
              <strong>Recorded at:</strong> {formatRevisionTimestamp(latestRevision.createdAt)}
            </p>
            <div className="flex flex-wrap gap-2">
              <StatusChip
                label={`${latestRevision.summary.changedFieldCount} changed fields`}
                tone={latestRevision.summary.changedFieldCount > 0 ? "info" : "neutral"}
              />
              <StatusChip
                label={`${latestRevision.summary.changedSectionCount} changed sections`}
                tone={latestRevision.summary.changedSectionCount > 1 ? "warning" : "neutral"}
              />
            </div>
            {latestNote ? (
              <p>
                <strong>Decision note:</strong> {latestNote}
              </p>
            ) : null}
            <div className="space-y-2">
              <p className="font-medium text-slate-900">Changed fields summary</p>
              <ul className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                {latestRevision.changedFields.map((field) => (
                  <li key={`${latestRevision.revisionId}-${field.path}`} className="space-y-1 text-sm text-slate-700">
                    <p className="font-medium text-slate-900">{field.label}</p>
                    <p>
                      <span className="font-medium">Before:</span> {formatRevisionValue(field.before)}
                    </p>
                    <p>
                      <span className="font-medium">After:</span> {formatRevisionValue(field.after)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      ) : (
        <EmptyState
          icon="INFO"
          title="No revision evidence recorded yet"
          description="This product is in review, but no field-level audit entry has been recorded yet. Open the product workflow to confirm what changed before approving."
          helperBullets={[
            "Check the product quality tab for unresolved blockers or warnings.",
            "Use rejection if the workflow still needs editor follow-up and evidence is missing.",
          ]}
          action={{ label: "Open product quality", href: productQualityHref }}
          secondaryAction={{ label: "Open product detail", href: productHref }}
        />
      )}

      {historyTimeline.length > 0 ? (
        <Card>
          <CardTitle>Revision Timeline</CardTitle>
          <Timeline items={historyTimeline} className="mt-3" />
        </Card>
      ) : null}

      <Card>
        <CardTitle>Reviewer Actions</CardTitle>
        <div className="space-y-2 text-sm text-slate-700">
          <p>
            <strong>Approve only when blockers are clear.</strong> Approval stays disabled in the queue when blocking issues remain for this product.
          </p>
          <p>
            <strong>Reject when follow-up is still needed.</strong> Use the reviewer note in the queue to capture why the product is returning to the editor.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={productQualityHref}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open quality context
          </Link>
          <Link
            href={productHref}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open product detail
          </Link>
        </div>
      </Card>
    </AppDrawer>
  ) : null;

  return (
    <>
      {latestRevision ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-900">
            {latestRevision.summary.changedFieldCount} change(s) in {latestRevision.summary.changedSectionCount} section(s)
          </p>
          <p className="text-xs text-slate-500">
            Latest activity by {latestRevision.actorLabel} ({latestRevision.actorRole}) on{" "}
            {formatRevisionTimestamp(latestRevision.createdAt)}
          </p>
          <div className="flex flex-wrap gap-2">
            <StatusChip
              label={`${latestRevision.summary.changedFieldCount} changed fields`}
              tone={latestRevision.summary.changedFieldCount > 0 ? "info" : "neutral"}
            />
            <StatusChip
              label={`${latestRevision.summary.changedSectionCount} changed sections`}
              tone={latestRevision.summary.changedSectionCount > 1 ? "warning" : "neutral"}
            />
          </div>
          {latestNote ? <p className="text-xs text-slate-600">Latest reviewer note: {latestNote}</p> : null}
          {latestFields.length > 0 ? (
            <ul className="space-y-1 text-xs text-slate-600">
              {latestFields.map((field) => (
                <li key={`${latestRevision.revisionId}-${field.path}`}>
                  <span className="font-medium">{field.label}:</span> {formatRevisionValue(field.before)} to{" "}
                  {formatRevisionValue(field.after)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-600">No recorded revision evidence yet.</p>
      )}

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        aria-label={`Review approval evidence for ${productTitle}`}
      >
        Review evidence
      </button>

      {drawer ? createPortal(drawer, document.body) : null}
    </>
  );
}
