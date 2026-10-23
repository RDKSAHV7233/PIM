import Link from "@/components/ui/app-link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  getDashboardHealth,
  getPricingCoverage,
  getStats,
  type PricingCoverage,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

type SharedReadState = "available" | "restricted" | "unavailable";
type PricingDisplayState = SharedReadState | "not_configured";
type SharedReadResult<T> =
  | { state: "available"; value: T }
  | { state: "restricted" }
  | { state: "unavailable" };

function toPercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

function isCompletenessApiUnavailable(error: unknown): boolean {
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
    if (isCompletenessApiUnavailable(error)) {
      return { state: "unavailable" };
    }
    throw error;
  }
}

function CompletenessSharedReadNotice({ states }: { states: SharedReadState[] }) {
  const hasUnavailable = states.includes("unavailable");
  const hasRestricted = states.includes("restricted");
  if (!hasUnavailable && !hasRestricted) {
    return null;
  }

  return (
    <section
      aria-live="polite"
      aria-atomic="true"
      role="status"
      className={`rounded-xl border p-4 shadow-sm ${
        hasUnavailable ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"
      }`}
    >
      <h2 className={`text-sm font-semibold ${hasUnavailable ? "text-amber-900" : "text-slate-900"}`}>
        {hasUnavailable
          ? "Some completeness data is temporarily unavailable"
          : "Some completeness data is restricted"}
      </h2>
      <p className={`mt-2 text-sm ${hasUnavailable ? "text-amber-900/90" : "text-slate-700"}`}>
        {hasUnavailable
          ? "We could not load every completeness feed right now. Catalog and pricing metrics are held back instead of defaulting to healthy values."
          : "Your role can still review completeness, but some catalog or pricing metrics are intentionally redacted."}
      </p>
    </section>
  );
}

function metricValue(state: SharedReadState, value: number): number | string {
  if (state === "available") {
    return value;
  }
  return state === "restricted" ? "Restricted" : "Unavailable";
}

export default async function QualityCompletenessPage() {
  const { authHeader, actorRole } = await getServerSession();
  const canViewPricingCoverage = canEditWorkspace(actorRole);

  try {
    const [healthResult, statsResult, pricingCoverageResult] = await Promise.all([
      loadSharedRead(getDashboardHealth({ role: actorRole, authHeader })),
      loadSharedRead(getStats({ role: actorRole, authHeader })),
      canViewPricingCoverage
        ? loadSharedRead(getPricingCoverage({ role: actorRole, authHeader }))
        : Promise.resolve({ state: "restricted" } as const),
    ]);
    const completenessState: SharedReadState =
      healthResult.state === "available" && statsResult.state === "available"
        ? "available"
        : healthResult.state === "unavailable" || statsResult.state === "unavailable"
          ? "unavailable"
          : "restricted";
    const completenessData =
      healthResult.state === "available" && statsResult.state === "available"
        ? {
            products: statsResult.value.products,
            completeSkus: healthResult.value.snapshot.completeSkus,
            incompleteSkus: healthResult.value.snapshot.incompleteSkus,
            openIssuesBlocking: healthResult.value.snapshot.openIssuesBlocking,
            openIssuesWarning: healthResult.value.snapshot.openIssuesWarning,
          }
        : null;
    const completeness = completenessData
      ? toPercent(completenessData.completeSkus, completenessData.products)
      : null;
    const pricingCoverageData =
      pricingCoverageResult.state === "available" ? pricingCoverageResult.value : null;
    const pricingState: PricingDisplayState =
      pricingCoverageResult.state === "available"
        ? pricingCoverageResult.value.totalActivePriceLists > 0
          ? "available"
          : "not_configured"
        : pricingCoverageResult.state;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Completeness"
          description="Track catalog completeness and prioritize the highest-impact quality gaps."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/quality" className="hover:underline">Quality</Link>{" / "}<span className="font-semibold text-slate-700">Completeness</span>
            </>
          }
        />
        <CompletenessSharedReadNotice
          states={[healthResult.state, statsResult.state, pricingCoverageResult.state]}
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Total Products"
            value={metricValue(statsResult.state, completenessData?.products ?? 0)}
            helper={
              statsResult.state === "available"
                ? "Products currently in catalog scope"
                : statsResult.state === "restricted"
                  ? "Catalog totals are limited for your role."
                  : "Catalog totals are temporarily unavailable."
            }
            tone={statsResult.state === "unavailable" ? "warning" : "default"}
          />
          <KpiCard
            label="Complete Products"
            value={metricValue(completenessState, completenessData?.completeSkus ?? 0)}
            helper={
              completenessState === "available"
                ? "Products meeting current completeness thresholds"
                : completenessState === "restricted"
                  ? "Complete product totals are limited for your role."
                  : "Complete product totals are temporarily unavailable."
            }
            tone={
              completenessState === "available"
                ? "success"
                : completenessState === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
          <KpiCard
            label="Incomplete Products"
            value={metricValue(completenessState, completenessData?.incompleteSkus ?? 0)}
            helper={
              completenessState === "available"
                ? "Prioritize these products for enrichment"
                : completenessState === "restricted"
                  ? "Incomplete product totals are limited for your role."
                  : "Incomplete product totals are temporarily unavailable."
            }
            tone={
              completenessState === "available"
                ? (completenessData?.incompleteSkus ?? 0) > 0
                  ? "warning"
                  : "default"
                : completenessState === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
          <KpiCard
            label="Completeness %"
            value={
              completenessData
                ? completenessData.products === 0
                  ? "—"
                  : `${completeness}%`
                : completenessState === "restricted"
                  ? "Restricted"
                  : "Unavailable"
            }
            helper={
              completenessData
                ? completenessData.products === 0
                  ? "Add products to start tracking completeness"
                  : `${completenessData.completeSkus}/${completenessData.products} complete`
                : completenessState === "restricted"
                  ? "Completeness score is limited for your role."
                  : "Completeness score is temporarily unavailable."
            }
            tone={
              completenessData
                ? completenessData.products === 0
                  ? "default"
                  : (completeness ?? 0) >= 90
                    ? "success"
                    : (completeness ?? 0) >= 70
                      ? "info"
                      : "warning"
                : completenessState === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardTitle>Quality Signals</CardTitle>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {healthResult.state === "available" ? (
                <>
                  <StatusChip
                    label={`${completenessData?.openIssuesBlocking ?? 0} blocking`}
                    tone={(completenessData?.openIssuesBlocking ?? 0) > 0 ? "danger" : "neutral"}
                  />
                  <StatusChip
                    label={`${completenessData?.openIssuesWarning ?? 0} warnings`}
                    tone={(completenessData?.openIssuesWarning ?? 0) > 0 ? "warning" : "neutral"}
                  />
                </>
              ) : (
                <StatusChip
                  label={healthResult.state === "restricted" ? "Quality signals restricted" : "Quality signals unavailable"}
                  tone="neutral"
                />
              )}
            </div>
            <p className="mt-3 text-sm text-slate-600">
              {healthResult.state === "available"
                ? "Use Issue Inbox for prioritized fixes and Validation for severity-based triage."
                : healthResult.state === "restricted"
                  ? "Issue counts remain intentionally redacted, but the detailed quality workspaces are still available."
                  : "Issue counts are reconnecting. Open the detailed quality workspaces directly while shared feeds recover."}
            </p>
          </Card>
          <Card>
            <CardTitle>Next Actions</CardTitle>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/quality/issues" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Open Issue Inbox
              </Link>
              <Link href="/quality/validation" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Open Validation
              </Link>
            </div>
          </Card>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-800">Pricing Coverage</h2>
            {pricingState === "available" || pricingState === "not_configured" ? (
              <Link
                href="/settings/pricing"
                className="text-sm text-slate-500 hover:text-slate-700 hover:underline"
              >
                Manage pricing →
              </Link>
            ) : null}
          </div>

          {pricingState === "restricted" ? (
            <Card>
              <p className="text-sm text-slate-500">
                Pricing coverage is limited for your role.
              </p>
            </Card>
          ) : pricingState === "unavailable" ? (
            <Card>
              <p className="text-sm text-slate-500">
                Pricing coverage is temporarily unavailable.
              </p>
            </Card>
          ) : pricingState === "not_configured" ? (
            <Card>
              <p className="text-sm text-slate-500">
                No active price lists configured.{" "}
                <Link href="/settings/pricing" className="font-medium text-slate-700 hover:underline">
                  Set up pricing
                </Link>{" "}
                to track variant coverage.
              </p>
            </Card>
          ) : pricingCoverageData ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  label="Default list coverage"
                  value={`${pricingCoverageData.defaultListCoverage}%`}
                  tone={
                    pricingCoverageData.defaultListCoverage >= 90
                      ? "success"
                      : pricingCoverageData.defaultListCoverage >= 60
                        ? "warning"
                        : "danger"
                  }
                />
                <KpiCard
                  label="Priced variants"
                  value={pricingCoverageData.pricedInDefaultList}
                  tone="success"
                />
                <KpiCard
                  label="Unpriced variants"
                  value={pricingCoverageData.unpricedInDefaultList}
                  tone={pricingCoverageData.unpricedInDefaultList > 0 ? "warning" : "default"}
                />
                <KpiCard
                  label="Active price lists"
                  value={pricingCoverageData.totalActivePriceLists}
                />
              </div>

              {pricingCoverageData.perPriceList.length > 1 ? (
                <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left">Price list</th>
                        <th className="px-4 py-3 text-left">Market</th>
                        <th className="px-4 py-3 text-left">Currency</th>
                        <th className="px-4 py-3 text-right">Priced</th>
                        <th className="px-4 py-3 text-right">Unpriced</th>
                        <th className="px-4 py-3 text-right">Coverage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pricingCoverageData.perPriceList.map((priceList: PricingCoverage["perPriceList"][number]) => (
                        <tr key={priceList.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-800">
                            {priceList.name}
                            {priceList.isDefault ? (
                              <span className="ml-2 inline-block rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                                default
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{priceList.market.displayName}</td>
                          <td className="px-4 py-3 text-slate-600">
                            {priceList.currency.symbol} {priceList.currency.code}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">
                            {priceList.pricedVariants.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">
                            {priceList.unpricedVariants > 0 ? (
                              <span className="font-medium text-amber-600">
                                {priceList.unpricedVariants.toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span
                              className={
                                priceList.coveragePercent >= 90
                                  ? "font-semibold text-green-600"
                                  : priceList.coveragePercent >= 60
                                    ? "font-semibold text-amber-600"
                                    : "font-semibold text-red-600"
                              }
                            >
                              {priceList.coveragePercent}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : (
            <Card>
              <p className="text-sm text-slate-500">
                Pricing coverage is temporarily unavailable.
              </p>
            </Card>
          )}
        </section>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/quality/completeness", error));
    }
    throw error;
  }
}
