import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getDashboardHealth, getInstalledConnectors, getSubmissions } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return Array.isArray(value.items) ? value.items : [];
}

export default async function ChannelsOverviewPage() {
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();

  try {
    const [connectors, submissionsResponse, health] = await Promise.all([
      getInstalledConnectors({ role: actorRole, authHeader }),
      getSubmissions({ limit: 100 }, { role: actorRole, authHeader }),
      getDashboardHealth({ role: actorRole, authHeader }),
    ]);
    const submissions = toItems(submissionsResponse);
    const activeConnectors = connectors.filter((item) => item.status === "ACTIVE").length;
    const inactiveConnectors = connectors.length - activeConnectors;
    const failedSubmissions = submissions.filter(
      (submission) => submission.status === "REJECTED" || submission.status === "ERROR",
    ).length;
    const pendingSubmissions = submissions.filter((submission) => submission.status === "PENDING").length;
    const blockedListings = Object.values(health.snapshot.blockedByConnector).reduce((sum, count) => sum + count, 0);

    return (
      <div className="space-y-5">
        <PageHeader
          title="Channels"
          description="Your connected marketplaces — set up, publish, and monitor listings."
          breadcrumb={<span className="font-semibold text-slate-700">Channels</span>}
        />
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Installed Connectors" value={connectors.length} helper={`${activeConnectors} active`} />
          <KpiCard
            label="Submission Jobs"
            value={submissions.length}
            helper={`${failedSubmissions} rejected/error | ${pendingSubmissions} pending`}
            tone={failedSubmissions > 0 ? "warning" : "default"}
          />
          <KpiCard
            label="Ready for Publish"
            value={Object.values(health.snapshot.publishReadyByConnector).reduce((sum, count) => sum + count, 0)}
            tone="success"
          />
          <KpiCard
            label="Blocked Listings"
            value={blockedListings}
            tone={blockedListings > 0 ? "danger" : "default"}
          />
        </section>

        <Card>
          <CardTitle>Channel Health Snapshot</CardTitle>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusChip label={`${activeConnectors} active`} tone="success" />
            <StatusChip label={`${inactiveConnectors} inactive`} tone={inactiveConnectors > 0 ? "warning" : "neutral"} />
            <StatusChip label={`${failedSubmissions} failed/rejected`} tone={failedSubmissions > 0 ? "danger" : "neutral"} />
            <StatusChip label={`${blockedListings} blocked listings`} tone={blockedListings > 0 ? "danger" : "neutral"} />
          </div>
        </Card>

        <section className={`grid gap-4 md:grid-cols-2 ${actorRole === "admin" ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
          <Card className="space-y-3">
            <CardTitle>Connectors</CardTitle>
            <p className="text-sm text-slate-600">Install, reconnect, and review account-level connector status.</p>
            <Link href="/channels/connectors" className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Open connectors
            </Link>
          </Card>
          <Card className="space-y-3">
            <CardTitle>Mappings</CardTitle>
            <p className="text-sm text-slate-600">Maintain channel field and category mappings before submission.</p>
            <Link href="/channels/mappings" className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Open mapping manager
            </Link>
          </Card>
          <Card className="space-y-3">
            <CardTitle>Submissions</CardTitle>
            <p className="text-sm text-slate-600">Track listing outcomes and drill into connector-level failures.</p>
            <Link href="/channels/submissions" className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Open submissions
            </Link>
          </Card>
          <Card className="space-y-3">
            <CardTitle>Health</CardTitle>
            <p className="text-sm text-slate-600">View sync health, blocking trends, and queue status per channel.</p>
            <Link href="/channels/health" className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Open channel health
            </Link>
          </Card>
          {actorRole === "admin" && (
            <Card className="space-y-3">
              <CardTitle>Connector Access</CardTitle>
              <p className="text-sm text-slate-600">Govern connector permissions and plan-based access controls.</p>
              <Link href="/admin/connectors" className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Manage access
              </Link>
            </Card>
          )}
        </section>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/channels", error));
    }
    throw error;
  }
}
