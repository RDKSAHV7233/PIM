import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getAuditEvents, type AuditEntityType, type AuditEventRecord } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

const ENTITY_TYPE_OPTIONS: Array<{ value: AuditEntityType; label: string }> = [
  { value: "product", label: "Product" },
  { value: "category", label: "Category" },
  { value: "mapping", label: "Mapping" },
  { value: "connector", label: "Connector" },
  { value: "user", label: "User" },
  { value: "plan", label: "Plan" },
  { value: "privacy", label: "Privacy" },
  { value: "auth", label: "Auth" },
  { value: "import", label: "Import" },
  { value: "job", label: "Job" },
  { value: "other", label: "Other" },
];

const ACTION_OPTIONS = [
  "POST",
  "PATCH",
  "DELETE",
  "STATUS_TRANSITION",
  "PLAN_TIER_CHANGE",
  "CONNECTOR_PERMISSION_GRANT",
  "CONNECTOR_PERMISSION_REVOKE",
  "auth.step_up_issued",
  "auth.step_up_denied",
  "consent.recorded",
  "account.export_requested",
  "account.deletion_scheduled",
];

interface AdminAuditPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getFirst(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildQuery(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && value.trim()) {
      search.set(key, value.trim());
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

function toneForEntity(entityType: AuditEntityType) {
  switch (entityType) {
    case "product":
    case "category":
      return "info" as const;
    case "mapping":
    case "connector":
      return "warning" as const;
    case "plan":
    case "privacy":
    case "auth":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
}

function buildRecordHref(row: AuditEventRecord) {
  if (!row.resourceId) {
    return null;
  }
  switch (row.entityType) {
    case "product":
      return `/products/${encodeURIComponent(row.resourceId)}`;
    case "category":
      return `/catalog/categories`;
    case "connector":
      return `/channels/connectors`;
    case "mapping":
      return `/channels/mappings`;
    default:
      return null;
  }
}

function summarizeMetadata(row: AuditEventRecord) {
  const metadata = row.metadata ?? {};
  const fromStatus = metadata.fromStatus ?? metadata.previous_state;
  const toStatus = metadata.toStatus ?? metadata.lifecycle_state;
  if (fromStatus && toStatus) {
    return `${String(fromStatus)} -> ${String(toStatus)}`;
  }
  if (metadata.principalId && metadata.connectorSlug && metadata.actionType) {
    return `${String(metadata.principalId)} | ${String(metadata.connectorSlug)} | ${String(metadata.actionType)}`;
  }
  if (metadata.policyVersion && metadata.purpose) {
    return `${String(metadata.policyVersion)} | ${String(metadata.purpose)}`;
  }
  if (metadata.scope && metadata.reason) {
    return `${String(metadata.scope)} | ${String(metadata.reason)}`;
  }
  if (metadata.model) {
    return String(metadata.model);
  }
  return "View details";
}

export default async function AdminAuditPage({ searchParams }: AdminAuditPageProps) {
  const query = await searchParams;
  const actorRole = await getServerActorRole();
  const authHeader = await getServerAuthHeader();

  const actorId = String(getFirst(query.actorId) ?? "").trim();
  const action = String(getFirst(query.action) ?? "").trim();
  const entityType = String(getFirst(query.entityType) ?? "").trim() as AuditEntityType | "";
  const dateFrom = String(getFirst(query.dateFrom) ?? "").trim();
  const dateTo = String(getFirst(query.dateTo) ?? "").trim();
  const cursor = String(getFirst(query.cursor) ?? "").trim();
  const limit = Number(getFirst(query.limit) ?? "50");

  try {
    const events = await getAuditEvents(
      {
        actorId: actorId || undefined,
        action: action || undefined,
        entityType: entityType || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        cursor: cursor || undefined,
        limit: Number.isFinite(limit) ? limit : 50,
      },
      { role: actorRole, authHeader },
    );

    const exportHref = `/api/admin/audit/export${buildQuery({
      actorId,
      action,
      entityType,
      dateFrom,
      dateTo,
      limit: String(Number.isFinite(limit) ? limit : 50),
    })}`;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Audit Logs"
          description="Explore governance events by actor, action, entity type, and time range."
          breadcrumb={
            <>
              <Link href="/dashboard" className="underline">
                Dashboard
              </Link>
              <span> / </span>
              <Link href="/admin" className="underline">
                Admin
              </Link>
              <span> / </span>
              <span className="font-semibold text-slate-700">Audit Logs</span>
            </>
          }
          actions={
            <>
              <a
                href={exportHref}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Export CSV
              </a>
              <Link
                href="/admin/audit"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Reset
              </Link>
            </>
          }
        />

        <FilterBar>
          <form method="get" className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="space-y-1">
              <label htmlFor="audit-actor" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Actor
              </label>
              <Input id="audit-actor" name="actorId" placeholder="user@workspace" defaultValue={actorId} />
            </div>
            <div className="space-y-1">
              <label htmlFor="audit-action" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Action
              </label>
              <Select id="audit-action" name="action" defaultValue={action}>
                <option value="">All actions</option>
                {ACTION_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label htmlFor="audit-entity" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Entity type
              </label>
              <Select id="audit-entity" name="entityType" defaultValue={entityType}>
                <option value="">All entity types</option>
                {ENTITY_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label htmlFor="audit-date-from" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Date from
              </label>
              <Input id="audit-date-from" name="dateFrom" type="date" defaultValue={dateFrom} />
            </div>
            <div className="space-y-1">
              <label htmlFor="audit-date-to" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Date to
              </label>
              <Input id="audit-date-to" name="dateTo" type="date" defaultValue={dateTo} />
            </div>
            <div className="space-y-1">
              <label htmlFor="audit-limit" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Page size
              </label>
              <Select id="audit-limit" name="limit" defaultValue={String(Number.isFinite(limit) ? limit : 50)}>
                {[25, 50, 100, 150, 200].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </Select>
            </div>
            <div className="xl:col-span-6 flex items-center gap-2">
              <button type="submit" className="rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800">
                Apply filters
              </button>
              <span className="text-sm text-slate-500">
                Showing {events.items.length} event{events.items.length === 1 ? "" : "s"} in this page.
              </span>
            </div>
          </form>
        </FilterBar>

        <Card>
          <CardTitle>Event Explorer</CardTitle>
          {events.items.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No audit events matched the current filters.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[1120px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Timestamp</th>
                    <th className="py-2">Actor</th>
                    <th className="py-2">Role</th>
                    <th className="py-2">Entity</th>
                    <th className="py-2">Action</th>
                    <th className="py-2">Resource</th>
                    <th className="py-2">Change</th>
                    <th className="py-2">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {events.items.map((row) => {
                    const recordHref = buildRecordHref(row);
                    return (
                      <tr key={row.id} className="border-t border-slate-200 align-top">
                        <td className="py-3 text-xs text-slate-600">{new Date(row.createdAt).toLocaleString()}</td>
                        <td className="py-3 font-medium text-slate-900">{row.actorId}</td>
                        <td className="py-3">
                          <StatusChip label={row.actorRole} tone="neutral" />
                        </td>
                        <td className="py-3">
                          <StatusChip label={row.entityType} tone={toneForEntity(row.entityType)} />
                        </td>
                        <td className="py-3 font-medium text-slate-900">{row.action}</td>
                        <td className="py-3">
                          <div className="space-y-1">
                            <div className="text-slate-700">{row.resource}</div>
                            {row.resourceId ? (
                              recordHref ? (
                                <Link href={recordHref} className="text-xs text-blue-700 underline">
                                  Open record {row.resourceId}
                                </Link>
                              ) : (
                                <div className="text-xs text-slate-500">{row.resourceId}</div>
                              )
                            ) : null}
                          </div>
                        </td>
                        <td className="py-3 text-slate-700">{summarizeMetadata(row)}</td>
                        <td className="py-3">
                          <details className="rounded-md border border-slate-200 bg-slate-50 p-2">
                            <summary className="cursor-pointer text-xs font-medium text-slate-700">Metadata</summary>
                            <pre className="mt-2 whitespace-pre-wrap break-all text-xs text-slate-600">
                              {JSON.stringify(row.metadata ?? {}, null, 2)}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {events.nextCursor ? (
            <div className="mt-4">
              <Link
                href={`/admin/audit${buildQuery({
                  actorId,
                  action,
                  entityType,
                  dateFrom,
                  dateTo,
                  limit: String(events.limit),
                  cursor: events.nextCursor,
                })}`}
                className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Load older events
              </Link>
            </div>
          ) : null}
        </Card>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/admin/audit", error.status));
    }
    throw error;
  }
}
