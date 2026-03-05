import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getDashboardHealth, getStats } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

function toPercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

export default async function QualityCompletenessPage() {
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();

  try {
    const [health, stats] = await Promise.all([
      getDashboardHealth({ role: actorRole, authHeader }),
      getStats({ role: actorRole, authHeader }),
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
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/quality/completeness", error.status));
    }
    throw error;
  }
}
