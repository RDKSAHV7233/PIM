import Link from "next/link";
import { redirect } from "next/navigation";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getDashboardHealth } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function ChannelsHealthPage() {
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();

  try {
    const health = await getDashboardHealth({ role: actorRole, authHeader });
    const connectorEntries = Object.entries(health.snapshot.publishReadyByConnector);
    const totalReady = connectorEntries.reduce((sum, [, count]) => sum + count, 0);
    const totalBlocked = Object.values(health.snapshot.blockedByConnector).reduce((sum, count) => sum + count, 0);

    return (
      <div className="space-y-5">
        <PageHeader
          title="Channel Health"
          description="Readiness and blocked listing status by channel."
          breadcrumb={
            <>
              Dashboard / Channels / <span className="font-semibold text-slate-700">Health</span>
            </>
          }
          actions={
            <>
              <Link href="/channels/submissions" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                Open Submissions
              </Link>
              <Link href="/operations/jobs" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                Open Jobs
              </Link>
            </>
          }
        />

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Ready Listings" value={totalReady} tone="success" />
          <KpiCard label="Blocked Listings" value={totalBlocked} tone={totalBlocked > 0 ? "danger" : "default"} />
          <KpiCard label="Blocking Issues" value={health.snapshot.openIssuesBlocking} tone="warning" />
          <KpiCard label="Warning Issues" value={health.snapshot.openIssuesWarning} />
        </section>

        <Card>
          <CardTitle>Per Channel</CardTitle>
          <p className="mt-2 text-xs text-slate-500">As of {new Date(health.asOf).toLocaleString()}</p>
          {connectorEntries.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                icon="PLUG"
                title="No channel readiness records yet"
                description="Install and configure connectors to start collecting readiness and blocked listing signals."
                action={{ label: "Open Connectors", href: "/channels/connectors" }}
              />
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Channel</th>
                    <th className="px-3 py-2">Ready</th>
                    <th className="px-3 py-2">Blocked</th>
                    <th className="px-3 py-2">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {connectorEntries.map(([slug, ready]) => {
                    const blocked = health.snapshot.blockedByConnector[slug] ?? 0;
                    const healthTone = blocked > 0 ? "warning" : ready > 0 ? "success" : "neutral";
                    const healthLabel = blocked > 0 ? "Attention" : ready > 0 ? "Healthy" : "No activity";

                    return (
                      <tr key={slug} className="border-t border-slate-200 hover:bg-slate-50/50">
                        <td className="px-3 py-2.5 font-medium">{slug}</td>
                        <td className="px-3 py-2.5">{ready}</td>
                        <td className="px-3 py-2.5">{blocked}</td>
                        <td className="px-3 py-2.5">
                          <StatusChip label={healthLabel} tone={healthTone} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/channels/health", error.status));
    }
    throw error;
  }
}
