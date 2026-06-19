import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  getDashboardHealth,
  getProductList,
  getRejectionIntelligenceScore,
  MarketplaceChannel,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { READINESS_CHANNELS } from "@/lib/channel-readiness";
import {
  DEFAULT_MARKETPLACE_CHANNEL,
  formatMarketplaceChannelLabel,
  normalizeMarketplaceChannel,
} from "@/lib/marketplace-channels";
import { getServerSession } from "@/lib/server-session";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

type SharedReadState = "available" | "restricted" | "unavailable";
type SharedReadResult<T> =
  | { state: "available"; value: T }
  | { state: "restricted" }
  | { state: "unavailable" };

function normalizeChannel(value: MarketplaceChannel | undefined): MarketplaceChannel {
  return normalizeMarketplaceChannel(
    value,
    READINESS_CHANNELS,
    READINESS_CHANNELS[0] ?? DEFAULT_MARKETPLACE_CHANNEL,
  );
}

interface RejectionPageProps {
  searchParams: Promise<{
    productId?: string;
    channel?: MarketplaceChannel;
  }>;
}

function riskToneForKpi(riskBand: string | null): "default" | "success" | "warning" | "danger" | "info" {
  const normalized = String(riskBand ?? "").trim().toLowerCase();
  if (normalized === "low") {
    return "success";
  }
  if (normalized === "medium") {
    return "warning";
  }
  if (normalized === "high") {
    return "danger";
  }
  return "default";
}

function riskToneForChip(riskBand: string | null): "neutral" | "success" | "warning" | "danger" | "info" {
  const normalized = String(riskBand ?? "").trim().toLowerCase();
  if (normalized === "low") {
    return "success";
  }
  if (normalized === "medium") {
    return "warning";
  }
  if (normalized === "high") {
    return "danger";
  }
  return "neutral";
}

function isRejectionApiUnavailable(error: unknown): boolean {
  if (error instanceof ApiHttpError) {
    return error.status === 429 || error.status === 500 || error.status === 502 || error.status === 503 || error.status === 504;
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
    if (isRejectionApiUnavailable(error)) {
      return { state: "unavailable" };
    }
    throw error;
  }
}

export default async function RejectionPage({ searchParams }: RejectionPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole } = await getServerSession();
  const productId = String(query.productId ?? "").trim();
  const channel = normalizeChannel(query.channel);

  try {
    const [productsResult, healthResult] = await Promise.all([
      loadSharedRead(getProductList({ slim: true }, { role: actorRole, authHeader })),
      loadSharedRead(getDashboardHealth({ role: actorRole, authHeader })),
    ]);

    const products = productsResult.state === "available" ? productsResult.value : [];
    const filteredProducts = filterTestData(products, true);
    const scoreResult =
      productId
        ? await loadSharedRead(getRejectionIntelligenceScore(productId, channel, { role: actorRole, authHeader }))
        : null;
    const score = scoreResult && scoreResult.state === "available" ? scoreResult.value : null;

  const suggestionColumns: Column<NonNullable<typeof score>["suggestions"][number]>[] =
    score
      ? [
          { key: "field", header: "Field", render: (item) => <span className="font-mono text-xs text-slate-700">{item.field}</span> },
          { key: "suggestedFix", header: "Suggested Fix", render: (item) => <span className="text-slate-700">{item.suggestion}</span> },
          {
            key: "action",
            header: "Action",
            render: () => (
              <Link
                href={`/products/${encodeURIComponent(score.productId)}`}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Fix in Product
              </Link>
            ),
          },
        ]
      : [];

    return (
      <div className="space-y-5">
        <PageHeader
          title="Rejection Insights"
          description="Evaluate rejection risk, see patterns, and apply targeted fixes before submission."
          breadcrumb={
            <>
              Dashboard / Quality / <span className="font-semibold text-slate-700">Rejection Insights</span>
            </>
          }
          actions={
            <Link href="/quality/issues" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
              Open Issue Inbox
            </Link>
          }
        />

        {productsResult.state !== "available" || healthResult.state !== "available" ? (
          <section
            aria-live="polite"
            aria-atomic="true"
            role="status"
            className={`rounded-xl border p-4 shadow-sm ${
              productsResult.state === "unavailable" || healthResult.state === "unavailable"
                ? "border-amber-200 bg-amber-50"
                : "border-slate-200 bg-slate-50"
            }`}
          >
            <h2
              className={`text-sm font-semibold ${
                productsResult.state === "unavailable" || healthResult.state === "unavailable"
                  ? "text-amber-900"
                  : "text-slate-900"
              }`}
            >
              {productsResult.state === "unavailable" || healthResult.state === "unavailable"
                ? "Some rejection insight data is temporarily unavailable"
                : "Some rejection insight data is restricted"}
            </h2>
            <p
              className={`mt-2 text-sm ${
                productsResult.state === "unavailable" || healthResult.state === "unavailable"
                  ? "text-amber-900/90"
                  : "text-slate-700"
              }`}
            >
              {productsResult.state === "unavailable" || healthResult.state === "unavailable"
                ? "Unavailable health or product feeds are held back instead of defaulting to low rejection risk or an empty product selector."
                : "Your role can still open rejection insights, but some product or quality totals are intentionally redacted."}
            </p>
          </section>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="High Rejection Risk"
            value={
              healthResult.state === "available"
                ? healthResult.value.snapshot.rejectionRiskHigh
                : healthResult.state === "restricted"
                  ? "Restricted"
                  : "Unavailable"
            }
            helper={
              healthResult.state === "available"
                ? "Catalog-wide high-risk products"
                : healthResult.state === "restricted"
                  ? "Rejection-risk totals are limited for your role."
                  : "Rejection-risk totals are temporarily unavailable."
            }
            tone={
              healthResult.state === "available"
                ? healthResult.value.snapshot.rejectionRiskHigh > 0
                  ? "warning"
                  : "success"
                : healthResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
          <KpiCard
            label="Blocking Issues"
            value={
              healthResult.state === "available"
                ? healthResult.value.snapshot.openIssuesBlocking
                : healthResult.state === "restricted"
                  ? "Restricted"
                  : "Unavailable"
            }
            helper={
              healthResult.state === "available"
                ? "Validation blockers impacting publish"
                : healthResult.state === "restricted"
                  ? "Blocking-issue totals are limited for your role."
                  : "Blocking-issue totals are temporarily unavailable."
            }
            tone={
              healthResult.state === "available"
                ? healthResult.value.snapshot.openIssuesBlocking > 0
                  ? "danger"
                  : "success"
                : healthResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
          <KpiCard
            label="Warnings"
            value={
              healthResult.state === "available"
                ? healthResult.value.snapshot.openIssuesWarning
                : healthResult.state === "restricted"
                  ? "Restricted"
                  : "Unavailable"
            }
            helper={
              healthResult.state === "available"
                ? "Warning-level quality risks"
                : healthResult.state === "restricted"
                  ? "Warning-level totals are limited for your role."
                  : "Warning-level totals are temporarily unavailable."
            }
            tone={
              healthResult.state === "available"
                ? healthResult.value.snapshot.openIssuesWarning > 0
                  ? "warning"
                  : "default"
                : healthResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
          <KpiCard
            label="Selected Product Risk"
            value={
              scoreResult?.state === "available"
                ? `${scoreResult.value.riskScore}`
                : scoreResult?.state === "restricted"
                  ? "Restricted"
                  : scoreResult?.state === "unavailable"
                    ? "Unavailable"
                    : "-"
            }
            helper={
              scoreResult?.state === "available"
                ? `${scoreResult.value.channel} | ${scoreResult.value.riskBand}`
                : scoreResult?.state === "restricted"
                  ? "Risk score is limited for your role."
                  : scoreResult?.state === "unavailable"
                    ? "Risk score is temporarily unavailable."
                    : "Select product to evaluate"
            }
            tone={
              scoreResult?.state === "available"
                ? riskToneForKpi(scoreResult.value.riskBand ?? null)
                : scoreResult?.state === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
        </section>

        <FilterBar>
          <CardTitle>Run Risk Score</CardTitle>
          <form method="get" className="mt-3 grid gap-3 md:grid-cols-[1fr_220px_auto]">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="rejection-product-id">
                Product
              </label>
              <Select
                id="rejection-product-id"
                name="productId"
                required
                defaultValue={productId}
                disabled={productsResult.state !== "available"}
              >
                <option value="" disabled>
                  {productsResult.state === "available"
                    ? "Select product"
                    : productsResult.state === "restricted"
                      ? "Product selection restricted"
                      : "Product selection unavailable"}
                </option>
                {productsResult.state === "available"
                  ? filteredProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.title}
                      </option>
                    ))
                  : productId ? <option value={productId}>{productId}</option> : null}
              </Select>
              {productsResult.state === "restricted" ? (
                <p className="text-xs text-slate-500">Product selection is limited for your role.</p>
              ) : productsResult.state === "unavailable" ? (
                <p className="text-xs text-slate-500">Product selection is temporarily unavailable.</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="rejection-channel">
                Channel
              </label>
              <Select id="rejection-channel" name="channel" defaultValue={channel}>
                {READINESS_CHANNELS.map((availableChannel) => (
                  <option key={availableChannel} value={availableChannel}>
                    {formatMarketplaceChannelLabel(availableChannel)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-fit" disabled={productsResult.state !== "available"}>
                Evaluate
              </Button>
            </div>
          </form>
        </FilterBar>

        {!productId ? (
          <Card>
            <EmptyState
              icon="RADAR"
              title="Select a product to evaluate rejection risk"
              description={
                productsResult.state === "available"
                  ? "Choose a product and channel to get risk score, patterns, and fix guidance."
                  : productsResult.state === "restricted"
                    ? "Product selection is limited for your role, so rejection scoring cannot be run from this workspace."
                    : "Product selection is temporarily unavailable, so rejection scoring cannot be run right now."
              }
              action={{ label: "Go to product list", href: "/catalog/products" }}
            />
          </Card>
        ) : null}

        {productId && scoreResult?.state === "restricted" ? (
          <Card>
            <CardTitle>Selected Product Risk</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              Rejection scoring is restricted for your role.
            </p>
          </Card>
        ) : null}

        {productId && scoreResult?.state === "unavailable" ? (
          <Card>
            <CardTitle>Selected Product Risk</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              Rejection scoring is temporarily unavailable.
            </p>
          </Card>
        ) : null}

        {score ? (
          <section className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle>Risk Summary</CardTitle>
              <div className="mt-3 space-y-2 text-sm text-slate-700">
                <p>
                  Product: <span className="font-semibold">{score.productId}</span>
                </p>
                <p>
                  Channel: <span className="font-semibold">{score.channel}</span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip label={`Score ${score.riskScore}`} tone={riskToneForChip(score.riskBand)} />
                  <StatusChip label={`Risk ${score.riskBand}`} tone={riskToneForChip(score.riskBand)} />
                  <StatusChip
                    label={`${score.summary.missingCoreFields.length} missing core fields`}
                    tone={score.summary.missingCoreFields.length > 0 ? "warning" : "success"}
                  />
                  <StatusChip
                    label={`${score.summary.complianceErrors} compliance errors`}
                    tone={score.summary.complianceErrors > 0 ? "danger" : "success"}
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Media issues: {score.summary.mediaIssueCount}
                </p>
              </div>
            </Card>

            <Card>
              <CardTitle>Top Patterns</CardTitle>
              {score.topPatterns.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">No recurring rejection patterns found for this selection.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {score.topPatterns.map((item) => (
                    <li key={item} className="rounded-md border border-slate-200 px-3 py-2">
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="lg:col-span-2">
              <CardTitle>Fix Suggestions</CardTitle>
              {score.suggestions.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">No fix suggestions available for this product/channel pair.</p>
              ) : (
                <DataGrid className="mt-3" columns={suggestionColumns} rows={score.suggestions} getRowKey={(item) => `${item.field}-${item.suggestion}`} />
              )}
            </Card>
          </section>
        ) : null}
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/rejection", error));
    }
    throw error;
  }
}
