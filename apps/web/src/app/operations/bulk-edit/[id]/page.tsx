import Link from "@/components/ui/app-link";
import { notFound, redirect } from "next/navigation";
import { ApiHttpError, getBulkEditItemPlanLimitPayload, getBulkEditOperation } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { translateBulkEditStatus } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { getServerSession } from "@/lib/server-session";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import type { BulkEditOperationItem } from "@/lib/api/core";

export const dynamic = "force-dynamic";

interface BulkEditOperationPageProps {
  params: Promise<{ id: string }>;
}

function operationStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "completed":
      return "success";
    case "completed_with_errors":
      return "warning";
    case "failed":
      return "danger";
    case "processing":
      return "info";
    default:
      return "neutral";
  }
}

function itemStatusTone(status: BulkEditOperationItem["status"]): "success" | "danger" {
  return status === "failed" ? "danger" : "success";
}

export default async function BulkEditOperationPage({ params }: BulkEditOperationPageProps) {
  const { id } = await params;
  const { authHeader, actorRole } = await getServerSession();

  let operation;
  try {
    operation = await getBulkEditOperation(id, { role: actorRole, authHeader });
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      if (error.status === 401 || error.status === 403) {
        redirect(buildLoginRedirect(`/operations/bulk-edit/${encodeURIComponent(id)}`, error));
      }
      if (error.status === 404) {
        notFound();
      }
    }
    throw error;
  }

  const items = operation.items ?? [];
  const failedItems = items.filter((item) => item.status === "failed");
  const successItems = items.filter((item) => item.status === "success");
  // Server-rendered on every load — not a dismissible toast a fast click can miss, and it
  // reflects the operation's persisted failedCount even if the items page below is truncated.
  const hasFailures = operation.failedCount > 0;

  const failedColumns: Column<BulkEditOperationItem>[] = [
    {
      key: "product",
      header: "Product",
      render: (item) =>
        item.productId ? (
          <Link href={`/products/${encodeURIComponent(item.productId)}`} className="font-mono text-xs text-blue-700 underline hover:text-blue-900">
            {item.productId}
          </Link>
        ) : (
          <span className="text-xs text-slate-500">—</span>
        ),
    },
    {
      key: "reason",
      header: "Why it failed",
      // CTO review follow-up (PR #719, 2026-09-05): a plan-limit failure gets the same
      // "you're at your plan limit, upgrade here" treatment every other flow (single-
      // product approval, export, media upload) already shows for the identical
      // condition, instead of a bare error string with no path forward.
      render: (item) => {
        const planLimit = getBulkEditItemPlanLimitPayload(item);
        if (planLimit) {
          return (
            <span className="text-sm text-red-900">
              Plan limit reached: {planLimit.current} of {planLimit.limit} allowed {planLimit.resource}.{" "}
              <Link href={planLimit.upgrade_url} className="font-medium text-blue-700 underline hover:text-blue-900">
                Upgrade plan
              </Link>
            </span>
          );
        }
        return <span className="text-sm text-red-900">{item.errorMessage ?? "No error message recorded."}</span>;
      },
    },
  ];

  const successColumns: Column<BulkEditOperationItem>[] = [
    {
      key: "product",
      header: "Product",
      render: (item) =>
        item.productId ? (
          <Link href={`/products/${encodeURIComponent(item.productId)}`} className="font-mono text-xs text-blue-700 underline hover:text-blue-900">
            {item.productId}
          </Link>
        ) : (
          <span className="text-xs text-slate-500">—</span>
        ),
    },
    { key: "status", header: "Status", render: (item) => <StatusChip label="Applied" tone={itemStatusTone(item.status)} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bulk Edit Operation"
        description={`Requested ${formatDateTime(operation.createdAt)}`}
        breadcrumb={
          <>
            <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}
            <Link href="/operations" className="hover:underline">Operations</Link>{" / "}
            <Link href="/operations/bulk-edit" className="hover:underline">Bulk Edit</Link>{" / "}
            <span className="font-semibold text-slate-700">{operation.id}</span>
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Summary</CardTitle>
          <StatusChip label={translateBulkEditStatus(operation.status)} tone={operationStatusTone(operation.status)} />
        </div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Requested</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">{operation.requestedCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Applied</dt>
            <dd className="mt-1 text-lg font-semibold text-emerald-700">{operation.appliedCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Failed</dt>
            <dd className={`mt-1 text-lg font-semibold ${operation.failedCount > 0 ? "text-red-700" : "text-slate-900"}`}>
              {operation.failedCount}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Updates applied</dt>
            <dd className="mt-1 font-mono text-xs text-slate-700">{JSON.stringify(operation.updates)}</dd>
          </div>
        </dl>
      </Card>

      {hasFailures ? (
        <InlineAlert
          tone="error"
          title={`${operation.failedCount} of ${operation.requestedCount} product${operation.requestedCount === 1 ? "" : "s"} failed`}
          message="Each failure below kept its own reason — review them before retrying, since re-running the same scope will hit the same rejection for the same products."
        />
      ) : operation.status === "completed" ? (
        <InlineAlert tone="success" message="Every requested product was updated successfully." />
      ) : null}

      {failedItems.length > 0 ? (
        <Card>
          <CardTitle>Failed items ({failedItems.length})</CardTitle>
          <div className="mt-3">
            <DataGrid columns={failedColumns} rows={failedItems} getRowKey={(item) => item.id} rowClassName="align-top" />
          </div>
        </Card>
      ) : null}

      {successItems.length > 0 ? (
        <Card>
          <CardTitle>Applied successfully ({successItems.length})</CardTitle>
          <div className="mt-3">
            <DataGrid columns={successColumns} rows={successItems} getRowKey={(item) => item.id} rowClassName="align-top" />
          </div>
        </Card>
      ) : null}

      {items.length === 0 && operation.status !== "queued" && operation.status !== "processing" ? (
        <Card>
          <p className="text-sm text-slate-600">No per-item results were recorded for this operation.</p>
        </Card>
      ) : null}

      {operation.status === "queued" || operation.status === "processing" ? (
        <InlineAlert
          tone="info"
          message="This operation is still running. Refresh this page in a moment to see per-item results as they complete."
        />
      ) : null}

      {operation.itemsNextCursor ? (
        <p className="text-xs text-slate-500">
          Showing the first {items.length} items. This operation has more — narrow scope to inspect further batches isn&apos;t supported yet from this view.
        </p>
      ) : null}
    </div>
  );
}
