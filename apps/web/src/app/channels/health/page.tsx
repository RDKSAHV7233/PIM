import Link from "next/link";
import { redirect } from "next/navigation";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getDashboardHealth, getInstalledConnectors } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function ChannelsHealthPage() {
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();

  try {
    const [health, installations] = await Promise.all([
      getDashboardHealth({ role: actorRole, authHeader }),
      getInstalledConnectors({ role: actorRole, authHeader }).catch(() => []),
    ]);
    const connectorEntries = Object.entries(health.snapshot.publishReadyByConnector);
    const totalReady = connectorEntries.reduce((sum, [, count]) => sum + count, 0);
    const totalBlocked = Object.values(health.snapshot.blockedByConnector).reduce((sum, count) => sum + count, 0);
    const readyListings = typeof health.publishReadyTotal === "number" ? health.publishReadyTotal : totalReady;
    const blockedListings = typeof health.blockedTotal === "number" ? health.blockedTotal : totalBlocked;
    const connectorBreakdownRedacted = health.redactedSections?.includes("connector_breakdown") ?? false;
    const connectorColumns: Column<{ slug: string; ready: number; blocked: number }>[] = [
      {
        key: "channel",
        header: "Channel",
        render: (entry) => <span className="font-medium">{entry.slug}</span>,
      },
      { key: "ready", header: "Ready", render: (entry) => entry.ready },
      { key: "blocked", header: "Blocked", render: (entry) => entry.blocked },
      {
        key: "score",
        header: "Readiness",
        render: (entry) => {
          const total = entry.ready + entry.blocked;
          if (total === 0) return <span className="text-slate-400 text-xs">—</span>;
          const pct = Math.round((entry.ready / total) * 100);
          const colorClass =
            pct === 100 ? "text-green-700" : pct >= 80 ? "text-amber-700" : "text-red-600";
          return <span className={`font-semibold text-sm ${colorClass}`}>{pct}%</span>;
        },
      },
      {
        key: "health",
        header: "Status",
        render: (entry) => {
          const ready = entry.ready;
          const blocked = entry.blocked;
          const healthTone = blocked > 0 ? "warning" : ready > 0 ? "success" : "neutral";
          const healthLabel = blocked > 0 ? "Attention" : ready > 0 ? "Healthy" : "No activity";
          return <StatusChip label={healthLabel} tone={healthTone} />;
        },
      },
      {
        key: "actions",
        header: "",
        render: (entry) => (
          <Link
            href={`/channels/submissions?connectorSlug=${encodeURIComponent(entry.slug)}&status=REJECTED`}
            className="text-xs text-blue-600 hover:underline whitespace-nowrap"
          >
            View errors →
          </Link>
        ),
      },
    ];
    const connectorRows = connectorEntries.map(([slug, ready]) => ({
      slug,
      ready,
      blocked: health.snapshot.blockedByConnector[slug] ?? 0,
    }));

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
          <KpiCard label="Ready Listings" value={readyListings} tone="success" />
          <KpiCard label="Blocked Listings" value={blockedListings} tone={blockedListings > 0 ? "danger" : "default"} />
          <KpiCard label="Blocking Issues" value={health.snapshot.openIssuesBlocking} tone="warning" />
          <KpiCard label="Warning Issues" value={health.snapshot.openIssuesWarning} />
        </section>

        <Card>
          <CardTitle>Health triage guide</CardTitle>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Fix content blockers first</p>
              <p className="mt-1 text-sm text-slate-600">
                Start with blocking issues when listings are not ready, because incomplete product data prevents publishable payloads from forming at all.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Check mappings next</p>
              <p className="mt-1 text-sm text-slate-600">
                Move to the mapping workspace when a channel stays blocked after quality fixes, especially if required attributes differ by marketplace.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Use Jobs for delivery failures</p>
              <p className="mt-1 text-sm text-slate-600">
                Open Jobs when listings were ready but the connector or downstream system still rejected the submission or needs a retry.
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>Per Channel</CardTitle>
          <p className="mt-2 text-xs text-slate-500">As of {new Date(health.asOf).toLocaleString()}</p>
          {connectorBreakdownRedacted ? (
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Per-channel connector breakdown is limited to editor and admin roles. The aggregate readiness and blocking
              totals above remain available for read-only quality review.
            </div>
          ) : connectorEntries.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                icon="PLUG"
                title="No channel readiness records yet"
                description="Install and configure connectors to start collecting readiness and blocked listing signals."
                action={{ label: "Open Connectors", href: "/channels/connectors" }}
              />
            </div>
          ) : (
            <DataGrid
              className="mt-3"
              columns={connectorColumns}
              rows={connectorRows}
              getRowKey={(entry) => entry.slug}
            />
          )}
        </Card>

        {installations.length > 0 ? (
          <Card>
            <CardTitle>Per Store</CardTitle>
            <p className="mt-1 text-xs text-slate-500">One row per connected store account.</p>
            <div className="mt-3 divide-y divide-slate-100">
              {installations.map((inst) => {
                const ready = health.snapshot.publishReadyByConnector[inst.slug] ?? 0;
                const blocked = health.snapshot.blockedByConnector?.[inst.slug] ?? 0;
                const healthTone = blocked > 0 ? "warning" : ready > 0 ? "success" : "neutral";
                const healthLabel = blocked > 0 ? "Attention" : ready > 0 ? "Healthy" : "No activity";
                const storeName = (() => {
                  const meta = inst.metadata && typeof inst.metadata === "object" && !Array.isArray(inst.metadata)
                    ? inst.metadata as Record<string, unknown>
                    : {};
                  return String(meta.shopName ?? meta.shopDomain ?? "").trim() || inst.accountAlias;
                })();
                return (
                  <div key={inst.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/channels/connectors/${encodeURIComponent(inst.id)}`}
                        className="text-sm font-medium text-blue-700 hover:underline"
                      >
                        {storeName}
                      </Link>
                      <p className="text-xs text-slate-500">{inst.displayName} · {inst.accountAlias}</p>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-slate-700">{ready} ready</span>
                      <span className={blocked > 0 ? "text-red-600 font-medium" : "text-slate-400"}>{blocked} blocked</span>
                      <StatusChip label={healthLabel} tone={healthTone} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ) : null}
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/channels/health", error));
    }
    throw error;
  }
}
