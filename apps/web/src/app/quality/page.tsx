import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getDashboardHealth, getIssueInbox, getStats } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { canDecideApproval, canEditWorkspace } from "@/lib/role-capabilities";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

function toPercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

function formatTrend(trend: string): string {
  const normalized = trend.trim().toLowerCase();
  if (normalized === "up" || normalized === "improving") {
    return "↑ Improving";
  }
  if (normalized === "down" || normalized === "worsening") {
    return "↓ Getting worse";
  }
  return "→ Stable";
}

export default async function QualityPage() {
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canTriageWarnings = canEditWorkspace(actorRole);
  const canRecordReviewDecisions = canDecideApproval(actorRole);

  try {
    const [health, stats, inbox] = await Promise.all([
      getDashboardHealth({ role: actorRole, authHeader }),
      getStats({ role: actorRole, authHeader }),
      getIssueInbox({ limit: 50 }, { role: actorRole, authHeader }),
    ]);

    const completeness = toPercent(health.snapshot.completeSkus, stats.products);

    return (
      <div className="space-y-5">
        <PageHeader
          title="Quality"
          description="Find problems fast, understand impact, and move products to publish-ready."
          breadcrumb={<span className="font-semibold text-slate-700">Quality</span>}
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Blocking Issues"
            value={health.snapshot.openIssuesBlocking}
            helper="Requires product fixes before publish"
            tone={health.snapshot.openIssuesBlocking > 0 ? "danger" : "success"}
          />
          <KpiCard
            label="Warnings"
            value={health.snapshot.openIssuesWarning}
            helper="Non-blocking but impacts quality"
            tone={health.snapshot.openIssuesWarning > 0 ? "warning" : "default"}
          />
          <KpiCard
            label="Completeness"
            value={stats.products === 0 ? "—" : `${completeness}%`}
            helper={stats.products === 0 ? "Add products to track completeness" : `${health.snapshot.completeSkus}/${stats.products} complete`}
            tone={stats.products === 0 ? "default" : completeness >= 90 ? "success" : completeness >= 70 ? "info" : "warning"}
          />
          <KpiCard
            label="Rejected Risk High"
            value={health.snapshot.rejectionRiskHigh}
            helper="From readiness and rejection patterns"
            tone={health.snapshot.rejectionRiskHigh > 0 ? "warning" : "default"}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardTitle>Issue Inbox</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              {canTriageWarnings
                ? "Triage blocking and warning issues with scope filters and ownership."
                : "Review blocking and warning issues with scope filters and ownership. Workspace editors and admins resolve warnings."}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <StatusChip
                label={`${health.snapshot.openIssuesBlocking} blocking`}
                tone={health.snapshot.openIssuesBlocking > 0 ? "danger" : "neutral"}
              />
              <StatusChip
                label={`${health.snapshot.openIssuesWarning} warning`}
                tone={health.snapshot.openIssuesWarning > 0 ? "warning" : "neutral"}
              />
            </div>
            <Link href="/quality/issues" className="mt-4 inline-flex text-sm font-medium text-blue-700 hover:underline">
              Open Issue Inbox
            </Link>
          </Card>

          <Card>
            <CardTitle>Validation</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              Review compliance coverage and quickly split blocking versus warning scopes.
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <span>Resolved today: {inbox.resolvedToday}</span>
              <span>|</span>
              <span>Trend: {formatTrend(inbox.trend)}</span>
            </div>
            <Link href="/quality/validation" className="mt-4 inline-flex text-sm font-medium text-blue-700 hover:underline">
              Open Validation
            </Link>
          </Card>

          <Card>
            <CardTitle>Completeness</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              Track missing data and progress catalog readiness with clear completeness metrics.
            </p>
            <div className="mt-3">
              <StatusChip label={`${completeness}% complete`} tone={completeness >= 90 ? "success" : "warning"} />
            </div>
            <Link href="/quality/completeness" className="mt-4 inline-flex text-sm font-medium text-blue-700 hover:underline">
              Open Completeness
            </Link>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardTitle>Rejection Insights</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              Analyze likely channel rejection patterns and prioritize high-risk products.
            </p>
            <Link href="/rejection" className="mt-4 inline-flex text-sm font-medium text-blue-700 hover:underline">
              Open Rejection Insights
            </Link>
          </Card>
          <Card>
            <CardTitle>Approval Queue</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              {canRecordReviewDecisions
                ? "Review products in workflow review and record final approval decisions."
                : "Review products in workflow review. Final approval decisions require approver, editor, or admin access."}
            </p>
            <Link href="/quality/approvals" className="mt-4 inline-flex text-sm font-medium text-blue-700 hover:underline">
              {canRecordReviewDecisions ? "Open Approval Queue" : "Review Approval Queue"}
            </Link>
          </Card>
        </section>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/quality", error));
    }
    throw error;
  }
}
