import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/ui/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { JsonPreview } from "@/components/ui/json-preview";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getAuditEvents, type AuditEntityType, type AuditEventRecord } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";
import { isSystemAdminBoundary } from "@/lib/role-capabilities";
import { formatDateTime } from "@/lib/format";
import { SystemAdminRequiredCard } from "@/components/ui/system-admin-required-card";

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
  "TENANT_BILLING_STATUS_SET",
  "TENANT_BILLING_CONTACT_UPDATED",
  "TENANT_ACCESS_SUSPENDED",
  "TENANT_ACCESS_RESUMED",
  "COMMERCIAL_MUTATION_BLOCKED",
  "COMMERCIAL_UPGRADE_REQUEST_CREATED",
  "COMMERCIAL_UPGRADE_REQUEST_REUSED",
  "COMMERCIAL_UPGRADE_REQUEST_LISTED",
  "COMMERCIAL_UPGRADE_REQUEST_EXPORTED",
  "COMMERCIAL_UPGRADE_REQUEST_STATUS_UPDATED",
  "COMMERCIAL_OVERVIEW_VIEWED",
  "COMMERCIAL_TENANT_EXPORTED",
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
  if (metadata.planTier || metadata.billingStatus || metadata.accessStatus) {
    return [metadata.planTier, metadata.billingStatus, metadata.accessStatus, metadata.suspensionReason]
      .filter((value) => String(value ?? "").trim().length > 0)
      .map((value) => String(value))
      .join(" | ");
  }
  if (metadata.scope && metadata.reason) {
    return `${String(metadata.scope)} | ${String(metadata.reason)}`;
  }
  if (metadata.model) {
    return String(metadata.model);
  }
  return "View details";
}

function summarizeFilterScope(input: {
  actorId: string;
  action: string;
  entityType: AuditEntityType | "";
  dateFrom: string;
  dateTo: string;
}) {
  const parts = [
    input.actorId ? `Actor ${input.actorId}` : null,
    input.action ? `Action ${input.action}` : null,
    input.entityType ? `Entity ${input.entityType}` : null,
    input.dateFrom ? `From ${input.dateFrom}` : null,
    input.dateTo ? `To ${input.dateTo}` : null,
  ].filter((value) => Boolean(value));

  return parts.length > 0 ? parts.join(" | ") : "All governance events in the current workspace scope.";
}

export default async function AdminAuditPage({ searchParams }: AdminAuditPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole, adminBoundaryRoles } = await getServerSession();
  if (!isSystemAdminBoundary(adminBoundaryRoles)) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Audit Logs"
          description="Explore governance events by actor, action, entity type, and time range."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/admin" className="hover:underline">Admin</Link>{" / "}<span className="font-semibold text-slate-700">Audit Logs</span>
            </>
          }
        />
        <SystemAdminRequiredCard surfaceLabel="Audit logs" />
      </div>
    );
  }
  if (actorRole !== "admin") {
    redirect("/admin");
  }

  const actorId = String(getFirst(query.actorId) ?? "").trim();
  const action = String(getFirst(query.action) ?? "").trim();
  const resourceId = String(getFirst(query.resourceId) ?? "").trim();
  const entityType = String(getFirst(query.entityType) ?? "").trim() as AuditEntityType | "";
  const dateFrom = String(getFirst(query.dateFrom) ?? "").trim();
  const dateTo = String(getFirst(query.dateTo) ?? "").trim();
  const cursor = String(getFirst(query.cursor) ?? "").trim();
  // AL-02: whitelist valid page sizes
  const VALID_LIMITS = new Set([25, 50, 100, 150, 200]);
  const limitRaw = Number(getFirst(query.limit) ?? "50");
  const limit = VALID_LIMITS.has(limitRaw) ? limitRaw : 50;

  try {
    const events = await getAuditEvents(
      {
        actorId: actorId || undefined,
        action: action || undefined,
        resourceId: resourceId || undefined,
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
      resourceId,
      entityType,
      dateFrom,
      dateTo,
      limit: String(Number.isFinite(limit) ? limit : 50),
    })}`;
    const entityCounts = events.items.reduce<Record<string, number>>((accumulator, event) => {
      accumulator[event.entityType] = (accumulator[event.entityType] ?? 0) + 1;
      return accumulator;
    }, {});
    const topEntityEntries = Object.entries(entityCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3);
    const mutationEvents = events.items.filter(
      (event) => event.action === "POST" || event.action === "PATCH" || event.action === "DELETE",
    ).length;
    const accessEvents = events.items.filter(
      (event) => event.entityType === "auth" || event.entityType === "privacy" || event.entityType === "plan",
    ).length;
    const scopeSummary = summarizeFilterScope({ actorId, action, entityType, dateFrom, dateTo });

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
          <form method="get" action="/admin/audit" className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
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
              <label htmlFor="audit-resource-id" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Resource ID
              </label>
              <Input id="audit-resource-id" name="resourceId" placeholder="tenant key or request id" defaultValue={resourceId} />
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
            <div className="space-y-1 xl:col-span-2">
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
              <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
                Apply filters
              </button>
              <span className="text-sm text-slate-500">
                Showing {events.items.length} event{events.items.length === 1 ? "" : "s"} in this page.
              </span>
            </div>
          </form>
        </FilterBar>

        <Card>
          <CardTitle>Governance summary</CardTitle>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                Use this summary to understand what changed before opening raw metadata. Filter scope:
              </p>
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {scopeSummary}
              </p>
              <div className="flex flex-wrap gap-2">
                <StatusChip label={`Mutation events ${mutationEvents}`} tone={mutationEvents > 0 ? "info" : "neutral"} />
                <StatusChip label={`Access + policy ${accessEvents}`} tone={accessEvents > 0 ? "danger" : "neutral"} />
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-900">Top entity families in this page</p>
              {topEntityEntries.length === 0 ? (
                <p className="text-sm text-slate-600">No audit events matched the current filters.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {topEntityEntries.map(([entity, count]) => (
                    <li key={entity} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                      <span className="text-slate-700">{entity}</span>
                      <StatusChip label={`${count} events`} tone={toneForEntity(entity as AuditEntityType)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>Event Explorer</CardTitle>
          <div className="mt-3">
            <DataGrid
              columns={[
                {
                  key: "createdAt",
                  header: "Timestamp",
                  cellClassName: "text-xs text-slate-600",
                  render: (row) => formatDateTime(row.createdAt),
                },
                {
                  key: "actorId",
                  header: "Actor",
                  cellClassName: "font-medium text-slate-900",
                },
                {
                  key: "actorRole",
                  header: "Role",
                  mobileHide: true,
                  render: (row) => <StatusChip label={row.actorRole} tone="neutral" />,
                },
                {
                  key: "entityType",
                  header: "Entity",
                  mobileHide: true,
                  render: (row) => <StatusChip label={row.entityType} tone={toneForEntity(row.entityType)} />,
                },
                {
                  key: "action",
                  header: "Action",
                  cellClassName: "font-medium text-slate-900",
                },
                {
                  key: "resource",
                  header: "Resource",
                  render: (row) => {
                    const recordHref = buildRecordHref(row);
                    return (
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
                    );
                  },
                },
                {
                  key: "change",
                  header: "Change",
                  mobileHide: true,
                  cellClassName: "text-slate-700",
                  render: (row) => summarizeMetadata(row),
                },
                {
                  key: "details",
                  header: "Details",
                  mobileHide: true,
                  render: (row) => (
                    <details className="rounded-md border border-slate-200 bg-slate-50 p-2">
                      <summary className="cursor-pointer text-xs font-medium text-slate-700">Metadata</summary>
                      <JsonPreview value={JSON.stringify(row.metadata ?? {}, null, 2)} className="mt-2 border-0 bg-transparent p-0 text-slate-600" />
                    </details>
                  ),
                },
              ]}
              rows={events.items}
              getRowKey={(row) => row.id}
              caption="Audit Events"
              rowClassName="align-top"
              emptyState={<p className="text-sm text-slate-600">No audit events matched the current filters.</p>}
            />
          </div>
          {events.nextCursor ? (
            <div className="mt-4">
              <Link
                href={`/admin/audit${buildQuery({
                  actorId,
                  action,
                  resourceId,
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
      redirect(buildLoginRedirect("/admin/audit", error));
    }
    return (
      <div className="space-y-5">
        <PageHeader
          title="Audit Logs"
          description="Governance event log is temporarily unavailable."
          breadcrumb={
            <>
              <Link href="/dashboard" className="underline">Dashboard</Link>
              <span> / </span>
              <Link href="/admin" className="underline">Admin</Link>
              <span> / </span>
              <span className="font-semibold text-slate-700">Audit Logs</span>
            </>
          }
        />
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Audit log unavailable.</strong> Governance events could not be retrieved. Retry in a moment — if the issue persists, contact your system administrator.
        </div>
      </div>
    );
  }
}
