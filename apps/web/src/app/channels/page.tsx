import Link from "@/components/ui/app-link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getDashboardHealth, getInstalledConnectors, getSubmissions } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { canManageChannels } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

type SharedReadState = "available" | "restricted" | "unavailable";

type SharedReadResult<T> =
  | { state: "available"; value: T }
  | { state: "restricted" }
  | { state: "unavailable" };

function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return Array.isArray(value.items) ? value.items : [];
}

function isSharedReadApiUnavailable(error: unknown): boolean {
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
    if (isSharedReadApiUnavailable(error)) {
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
          ? "Some connection data is temporarily unavailable"
          : "Some connection data is restricted"}
      </h2>
      <p className={`mt-2 text-sm ${hasUnavailable ? "text-amber-900/90" : "text-slate-700"}`}>
        {hasUnavailable
          ? "We could not load every connector, submission, or health feed right now. Unavailable cards are held back instead of defaulting to zero."
          : "Your role can still see the shared connection workspace, but some connector or submission totals are intentionally redacted."}
      </p>
    </section>
  );
}

export default async function ChannelsOverviewPage() {
  const { authHeader, actorRole } = await getServerSession();
  const canEditChannelSetup = canManageChannels(actorRole);
  const canManageConnectorAccess = actorRole === "admin";

  try {
    const [connectorsResult, submissionsResult, healthResult] = await Promise.all([
      loadSharedRead(getInstalledConnectors({ role: actorRole, authHeader })),
      loadSharedRead(getSubmissions({ limit: 100 }, { role: actorRole, authHeader })),
      loadSharedRead(getDashboardHealth({ role: actorRole, authHeader })),
    ]);
    const connectors = connectorsResult.state === "available" ? connectorsResult.value : [];
    const submissionsResponse = submissionsResult.state === "available" ? submissionsResult.value : [];
    const health = healthResult.state === "available" ? healthResult.value : null;
    const submissions = toItems(submissionsResponse);
    const activeConnectors = connectors.filter((item) => item.status === "ACTIVE").length;
    const inactiveConnectors = connectors.length - activeConnectors;
    const failedSubmissions = submissions.filter(
      (submission) => submission.status === "REJECTED" || submission.status === "ERROR",
    ).length;
    const pendingSubmissions = submissions.filter((submission) => submission.status === "PENDING").length;
    const blockedListings = health
      ? Object.values(health.snapshot.blockedByConnector).reduce((sum, count) => sum + count, 0)
      : 0;
    const readyToPublish = health
      ? Object.values(health.snapshot.publishReadyByConnector).reduce((sum, count) => sum + count, 0)
      : 0;
    const blockedListingsTotal =
      health && typeof health.blockedTotal === "number" ? health.blockedTotal : blockedListings;
    const readyToPublishTotal =
      health && typeof health.publishReadyTotal === "number" ? health.publishReadyTotal : readyToPublish;
    const connectorBreakdownRedacted = health?.redactedSections?.includes("connector_breakdown") ?? false;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Connections"
          description="Catalog channel operations cockpit for connection health, mappings, issues, and governance."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<span className="font-semibold text-slate-700">Connections</span>
            </>
          }
        />
        <SharedReadNotice
          states={[connectorsResult.state, submissionsResult.state, healthResult.state]}
        />
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Installed Connections"
            value={
              connectorsResult.state === "available"
                ? connectors.length
                : connectorsResult.state === "restricted"
                  ? "Restricted"
                  : "Unavailable"
            }
            helper={
              connectorsResult.state === "available"
                ? `${activeConnectors} active`
                : connectorsResult.state === "restricted"
                  ? "Connector installation totals are limited for your role."
                  : "Connector installation totals are temporarily unavailable."
            }
            tone={connectorsResult.state === "unavailable" ? "warning" : "default"}
          />
          <KpiCard
            label="Submission Jobs"
            value={
              submissionsResult.state === "available"
                ? submissions.length
                : submissionsResult.state === "restricted"
                  ? "Restricted"
                  : "Unavailable"
            }
            helper={
              submissionsResult.state === "available"
                ? `${failedSubmissions} rejected/error | ${pendingSubmissions} pending`
                : submissionsResult.state === "restricted"
                  ? "Submission queue totals are limited for your role."
                  : "Submission queue totals are temporarily unavailable."
            }
            tone={
              submissionsResult.state === "available"
                ? failedSubmissions > 0
                  ? "warning"
                  : "default"
                : submissionsResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
          <KpiCard
            label="Ready for Publish"
            value={
              healthResult.state === "available"
                ? readyToPublishTotal
                : healthResult.state === "restricted"
                  ? "Restricted"
                  : "Unavailable"
            }
            helper={
              healthResult.state === "available"
                ? connectorBreakdownRedacted
                  ? "Aggregate readiness is visible. Channel-level breakdown requires editor or admin access."
                  : undefined
                : healthResult.state === "restricted"
                  ? "Aggregate connection health is limited for your role."
                  : "Connection health is temporarily unavailable."
            }
            tone={
              healthResult.state === "available"
                ? "success"
                : healthResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
          <KpiCard
            label="Blocked Listings"
            value={
              healthResult.state === "available"
                ? blockedListingsTotal
                : healthResult.state === "restricted"
                  ? "Restricted"
                  : "Unavailable"
            }
            helper={
              healthResult.state === "available"
                ? connectorBreakdownRedacted
                  ? "Aggregate blocked totals are visible. Channel-level breakdown requires editor or admin access."
                  : undefined
                : healthResult.state === "restricted"
                  ? "Blocked-listing totals are limited for your role."
                  : "Blocked-listing totals are temporarily unavailable."
            }
            tone={
              healthResult.state === "available"
                ? blockedListingsTotal > 0
                  ? "danger"
                  : "default"
                : healthResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
        </section>

        <Card>
          <CardTitle>Channel Health Snapshot</CardTitle>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {connectorsResult.state === "available" ? (
              <>
                <StatusChip label={`${activeConnectors} active`} tone="success" />
                <StatusChip label={`${inactiveConnectors} inactive`} tone={inactiveConnectors > 0 ? "warning" : "neutral"} />
              </>
            ) : (
              <StatusChip
                label={
                  connectorsResult.state === "restricted"
                    ? "Connector status restricted"
                    : "Connector status unavailable"
                }
                tone="neutral"
              />
            )}
            {submissionsResult.state === "available" ? (
              <StatusChip label={`${failedSubmissions} failed/rejected`} tone={failedSubmissions > 0 ? "danger" : "neutral"} />
            ) : (
              <StatusChip
                label={
                  submissionsResult.state === "restricted"
                    ? "Submission queue restricted"
                    : "Submission queue unavailable"
                }
                tone="neutral"
              />
            )}
            {healthResult.state === "available" ? (
              <>
                <StatusChip label={`${blockedListingsTotal} blocked listings`} tone={blockedListingsTotal > 0 ? "danger" : "neutral"} />
                {connectorBreakdownRedacted ? <StatusChip label="Per-channel details limited" tone="neutral" /> : null}
              </>
            ) : (
              <StatusChip
                label={
                  healthResult.state === "restricted"
                    ? "Connection health restricted"
                    : "Connection health unavailable"
                }
                tone="neutral"
              />
            )}
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
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/channels", error));
    }
    throw error;
  }
}
