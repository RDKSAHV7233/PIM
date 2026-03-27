import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getDashboardHealth, getIssueInbox } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function QualityValidationPage() {
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();

  try {
    const [health, inbox] = await Promise.all([
      getDashboardHealth({ role: actorRole, authHeader }),
      getIssueInbox({ limit: 50 }, { role: actorRole, authHeader }),
    ]);
    const blocking = health.snapshot.openIssuesBlocking;
    const warnings = health.snapshot.openIssuesWarning;
    const inScope = blocking + warnings;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Validation"
          description="Central workspace for blocking checks, warnings, and compliance readiness."
          breadcrumb={
            <>
              Dashboard / Quality / <span className="font-semibold text-slate-700">Validation</span>
            </>
          }
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Blocking Issues"
            value={blocking}
            helper="Must be fixed before channel submission"
            tone={blocking > 0 ? "danger" : "success"}
          />
          <KpiCard
            label="Warnings"
            value={warnings}
            helper="Non-blocking but quality-impacting"
            tone={warnings > 0 ? "warning" : "default"}
          />
          <KpiCard
            label="Validation Scope"
            value={inScope}
            helper="Current open validation items"
            tone={inScope > 0 ? "info" : "default"}
          />
          <KpiCard
            label="Resolved Today"
            value={inbox.resolvedToday}
            helper={`Trend: ${inbox.trend} vs yesterday`}
            tone="success"
          />
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardTitle>Severity Lanes</CardTitle>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusChip label="Compliance rules" tone="info" />
              <StatusChip label={`${blocking} blocking`} tone={blocking > 0 ? "danger" : "neutral"} />
              <StatusChip label={`${warnings} warning`} tone={warnings > 0 ? "warning" : "neutral"} />
              <StatusChip label="Action required" tone="neutral" />
            </div>
            <p className="mt-3 text-sm text-slate-600">
              Use Issue Inbox for fix assignment. Product-level validation execution happens from Product Detail.
            </p>
          </Card>

          <Card>
            <CardTitle>Actions</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              Split by severity to clear blockers first, then improve warnings.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/quality/issues?severity=BLOCKING" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                View Blocking Issues
              </Link>
              <Link href="/quality/issues?severity=WARNING" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                View Warnings
              </Link>
              <Link href="/catalog/products" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Open Products
              </Link>
            </div>
          </Card>
        </section>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/quality/validation", error));
    }
    throw error;
  }
}
