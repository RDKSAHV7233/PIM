import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveIssueInboxWarningsAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { KpiCard } from "@/components/ui/kpi-card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  type AppRole,
  type CatalogStatus,
  type IssueInboxSeverity,
  getCategories,
  getInstalledConnectors,
  getIssueInbox,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

interface QualityIssuePageProps {
  searchParams: Promise<{
    severity?: IssueInboxSeverity;
    installationId?: string;
    categoryId?: string;
    productStatus?: CatalogStatus;
    cursor?: string;
    limit?: string;
    hideTestData?: string;
  }>;
}

function resolveHideTestData(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "off") {
    return false;
  }
  return true;
}

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(200, Math.max(1, parsed));
}

function formatAge(detectedAt: string): string {
  const timestamp = new Date(detectedAt);
  const diffMs = Date.now() - timestamp.getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) {
    return "-";
  }
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) {
    return "<1h";
  }
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function buildReturnTo(params: URLSearchParams): string {
  const query = params.toString();
  return query.length > 0 ? `/quality/issues?${query}` : "/quality/issues";
}

function trendBadge(trend: "up" | "down" | "flat"): { label: string; className: string } {
  if (trend === "up") {
    return { label: "up vs yesterday", className: "text-emerald-700" };
  }
  if (trend === "down") {
    return { label: "down vs yesterday", className: "text-amber-700" };
  }
  return { label: "flat vs yesterday", className: "text-slate-600" };
}

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

export default async function QualityIssuePage({ searchParams }: QualityIssuePageProps) {
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canResolveWarnings = actorRole !== "viewer";
  const hideTestData = resolveHideTestData(query.hideTestData);
  const limit = parseLimit(query.limit, 50);

  const filterParams = new URLSearchParams();
  if (query.severity) {
    filterParams.set("severity", query.severity);
  }
  if (query.installationId) {
    filterParams.set("installationId", query.installationId);
  }
  if (query.categoryId) {
    filterParams.set("categoryId", query.categoryId);
  }
  if (query.productStatus) {
    filterParams.set("productStatus", query.productStatus);
  }
  if (query.cursor) {
    filterParams.set("cursor", query.cursor);
  }
  filterParams.set("limit", String(limit));
  if (query.hideTestData === "false") {
    filterParams.set("hideTestData", "false");
  }

  try {
    const [inbox, categoriesRaw, installations] = await Promise.all([
      getIssueInbox(
        {
          severity: query.severity,
          installationId: query.installationId,
          categoryId: query.categoryId,
          productStatus: query.productStatus,
          cursor: query.cursor,
          limit,
        },
        { role: actorRole, authHeader },
      ),
      getCategories({ role: actorRole, authHeader }),
      getInstalledConnectors({ role: actorRole, authHeader }),
    ]);

    const categories = filterTestData(categoriesRaw, hideTestData);
    const sortedInstallations = installations.slice().sort((left, right) =>
      `${left.displayName} ${left.accountAlias}`.localeCompare(`${right.displayName} ${right.accountAlias}`),
    );
    const returnTo = buildReturnTo(filterParams);
    const trend = trendBadge(inbox.trend);

    const previousParams = new URLSearchParams(filterParams.toString());
    const nextParams = new URLSearchParams(filterParams.toString());
    if (inbox.nextCursor) {
      nextParams.set("cursor", inbox.nextCursor);
    }
    if (query.cursor) {
      previousParams.delete("cursor");
    }

    return (
      <div className="space-y-5">
        <PageHeader
          title="Issue Inbox"
          description="Find issues, assign ownership, and fix products quickly."
          breadcrumb={
            <>
              Dashboard / Quality / <span className="font-semibold text-slate-700">Issue Inbox</span>
            </>
          }
        />

        <section className="grid gap-4 md:grid-cols-3">
          <KpiCard label="Open Issues" value={inbox.items.length} tone={inbox.items.length > 0 ? "warning" : "success"} />
          <KpiCard label="Resolved Today" value={inbox.resolvedToday} tone="success" helper={trend.label} />
          <KpiCard
            label="Blocking Items"
            value={inbox.items.filter((item) => item.severity === "BLOCKING").length}
            tone={inbox.items.some((item) => item.severity === "BLOCKING") ? "danger" : "default"}
          />
        </section>

        <Card>
          <CardTitle>Today&apos;s Progress</CardTitle>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
              {inbox.resolvedToday} issues resolved today
            </span>
            <span className={trend.className}>{trend.label}</span>
            <span className="text-slate-500">Yesterday: {inbox.resolvedYesterday}</span>
          </div>
        </Card>

        <FilterBar>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Filters</h2>
            <span className="text-xs text-slate-500">Use filters to narrow assignment and severity scope.</span>
          </div>
          <form method="get" className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="issue-severity">
                Severity
              </label>
              <Select id="issue-severity" name="severity" defaultValue={query.severity ?? ""}>
                <option value="">All severities</option>
                <option value="BLOCKING">Blocking</option>
                <option value="WARNING">Warning</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="issue-installation">
                Connector Install
              </label>
              <Select id="issue-installation" name="installationId" defaultValue={query.installationId ?? ""}>
                <option value="">All connectors</option>
                {sortedInstallations.map((installation) => (
                  <option key={installation.id} value={installation.id}>
                    {installation.displayName} - {installation.accountAlias}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="issue-category">
                Category
              </label>
              <Select id="issue-category" name="categoryId" defaultValue={query.categoryId ?? ""}>
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="issue-product-status">
                Product Status
              </label>
              <Select id="issue-product-status" name="productStatus" defaultValue={query.productStatus ?? ""}>
                <option value="">All statuses</option>
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="archived">archived</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="issue-limit">
                Page Size
              </label>
              <Input id="issue-limit" name="limit" defaultValue={String(limit)} />
            </div>
            <input type="hidden" name="hideTestData" value={hideTestData ? "true" : "false"} />
            <div className="md:col-span-5 flex items-center gap-2">
              <Button type="submit">Apply filters</Button>
              <Link
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                href="/quality/issues"
              >
                Clear filters
              </Link>
            </div>
          </form>
        </FilterBar>

        {inbox.items.length === 0 ? (
          <Card>
            <EmptyState
              icon="CHECK"
              title="No open issues found"
              description="Your current filter scope has no open compliance issues."
              action={{ label: "Back to dashboard", href: "/" }}
            />
          </Card>
        ) : (
          <Card>
            <CardTitle>Open Issues</CardTitle>
            <form action={resolveIssueInboxWarningsAction} className="space-y-3">
              <RoleHiddenInput role={actorRole} />
              <input type="hidden" name="returnTo" value={returnTo} />

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-600">
                    <tr className="border-b border-slate-200">
                      {canResolveWarnings ? <th className="px-3 py-2">Select</th> : null}
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2">Field</th>
                      <th className="px-3 py-2">Severity</th>
                      <th className="px-3 py-2">Age</th>
                      <th className="px-3 py-2">Message</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inbox.items.map((issue) => (
                      <tr key={issue.issueId} className="border-b border-slate-100 align-top hover:bg-slate-50/50">
                        {canResolveWarnings ? (
                          <td className="px-3 py-2.5">
                            {issue.severity === "WARNING" ? (
                              <input
                                type="checkbox"
                                name="issueIds"
                                value={issue.issueId}
                                className="rounded border-slate-300"
                              />
                            ) : (
                              <span className="text-xs text-slate-400">-</span>
                            )}
                          </td>
                        ) : null}
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-slate-900">{issue.productName}</div>
                          <div className="text-xs text-slate-500">
                            SKU: {issue.sku} | {issue.categoryName} | {issue.productStatus}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{issue.fieldPath ?? "-"}</td>
                        <td className="px-3 py-2.5">
                          <StatusChip label={issue.severity} tone={issue.severity === "BLOCKING" ? "danger" : "warning"} />
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{formatAge(issue.detectedAt)}</td>
                        <td className="px-3 py-2.5">
                          <p className="text-slate-800">{issue.sellerMessage}</p>
                          <p className="mt-1 text-xs text-slate-500">{issue.suggestedFix}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/products/${encodeURIComponent(issue.productId)}?returnTo=${encodeURIComponent(returnTo)}`}
                            className="rounded-md border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Fix Now
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {canResolveWarnings ? (
                <div className="flex items-center gap-2">
                  <Button type="submit">Resolve selected warnings</Button>
                  <span className="text-xs text-slate-500">Blocking issues must be fixed from the product editor.</span>
                </div>
              ) : null}
            </form>

            <div className="mt-4 flex items-center gap-3 text-sm">
              {query.cursor ? (
                <Link href={`/quality/issues?${previousParams.toString()}`} className="underline text-slate-700">
                  Previous page
                </Link>
              ) : null}
              {inbox.nextCursor ? (
                <Link href={`/quality/issues?${nextParams.toString()}`} className="underline text-slate-700">
                  Next page
                </Link>
              ) : null}
            </div>
          </Card>
        )}
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/quality/issues", error.status));
    }
    throw error;
  }
}
