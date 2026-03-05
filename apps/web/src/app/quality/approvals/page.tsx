import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function QualityApprovalsPage() {
  const authHeader = await getServerAuthHeader();
  if (!authHeader) {
    redirect(buildLoginRedirect("/quality/approvals", 401));
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Approval Queue"
        description="Review staged approval work and govern publish-readiness workflow."
        breadcrumb={
          <>
            Dashboard / Quality / <span className="font-semibold text-slate-700">Approval Queue</span>
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="In Review" value={0} />
        <KpiCard label="Ready for Approval" value={0} />
        <KpiCard label="Overdue Tasks" value={0} />
        <KpiCard label="Rejected in Workflow" value={0} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Workflow Status</CardTitle>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusChip label="Workflow not configured" tone="warning" />
            <StatusChip label="Queue empty" tone="neutral" />
          </div>
          <p className="mt-3 text-sm text-slate-600">
            Enable approval workflow rules to route products through draft, review, and approval stages.
          </p>
        </Card>
        <Card>
          <CardTitle>Current Workaround</CardTitle>
          <p className="mt-2 text-sm text-slate-700">
            Use Issue Inbox for current quality triage and manual approval coordination.
          </p>
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

      <Card>
        <EmptyState
          icon="CHECK"
          title="No approval tasks yet"
          description="Approval queue will populate once workflow rules and assignees are configured."
          action={{ label: "Back to Quality", href: "/quality" }}
        />
      </Card>
    </div>
  );
}
