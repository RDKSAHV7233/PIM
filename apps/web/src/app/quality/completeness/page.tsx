import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getDashboardHealth, getStats, getPricingCoverage } from "@/lib/api";
import type { PricingCoverage } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

function toPercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

export default async function QualityCompletenessPage() {
  const { authHeader, actorRole } = await getServerSession();

  try {
    const [health, stats, coverage] = await Promise.all([
      getDashboardHealth({ role: actorRole, authHeader }),
      getStats({ role: actorRole, authHeader }),
      // Non-fatal: coverage is empty-stated if no pricing is configured yet
      getPricingCoverage({ role: actorRole, authHeader }).catch((): PricingCoverage | null => null),
    ]);
    const completeness = toPercent(health.snapshot.completeSkus, stats.products);
    const blocked = health.snapshot.openIssuesBlocking;
    const warnings = health.snapshot.openIssuesWarning;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Completeness"
          description="Track catalog completeness and prioritize the highest-impact quality gaps."
          breadcrumb={
            <>
              Dashboard / Quality / <span className="font-semibold text-slate-700">Completeness</span>
            </>
          }
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total SKUs" value={stats.products} />
          <KpiCard label="Complete SKUs" value={health.snapshot.completeSkus} tone="success" />
          <KpiCard label="Incomplete SKUs" value={health.snapshot.incompleteSkus} tone={health.snapshot.incompleteSkus > 0 ? "warning" : "default"} />
          <KpiCard label="Completeness %" value={`${completeness}%`} tone={completeness >= 90 ? "success" : completeness >= 70 ? "info" : "warning"} />
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardTitle>Quality Signals</CardTitle>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusChip label={`${blocked} blocking`} tone={blocked > 0 ? "danger" : "neutral"} />
              <StatusChip label={`${warnings} warnings`} tone={warnings > 0 ? "warning" : "neutral"} />
            </div>
            <p className="mt-3 text-sm text-slate-600">
              Use Issue Inbox for prioritized fixes and Validation for severity-based triage.
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

        {/* ── Pricing Coverage ──────────────────────────────────────────────── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-800">Pricing Coverage</h2>
            <Link
              href="/settings/pricing"
              className="text-sm text-slate-500 hover:text-slate-700 hover:underline"
            >
              Manage pricing →
            </Link>
          </div>

          {!coverage || coverage.totalActivePriceLists === 0 ? (
            <Card>
              <p className="text-sm text-slate-500">
                No active price lists configured.{" "}
                <Link href="/settings/pricing" className="font-medium text-slate-700 hover:underline">
                  Set up pricing
                </Link>{" "}
                to track variant coverage.
              </p>
            </Card>
          ) : (
            <>
              {/* KPI summary — default price list */}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  label="Default list coverage"
                  value={`${coverage.defaultListCoverage}%`}
                  tone={
                    coverage.defaultListCoverage >= 90
                      ? "success"
                      : coverage.defaultListCoverage >= 60
                        ? "warning"
                        : "danger"
                  }
                />
                <KpiCard
                  label="Priced variants"
                  value={coverage.pricedInDefaultList}
                  tone="success"
                />
                <KpiCard
                  label="Unpriced variants"
                  value={coverage.unpricedInDefaultList}
                  tone={coverage.unpricedInDefaultList > 0 ? "warning" : "default"}
                />
                <KpiCard
                  label="Active price lists"
                  value={coverage.totalActivePriceLists}
                />
              </div>

              {/* Per-list breakdown (shown when more than one list exists) */}
              {coverage.perPriceList.length > 1 && (
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
                      {coverage.perPriceList.map((pl) => (
                        <tr key={pl.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-800">
                            {pl.name}
                            {pl.isDefault && (
                              <span className="ml-2 inline-block rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                                default
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{pl.market.displayName}</td>
                          <td className="px-4 py-3 text-slate-600">
                            {pl.currency.symbol} {pl.currency.code}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">
                            {pl.pricedVariants.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">
                            {pl.unpricedVariants > 0 ? (
                              <span className="font-medium text-amber-600">
                                {pl.unpricedVariants.toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span
                              className={
                                pl.coveragePercent >= 90
                                  ? "font-semibold text-green-600"
                                  : pl.coveragePercent >= 60
                                    ? "font-semibold text-amber-600"
                                    : "font-semibold text-red-600"
                              }
                            >
                              {pl.coveragePercent}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/quality/completeness", error));
    }
    throw error;
  }
}
