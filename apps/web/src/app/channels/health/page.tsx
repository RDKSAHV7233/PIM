import Link from "next/link";
import { redirect } from "next/navigation";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getConnectorInstallationsHealth, getConnectorSummary, getDashboardHealth, getInstalledConnectors } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type SharedReadState = "available" | "restricted" | "unavailable";

type SharedReadResult<T> =
  | { state: "available"; value: T }
  | { state: "restricted" }
  | { state: "unavailable" };

function isChannelsHealthApiUnavailable(error: unknown): boolean {
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
    if (isChannelsHealthApiUnavailable(error)) {
      return { state: "unavailable" };
    }
    throw error;
  }
}

function SharedReadNotice({ states }: { states: SharedReadState[] }) {
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
          ? "Some channel health data is temporarily unavailable"
          : "Some channel health data is restricted"}
      </h2>
      <p className={`mt-2 text-sm ${hasUnavailable ? "text-amber-900/90" : "text-slate-700"}`}>
        {hasUnavailable
          ? "We could not load every connector summary, readiness, or issue feed right now. Unavailable cards and tables are held back instead of defaulting to healthy channel totals."
          : "Your role can still review allowed connector health truth, but some per-channel or per-store details are intentionally redacted."}
      </p>
    </section>
  );
}

export default async function ChannelsHealthPage() {
  const { authHeader, actorRole } = await getServerSession();

  try {
    const [healthResult, connectorHealthResult, connectorSummaryResult, installationsResult] = await Promise.all([
      loadSharedRead(getDashboardHealth({ role: actorRole, authHeader })),
      loadSharedRead(getConnectorInstallationsHealth({ role: actorRole, authHeader })),
      loadSharedRead(getConnectorSummary({ role: actorRole, authHeader })),
      loadSharedRead(getInstalledConnectors({ role: actorRole, authHeader })),
    ]);
    const health = healthResult.state === "available" ? healthResult.value : null;
    const connectorHealth = connectorHealthResult.state === "available" ? connectorHealthResult.value : null;
    const installations = installationsResult.state === "available" ? installationsResult.value : [];
    const connectorEntries = connectorHealth?.connectors ?? [];
    const installationEntries = connectorHealth?.installations ?? [];
    const readyListings =
      connectorSummaryResult.state === "available"
        ? connectorSummaryResult.value.totals.ready
        : connectorSummaryResult.state === "restricted"
          ? "Restricted"
          : "Unavailable";
    const blockedListings =
      connectorSummaryResult.state === "available"
        ? connectorSummaryResult.value.totals.blocked
        : connectorSummaryResult.state === "restricted"
          ? "Restricted"
          : "Unavailable";
    const blockingIssues =
      healthResult.state === "available"
        ? healthResult.value.snapshot.openIssuesBlocking
        : healthResult.state === "restricted"
          ? "Restricted"
          : "Unavailable";
    const warningIssues =
      healthResult.state === "available"
        ? healthResult.value.snapshot.openIssuesWarning
        : healthResult.state === "restricted"
          ? "Restricted"
          : "Unavailable";
    const connectorBreakdownRedacted = health?.redactedSections?.includes("connector_breakdown") ?? false;
    const storeMetadataMessage =
      installationsResult.state === "restricted"
        ? "Store account labels are limited for your role."
        : installationsResult.state === "unavailable"
          ? "Store account labels are temporarily unavailable."
          : null;
    const perChannelMessage =
      connectorHealthResult.state === "restricted" || connectorBreakdownRedacted
        ? "Per-channel connector breakdown is limited to editor and admin roles. The aggregate readiness and blocking totals above remain available for read-only quality review."
        : connectorHealthResult.state === "unavailable"
          ? "Per-channel connector breakdown is temporarily unavailable."
          : null;
    const connectorColumns: Column<(typeof connectorEntries)[number]>[] = [
      {
        key: "channel",
        header: "Channel",
        render: (entry) => <span className="font-medium">{entry.displayName}</span>,
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
        <SharedReadNotice states={[healthResult.state, connectorHealthResult.state, connectorSummaryResult.state, installationsResult.state]} />

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Ready Listings"
            value={readyListings}
            tone={connectorSummaryResult.state === "available" ? "success" : connectorSummaryResult.state === "unavailable" ? "warning" : "default"}
            helper={
              connectorSummaryResult.state === "available"
                ? "Listings ready to publish now."
                : connectorSummaryResult.state === "restricted"
                  ? "Connector readiness totals are limited for your role."
                  : "Connector readiness totals are temporarily unavailable."
            }
          />
          <KpiCard
            label="Blocked Listings"
            value={blockedListings}
            tone={
              connectorSummaryResult.state === "available"
                ? connectorSummaryResult.value.totals.blocked > 0
                  ? "danger"
                  : "default"
                : connectorSummaryResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
            helper={
              connectorSummaryResult.state === "available"
                ? "Listings currently blocked from channel publish."
                : connectorSummaryResult.state === "restricted"
                  ? "Blocked listing totals are limited for your role."
                  : "Blocked listing totals are temporarily unavailable."
            }
          />
          <KpiCard
            label="Blocking Issues"
            value={blockingIssues}
            tone={healthResult.state === "available" ? "warning" : healthResult.state === "unavailable" ? "warning" : "default"}
            helper={
              healthResult.state === "available"
                ? "Issues preventing channel readiness."
                : healthResult.state === "restricted"
                  ? "Blocking issue totals are limited for your role."
                  : "Blocking issue totals are temporarily unavailable."
            }
          />
          <KpiCard
            label="Warning Issues"
            value={warningIssues}
            tone={healthResult.state === "available" ? "default" : healthResult.state === "unavailable" ? "warning" : "default"}
            helper={
              healthResult.state === "available"
                ? "Warnings that still need operator review."
                : healthResult.state === "restricted"
                  ? "Warning issue totals are limited for your role."
                  : "Warning issue totals are temporarily unavailable."
            }
          />
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
          <p className="mt-2 text-xs text-slate-500">
            {healthResult.state === "available"
              ? `As of ${formatDateTime(healthResult.value.asOf)}`
              : "Latest aggregate channel snapshot unavailable"}
          </p>
          {perChannelMessage ? (
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {perChannelMessage}
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
              rows={connectorEntries}
              getRowKey={(entry) => entry.slug}
            />
          )}
        </Card>

        {installationEntries.length > 0 || storeMetadataMessage ? (
          <Card>
            <CardTitle>Per Store</CardTitle>
            <p className="mt-1 text-xs text-slate-500">One row per connected store account.</p>
            {storeMetadataMessage ? (
              <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {storeMetadataMessage}
              </div>
            ) : null}
            <div className="mt-3 divide-y divide-slate-100">
              {installationEntries.map((inst) => {
                const installation = installations.find((item) => item.id === inst.installationId);
                const ready = inst.ready;
                const blocked = inst.blocked;
                const pending = inst.pending;
                const healthTone = blocked > 0 ? "warning" : ready > 0 ? "success" : pending > 0 ? "warning" : "neutral";
                const healthLabel = blocked > 0 ? "Attention" : ready > 0 ? "Healthy" : pending > 0 ? "Pending" : "No activity";
                const storeName = (() => {
                  const meta = installation?.metadata && typeof installation.metadata === "object" && !Array.isArray(installation.metadata)
                    ? installation.metadata as Record<string, unknown>
                    : {};
                  return String(meta.shopName ?? meta.shopDomain ?? "").trim() || installation?.accountAlias || inst.accountAlias;
                })();
                return (
                  <div key={inst.installationId} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/channels/connectors/${encodeURIComponent(inst.installationId)}`}
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
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/channels/health", error));
    }
    throw error;
  }
}
