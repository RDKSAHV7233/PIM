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

export default async function RejectionPage({ searchParams }: RejectionPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole } = await getServerSession();
  const productId = String(query.productId ?? "").trim();
  const channel = normalizeChannel(query.channel);

  let products: Awaited<ReturnType<typeof getProductList>>;
  let health: Awaited<ReturnType<typeof getDashboardHealth>>;
  try {
    [products, health] = await Promise.all([
      getProductList({ slim: true }, { role: actorRole, authHeader }),
      getDashboardHealth({ role: actorRole, authHeader }),
    ]);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/rejection", error));
    }
    throw error;
  }

  const filteredProducts = filterTestData(products, true);
  let score: Awaited<ReturnType<typeof getRejectionIntelligenceScore>> | null = null;
  if (productId) {
    try {
      score = await getRejectionIntelligenceScore(productId, channel, { role: actorRole, authHeader });
    } catch (error: unknown) {
      if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
        redirect(buildLoginRedirect("/rejection", error));
      }
      throw error;
    }
  }
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

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="High Rejection Risk"
          value={health.snapshot.rejectionRiskHigh}
          helper="Catalog-wide high-risk products"
          tone={health.snapshot.rejectionRiskHigh > 0 ? "warning" : "success"}
        />
        <KpiCard
          label="Blocking Issues"
          value={health.snapshot.openIssuesBlocking}
          helper="Validation blockers impacting publish"
          tone={health.snapshot.openIssuesBlocking > 0 ? "danger" : "success"}
        />
        <KpiCard
          label="Warnings"
          value={health.snapshot.openIssuesWarning}
          helper="Warning-level quality risks"
          tone={health.snapshot.openIssuesWarning > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Selected Product Risk"
          value={score ? `${score.riskScore}` : "-"}
          helper={score ? `${score.channel} | ${score.riskBand}` : "Select product to evaluate"}
          tone={riskToneForKpi(score?.riskBand ?? null)}
        />
      </section>

      <FilterBar>
        <CardTitle>Run Risk Score</CardTitle>
        <form method="get" className="mt-3 grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="rejection-product-id">
              Product
            </label>
            <Select id="rejection-product-id" name="productId" required defaultValue={productId}>
              <option value="" disabled>
                Select product
              </option>
              {filteredProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title}
                </option>
              ))}
            </Select>
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
            <Button type="submit" className="w-fit">
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
            description="Choose a product and channel to get risk score, patterns, and fix guidance."
            action={{ label: "Go to product list", href: "/catalog/products" }}
          />
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
}
