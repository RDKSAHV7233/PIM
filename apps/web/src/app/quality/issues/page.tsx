import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveIssueInboxWarningsAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { KpiCard } from "@/components/ui/kpi-card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  type CatalogStatus,
  type IssueInboxFieldFamily,
  type IssueInboxSeverity,
  getCategoryTree,
  getInstalledConnectors,
  getIssueInbox,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { humaniseFieldPath } from "@/lib/field-labels";
import { canResolveIssueInboxWarnings } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

type SharedReadState = "available" | "restricted" | "unavailable";
type SharedReadResult<T> =
  | { state: "available"; value: T }
  | { state: "restricted" }
  | { state: "unavailable" };

interface QualityIssuePageProps {
  searchParams: Promise<{
    severity?: IssueInboxSeverity;
    fieldFamily?: IssueInboxFieldFamily;
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

/**
 * Maps a display family name to the corresponding `fieldFamily` query-param value
 * accepted by GET /issues/inbox. Families without a backend filter (Taxonomy,
 * Channel mapping) map to null and are rendered as plain text in the UI.
 */
const FAMILY_FILTER_MAP: Record<string, IssueInboxFieldFamily | null> = {
  Pricing: "PRICING",
  "GST / Tax": "GST_TAX",
  Attributes: "ATTRIBUTES",
  "Core content": "CORE",
  Media: "MEDIA",
  Taxonomy: null,
  "Channel mapping": null,
};

function issueFamily(issue: { fieldPath: string | null; sellerMessage: string }): string {
  const fieldPath = String(issue.fieldPath ?? "").trim().toLowerCase();
  const sellerMessage = String(issue.sellerMessage ?? "").trim().toLowerCase();
  const combined = `${fieldPath} ${sellerMessage}`;

  if (combined.includes("image") || combined.includes("media") || combined.includes("asset")) {
    return "Media";
  }
  if (combined.includes("category") || combined.includes("taxonomy")) {
    return "Taxonomy";
  }
  if (combined.includes("channel") || combined.includes("marketplace") || combined.includes("mapping")) {
    return "Channel mapping";
  }
  // Separate GST/Tax from generic pricing so they match the filter dropdown options.
  // taxCodes = structured international tax codes (e.g. UK COMMODITY_CODE, UAE HS_CODE)
  if (fieldPath === "hsncode" || fieldPath === "gstrate" || fieldPath === "taxcodes" ||
      combined.includes("hsn") || combined.includes("tax code") ||
      (combined.includes("gst") && !combined.includes("price"))) {
    return "GST / Tax";
  }
  if (fieldPath === "pricing" || combined.includes("price") || combined.includes("mrp")) {
    return "Pricing";
  }
  return "Core content";
}

function isIssueInboxApiUnavailable(error: unknown): boolean {
  if (error instanceof ApiHttpError) {
    return error.status === 502 || error.status === 503 || error.status === 504;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  const cause = "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeDetails =
    cause && typeof cause === "object"
      ? `${String((cause as { code?: unknown }).code ?? "")} ${String((cause as { message?: unknown }).message ?? "")}`.toLowerCase()
      : String(cause ?? "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    causeDetails.includes("econnrefused") ||
    causeDetails.includes("enotfound") ||
    causeDetails.includes("socket hang up")
  );
}

async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>> {
  try {
    return {
      state: "available",
      value: await promise,
    };
  } catch (error) {
    if (error instanceof ApiHttpError) {
      if (error.status === 401) {
        throw error;
      }
      if (error.status === 403) {
        return { state: "restricted" };
      }
    }
    if (isIssueInboxApiUnavailable(error)) {
      return { state: "unavailable" };
    }
    throw error;
  }
}

function QualityIssueInboxStatusState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
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
      <Card aria-live="polite" aria-atomic="true">
        <CardTitle>{title}</CardTitle>
        <p className="mt-3 text-sm text-slate-600">{description}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/quality"
            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open quality overview
          </Link>
          <Link
            href="/catalog/products"
            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open products
          </Link>
        </div>
      </Card>
    </div>
  );
}

export default async function QualityIssuePage({ searchParams }: QualityIssuePageProps) {
  const query = await searchParams;
  const { authHeader, actorRole } = await getServerSession();

  const canResolveWarnings = canResolveIssueInboxWarnings(actorRole);
  const hideTestData = resolveHideTestData(query.hideTestData);
  const limit = parseLimit(query.limit, 50);

  const filterParams = new URLSearchParams();
  if (query.severity) {
    filterParams.set("severity", query.severity);
  }
  if (query.fieldFamily) {
    filterParams.set("fieldFamily", query.fieldFamily);
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
    const [inboxResult, categoriesResult, installationsResult] = await Promise.all([
      loadSharedRead(getIssueInbox(
        {
          severity: query.severity,
          fieldFamily: query.fieldFamily,
          installationId: query.installationId,
          categoryId: query.categoryId,
          productStatus: query.productStatus,
          cursor: query.cursor,
          limit,
        },
        { role: actorRole, authHeader },
      )),
      loadSharedRead(getCategoryTree({ all: true }, { role: actorRole, authHeader, revalidateSeconds: 60 })),
      loadSharedRead(getInstalledConnectors({ role: actorRole, authHeader })),
    ]);

    if (inboxResult.state === "restricted") {
      return (
        <QualityIssueInboxStatusState
          title="Issue inbox access is restricted"
          description="Your current role can open Quality, but the detailed issue inbox feed is limited right now."
        />
      );
    }

    if (inboxResult.state === "unavailable") {
      return (
        <QualityIssueInboxStatusState
          title="Issue inbox is temporarily unavailable"
          description="We could not load the live issue feed right now. Retry from Quality after the upstream API recovers."
        />
      );
    }

    const inbox = inboxResult.value;
    const categoriesRaw = categoriesResult.state === "available" ? categoriesResult.value : [];
    const installations = installationsResult.state === "available" ? installationsResult.value : [];
    const categories = filterTestData(categoriesRaw, hideTestData);
    const sortedInstallations = installations.slice().sort((left, right) =>
      `${left.displayName} ${left.accountAlias}`.localeCompare(`${right.displayName} ${right.accountAlias}`),
    );
    const returnTo = buildReturnTo(filterParams);
    const trend = trendBadge(inbox.trend);
    const blockingItems = inbox.items.filter((item) => item.severity === "BLOCKING");
    const warningItems = inbox.items.filter((item) => item.severity === "WARNING");
    const familyCounts = inbox.items.reduce<Record<string, number>>((accumulator, issue) => {
      const family = issueFamily(issue);
      accumulator[family] = (accumulator[family] ?? 0) + 1;
      return accumulator;
    }, {});
    const dominantFamilies = Object.entries(familyCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4);

    const previousParams = new URLSearchParams(filterParams.toString());
    const nextParams = new URLSearchParams(filterParams.toString());
    if (inbox.nextCursor) {
      nextParams.set("cursor", inbox.nextCursor);
    }
    if (query.cursor) {
      previousParams.delete("cursor");
    }
    const resolvedProgressPct =
      inbox.resolvedToday + inbox.items.length > 0
        ? Math.min(100, Math.round((inbox.resolvedToday / (inbox.resolvedToday + inbox.items.length)) * 100))
        : 0;
    const issueColumns: Column<(typeof inbox.items)[number]>[] = [
      ...(canResolveWarnings
        ? [
            {
              key: "select",
              header: "Select",
              mobileHide: true,
              render: (issue) =>
                issue.severity === "WARNING" ? (
                  <input
                    type="checkbox"
                    name="issueIds"
                    value={issue.issueId}
                    className="rounded border-slate-300"
                  />
                ) : (
                  <span className="text-xs text-slate-400">-</span>
                ),
            } satisfies Column<(typeof inbox.items)[number]>,
          ]
        : []),
      {
        key: "product",
        header: "Product",
        render: (issue) => (
          <div className="space-y-1">
            <div className="font-medium text-slate-900">{issue.productName}</div>
            <div className="text-xs text-slate-500">
              SKU: {issue.sku} | {issue.categoryName} | {issue.productStatus}
            </div>
          </div>
        ),
      },
      {
        key: "fieldPath",
        header: "Field",
        render: (issue) => <span className="font-mono text-xs text-slate-600">{humaniseFieldPath(issue.fieldPath)}</span>,
      },
      {
        key: "severity",
        header: "Severity",
        render: (issue) => (
          <StatusChip label={issue.severity} tone={issue.severity === "BLOCKING" ? "danger" : "warning"} />
        ),
      },
      {
        key: "age",
        header: "Age",
        render: (issue) => <span className="text-slate-600">{formatAge(issue.detectedAt)}</span>,
      },
      {
        key: "message",
        header: "Message",
        render: (issue) => (
          <div>
            <p className="text-slate-800">{issue.sellerMessage}</p>
            <p className="mt-1 text-xs text-slate-500">{issue.suggestedFix}</p>
          </div>
        ),
      },
      {
        key: "action",
        header: "Action",
        render: (issue) => (
          <Link
            href={`/products/${encodeURIComponent(issue.productId)}?returnTo=${encodeURIComponent(returnTo)}`}
            className="rounded-md border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Fix Now
          </Link>
        ),
      },
    ];

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

        <Card aria-live="polite" aria-atomic="true">
          <CardTitle>Today&apos;s Progress</CardTitle>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
              {inbox.resolvedToday} issues resolved today
            </span>
            <span className={trend.className}>{trend.label}</span>
            <span className="text-slate-500">Yesterday: {inbox.resolvedYesterday}</span>
          </div>
          <div className="mt-4 h-2 rounded-full bg-slate-100" role="progressbar" aria-valuenow={resolvedProgressPct} aria-valuemin={0} aria-valuemax={100} aria-label="Issue resolution progress">
            <div
              className="h-2 rounded-full bg-emerald-500 transition-all"
              style={{ width: `${resolvedProgressPct}%` }}
            />
          </div>
        </Card>

        <Card aria-live="polite" aria-atomic="true">
          <CardTitle>Grouped Impact</CardTitle>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                Review blockers first, then use warning cleanup to improve readiness without slowing the publish path.
              </p>
              <div className="flex flex-wrap gap-2">
                <StatusChip
                  label={`Blocking ${blockingItems.length}`}
                  tone={blockingItems.length > 0 ? "danger" : "success"}
                />
                <StatusChip
                  label={`Warnings ${warningItems.length}`}
                  tone={warningItems.length > 0 ? "warning" : "success"}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Publish blockers</p>
                  <p className="mt-1 text-sm text-slate-700">
                    Blocking issues stop review, approval, or channel delivery until the product editor clears them.
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cleanup warnings</p>
                  <p className="mt-1 text-sm text-slate-700">
                    Warning-only rows are safe to bulk-resolve or schedule after the current publish window.
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-900">Top issue families</p>
              {dominantFamilies.length === 0 ? (
                <p className="text-sm text-slate-600">No open issue families in the current scope.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {dominantFamilies.map(([family, count]) => {
                    const filterValue = FAMILY_FILTER_MAP[family] ?? null;
                    const familyParams = new URLSearchParams();
                    if (filterValue) {
                      familyParams.set("fieldFamily", filterValue);
                    }
                    // Preserve severity filter if already active so the link narrows within the current scope.
                    if (query.severity) {
                      familyParams.set("severity", query.severity);
                    }
                    const familyHref = filterValue
                      ? `/quality/issues?${familyParams.toString()}`
                      : null;
                    return (
                      <li key={family} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                        {familyHref ? (
                          <Link
                            href={familyHref}
                            className="text-sm font-medium text-blue-700 hover:underline"
                          >
                            {family}
                          </Link>
                        ) : (
                          <span className="text-slate-700">{family}</span>
                        )}
                        <StatusChip label={`${count} open`} tone={count > 0 ? "info" : "neutral"} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </Card>

        <FilterBar>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Filters</h2>
            <span className="text-xs text-slate-500">Use filters to narrow assignment and severity scope.</span>
          </div>
          {categoriesResult.state !== "available" || installationsResult.state !== "available" ? (
            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {categoriesResult.state !== "available" ? (
                <span>
                  {categoriesResult.state === "restricted"
                    ? "Category filters are limited for your role."
                    : "Category filters are temporarily unavailable."}
                </span>
              ) : null}
              {categoriesResult.state !== "available" && installationsResult.state !== "available" ? " " : null}
              {installationsResult.state !== "available" ? (
                <span>
                  {installationsResult.state === "restricted"
                    ? "Connector filters are limited for your role."
                    : "Connector filters are temporarily unavailable."}
                </span>
              ) : null}
            </div>
          ) : null}
          <form method="get" className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
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
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="issue-field-family">
                Field Family
              </label>
              <Select id="issue-field-family" name="fieldFamily" defaultValue={query.fieldFamily ?? ""}>
                <option value="">All fields</option>
                <option value="PRICING">Pricing</option>
                <option value="GST_TAX">GST / Tax</option>
                <option value="ATTRIBUTES">Attributes</option>
                <option value="CORE">Core content</option>
                <option value="MEDIA">Media</option>
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
            <div className="md:col-span-3 lg:col-span-6 flex items-center gap-2">
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
          <Card aria-live="polite" aria-atomic="true">
            <EmptyState
              icon="CHECK"
              title="No open issues found"
              description="Your current filter scope has no open compliance issues."
              action={{ label: "Back to dashboard", href: "/" }}
            />
          </Card>
        ) : (
          <Card aria-live="polite" aria-atomic="true">
            <CardTitle>Open Issues</CardTitle>
            <form action={resolveIssueInboxWarningsAction} className="space-y-3">
              <input type="hidden" name="returnTo" value={returnTo} />
              <DataGrid
                columns={issueColumns}
                rows={inbox.items}
                getRowKey={(issue) => issue.issueId}
                rowClassName="align-top"
              />

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
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/quality/issues", error));
    }
    throw error;
  }
}
