import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getDashboardHealth, getIssueInbox, getStats } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { canDecideApproval, canEditWorkspace } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

type SharedReadState = "available" | "restricted" | "unavailable";

type SharedReadResult<T> =
  | { state: "available"; value: T }
  | { state: "restricted" }
  | { state: "unavailable" };

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
          ? "Some quality data is temporarily unavailable"
          : "Some quality data is restricted"}
      </h2>
      <p className={`mt-2 text-sm ${hasUnavailable ? "text-amber-900/90" : "text-slate-700"}`}>
        {hasUnavailable
          ? "We could not load every quality health, stats, or inbox feed right now. Unavailable cards are held back instead of defaulting to healthy counts."
          : "Your role can still review the quality workspace, but some quality totals are intentionally redacted."}
      </p>
    </section>
  );
}

export default async function QualityPage() {
  const { authHeader, actorRole } = await getServerSession();
  const canTriageWarnings = canEditWorkspace(actorRole);
  const canRecordReviewDecisions = canDecideApproval(actorRole);

  try {
    const [healthResult, statsResult, inboxResult] = await Promise.all([
      loadSharedRead(getDashboardHealth({ role: actorRole, authHeader })),
      loadSharedRead(getStats({ role: actorRole, authHeader })),
      loadSharedRead(getIssueInbox({ limit: 50 }, { role: actorRole, authHeader })),
    ]);
    const completenessState: SharedReadState =
      healthResult.state === "available" && statsResult.state === "available"
        ? "available"
        : healthResult.state === "unavailable" || statsResult.state === "unavailable"
          ? "unavailable"
          : "restricted";
    const completenessData =
      healthResult.state === "available" && statsResult.state === "available"
        ? {
            completeSkus: healthResult.value.snapshot.completeSkus,
            products: statsResult.value.products,
          }
        : null;
    const completeness = completenessData
      ? toPercent(completenessData.completeSkus, completenessData.products)
      : null;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Quality"
          description="Find problems fast, understand impact, and move products to publish-ready."
          breadcrumb={<span className="font-semibold text-slate-700">Quality</span>}
        />
        <SharedReadNotice states={[healthResult.state, statsResult.state, inboxResult.state]} />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Blocking Issues"
            value={
              healthResult.state === "available"
                ? healthResult.value.snapshot.openIssuesBlocking
                : healthResult.state === "restricted"
                  ? "Restricted"
                  : "Unavailable"
            }
            helper={
              healthResult.state === "available"
                ? "Requires product fixes before publish"
                : healthResult.state === "restricted"
                  ? "Blocking-issue totals are limited for your role."
                  : "Blocking-issue totals are temporarily unavailable."
            }
            tone={
              healthResult.state === "available"
                ? healthResult.value.snapshot.openIssuesBlocking > 0
                  ? "danger"
                  : "success"
                : healthResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
          <KpiCard
            label="Warnings"
            value={
              healthResult.state === "available"
                ? healthResult.value.snapshot.openIssuesWarning
                : healthResult.state === "restricted"
                  ? "Restricted"
                  : "Unavailable"
            }
            helper={
              healthResult.state === "available"
                ? "Non-blocking but impacts quality"
                : healthResult.state === "restricted"
                  ? "Warning totals are limited for your role."
                  : "Warning totals are temporarily unavailable."
            }
            tone={
              healthResult.state === "available"
                ? healthResult.value.snapshot.openIssuesWarning > 0
                  ? "warning"
                  : "default"
                : healthResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
          <KpiCard
            label="Completeness"
            value={
              completenessData
                ? completenessData.products === 0
                  ? "—"
                  : `${completeness}%`
                : completenessState === "restricted"
                  ? "Restricted"
                  : "Unavailable"
            }
            helper={
              completenessData
                ? completenessData.products === 0
                  ? "Add products to track completeness"
                  : `${completenessData.completeSkus}/${completenessData.products} complete`
                : completenessState === "restricted"
                  ? "Completeness metrics are limited for your role."
                  : "Completeness metrics are temporarily unavailable."
            }
            tone={
              completenessData
                ? completenessData.products === 0
                  ? "default"
                  : (completeness ?? 0) >= 90
                    ? "success"
                    : (completeness ?? 0) >= 70
                      ? "info"
                      : "warning"
                : completenessState === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
          <KpiCard
            label="Rejected Risk High"
            value={
              healthResult.state === "available"
                ? healthResult.value.snapshot.rejectionRiskHigh
                : healthResult.state === "restricted"
                  ? "Restricted"
                  : "Unavailable"
            }
            helper={
              healthResult.state === "available"
                ? "From readiness and rejection patterns"
                : healthResult.state === "restricted"
                  ? "Rejection-risk totals are limited for your role."
                  : "Rejection-risk totals are temporarily unavailable."
            }
            tone={
              healthResult.state === "available"
                ? healthResult.value.snapshot.rejectionRiskHigh > 0
                  ? "warning"
                  : "default"
                : healthResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
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
              {healthResult.state === "available" ? (
                <>
                  <StatusChip
                    label={`${healthResult.value.snapshot.openIssuesBlocking} blocking`}
                    tone={healthResult.value.snapshot.openIssuesBlocking > 0 ? "danger" : "neutral"}
                  />
                  <StatusChip
                    label={`${healthResult.value.snapshot.openIssuesWarning} warning`}
                    tone={healthResult.value.snapshot.openIssuesWarning > 0 ? "warning" : "neutral"}
                  />
                </>
              ) : (
                <StatusChip
                  label={
                    healthResult.state === "restricted"
                      ? "Issue totals restricted"
                      : "Issue totals unavailable"
                  }
                  tone="neutral"
                />
              )}
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
            {inboxResult.state === "available" ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                <span>Resolved today: {inboxResult.value.resolvedToday}</span>
                <span>|</span>
                <span>Trend: {formatTrend(inboxResult.value.trend)}</span>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                {inboxResult.state === "restricted"
                  ? "Issue inbox insights are limited for your role."
                  : "Issue inbox insights are temporarily unavailable."}
              </p>
            )}
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
              {completenessState === "available" ? (
                <StatusChip
                  label={`${completeness}% complete`}
                  tone={(completeness ?? 0) >= 90 ? "success" : "warning"}
                />
              ) : (
                <StatusChip
                  label={
                    completenessState === "restricted"
                      ? "Completeness restricted"
                      : "Completeness unavailable"
                  }
                  tone="neutral"
                />
              )}
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
                : "Review products in workflow review. Final approval decisions require reviewer, approver, or admin access."}
            </p>
            <Link href="/quality/approvals" className="mt-4 inline-flex text-sm font-medium text-blue-700 hover:underline">
              {canRecordReviewDecisions ? "Open Approval Queue" : "Review Approval Queue"}
            </Link>
          </Card>
        </section>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/quality", error));
    }
    throw error;
  }
}
