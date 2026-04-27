import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getDashboardHealth, getInstalledConnectors, getSubmissions } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { canEditWorkspace } from "@/lib/role-capabilities";
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
  const canEditChannelSetup = canEditWorkspace(actorRole);
  const canManageConnectorAccess = actorRole === "admin";

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
    const readyToPublish = Object.values(health.snapshot.publishReadyByConnector).reduce((sum, count) => sum + count, 0);
    const blockedListingsTotal =
      typeof health.blockedTotal === "number" ? health.blockedTotal : blockedListings;
    const readyToPublishTotal =
      typeof health.publishReadyTotal === "number" ? health.publishReadyTotal : readyToPublish;
    const connectorBreakdownRedacted = health.redactedSections?.includes("connector_breakdown") ?? false;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Connections"
          description="Catalog channel operations cockpit for connection health, mappings, issues, and governance."
          breadcrumb={
            <>
              Dashboard / <span className="font-semibold text-slate-700">Connections</span>
            </>
          }
        />
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Installed Connections" value={connectors.length} helper={`${activeConnectors} active`} />
          <KpiCard
            label="Submission Jobs"
            value={submissions.length}
            helper={`${failedSubmissions} rejected/error | ${pendingSubmissions} pending`}
            tone={failedSubmissions > 0 ? "warning" : "default"}
          />
          <KpiCard
            label="Ready for Publish"
            value={readyToPublishTotal}
            helper={
              connectorBreakdownRedacted
                ? "Aggregate readiness is visible. Channel-level breakdown requires editor or admin access."
                : undefined
            }
            tone="success"
          />
          <KpiCard
            label="Blocked Listings"
            value={blockedListingsTotal}
            helper={
              connectorBreakdownRedacted
                ? "Aggregate blocked totals are visible. Channel-level breakdown requires editor or admin access."
                : undefined
            }
            tone={blockedListingsTotal > 0 ? "danger" : "default"}
          />
        </section>

        <Card>
          <CardTitle>Channel Health Snapshot</CardTitle>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusChip label={`${activeConnectors} active`} tone="success" />
            <StatusChip label={`${inactiveConnectors} inactive`} tone={inactiveConnectors > 0 ? "warning" : "neutral"} />
            <StatusChip label={`${failedSubmissions} failed/rejected`} tone={failedSubmissions > 0 ? "danger" : "neutral"} />
            <StatusChip label={`${blockedListingsTotal} blocked listings`} tone={blockedListingsTotal > 0 ? "danger" : "neutral"} />
            {connectorBreakdownRedacted ? <StatusChip label="Per-channel details limited" tone="neutral" /> : null}
          </div>
        </Card>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Card className="space-y-3">
            <CardTitle>Connections</CardTitle>
            <p className="text-sm text-slate-600">
              {canEditChannelSetup
                ? "Install, reconnect, and review account-level connector status."
                : "Review connector status and coordinate install or reconnect requests with a workspace editor or admin."}
            </p>
            <Link href="/channels/connectors" className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {canEditChannelSetup ? "Open connections" : "Review connections"}
            </Link>
          </Card>
          <Card className="space-y-3">
            <CardTitle>Mappings</CardTitle>
            <p className="text-sm text-slate-600">
              {canEditChannelSetup
                ? "Maintain channel field and category mappings before submission."
                : "Review channel field and category mappings. Workspace editors and admins apply mapping changes."}
            </p>
            <Link href="/channels/mappings" className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {canEditChannelSetup ? "Open mapping manager" : "Review mappings"}
            </Link>
          </Card>
          <Card className="space-y-3">
            <CardTitle>Issues</CardTitle>
            <p className="text-sm text-slate-600">Track listing outcomes and drill into connector-level failures.</p>
            <Link href="/channels/health" className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Open issues and health
            </Link>
          </Card>
          <Card className="space-y-3">
            <CardTitle>Submission Log</CardTitle>
            <p className="text-sm text-slate-600">Review submission history, queue pressure, and connector delivery context.</p>
            <Link href="/channels/submissions" className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Open submissions
            </Link>
          </Card>
          <Card className="space-y-3">
            <CardTitle>Governance</CardTitle>
            <p className="text-sm text-slate-600">
              {canManageConnectorAccess
                ? "Govern connector permissions, alias scope, and plan-based access controls."
                : "Workspace admins manage connector permissions and plan-based access. Review the current governance rules and request changes when needed."}
            </p>
            <Link href="/admin/connectors" className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {canManageConnectorAccess ? "Open governance" : "Review governance rules"}
            </Link>
          </Card>
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
