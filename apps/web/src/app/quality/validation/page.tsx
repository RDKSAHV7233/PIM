import Link from "@/components/ui/app-link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getDashboardHealth, getIssueInbox } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

type SharedReadState = "available" | "restricted" | "unavailable";
type SharedReadResult<T> =
  | { state: "available"; value: T }
  | { state: "restricted" }
  | { state: "unavailable" };

function isValidationApiUnavailable(error: unknown): boolean {
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
    if (isValidationApiUnavailable(error)) {
      return { state: "unavailable" };
    }
    throw error;
  }
}

function ValidationSharedReadNotice({ states }: { states: SharedReadState[] }) {
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
          ? "Some validation data is temporarily unavailable"
          : "Some validation data is restricted"}
      </h2>
      <p className={`mt-2 text-sm ${hasUnavailable ? "text-amber-900/90" : "text-slate-700"}`}>
        {hasUnavailable
          ? "We could not load every validation feed right now. Blocking, warning, and resolved-today totals are held back instead of defaulting to healthy values."
          : "Your role can still open validation, but some quality totals are intentionally redacted."}
      </p>
    </section>
  );
}

function buildMetricValue(state: SharedReadState, value: number): number | string {
  if (state === "available") {
    return value;
  }
  return state === "restricted" ? "Restricted" : "Unavailable";
}

function buildMetricTone(
  state: SharedReadState,
  value: number,
  availableTones: {
    positive: "success" | "default" | "info";
    attention: "success" | "warning" | "danger" | "info";
  },
) {
  if (state !== "available") {
    return state === "unavailable" ? "warning" : "default";
  }
  return value > 0 ? availableTones.attention : availableTones.positive;
}

export default async function QualityValidationPage() {
  const { authHeader, actorRole } = await getServerSession();

  try {
    const [healthResult, inboxResult] = await Promise.all([
      loadSharedRead(getDashboardHealth({ role: actorRole, authHeader })),
      loadSharedRead(getIssueInbox({ limit: 50 }, { role: actorRole, authHeader })),
    ]);
    const validationState: SharedReadState = healthResult.state;
    const blocking = healthResult.state === "available" ? healthResult.value.snapshot.openIssuesBlocking : null;
    const warnings = healthResult.state === "available" ? healthResult.value.snapshot.openIssuesWarning : null;
    const inScope = blocking !== null && warnings !== null ? blocking + warnings : null;
    const validationMetrics =
      validationState === "available"
        ? {
            blocking: blocking ?? 0,
            warnings: warnings ?? 0,
          }
        : null;
    const resolvedToday = inboxResult.state === "available" ? inboxResult.value.resolvedToday : null;
    const resolvedTrend = inboxResult.state === "available" ? inboxResult.value.trend : null;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Validation"
          description="Central workspace for blocking checks, warnings, and compliance readiness."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/quality" className="hover:underline">Quality</Link>{" / "}<span className="font-semibold text-slate-700">Validation</span>
            </>
          }
        />
        <ValidationSharedReadNotice states={[healthResult.state, inboxResult.state]} />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Blocking Issues"
            value={buildMetricValue(validationState, blocking ?? 0)}
            helper={
              validationState === "available"
                ? "Must be fixed before channel submission"
                : validationState === "restricted"
                  ? "Blocking validation totals are limited for your role."
                  : "Blocking validation totals are temporarily unavailable."
            }
            tone={buildMetricTone(validationState, blocking ?? 0, { positive: "success", attention: "danger" })}
          />
          <KpiCard
            label="Warnings"
            value={buildMetricValue(validationState, warnings ?? 0)}
            helper={
              validationState === "available"
                ? "Non-blocking but quality-impacting"
                : validationState === "restricted"
                  ? "Warning totals are limited for your role."
                  : "Warning totals are temporarily unavailable."
            }
            tone={buildMetricTone(validationState, warnings ?? 0, { positive: "default", attention: "warning" })}
          />
          <KpiCard
            label="Validation Scope"
            value={buildMetricValue(validationState, inScope ?? 0)}
            helper={
              validationState === "available"
                ? "Current open validation items"
                : validationState === "restricted"
                  ? "Validation scope is limited for your role."
                  : "Validation scope is temporarily unavailable."
            }
            tone={buildMetricTone(validationState, inScope ?? 0, { positive: "default", attention: "info" })}
          />
          <KpiCard
            label="Resolved Today"
            value={buildMetricValue(inboxResult.state, resolvedToday ?? 0)}
            helper={
              inboxResult.state === "available"
                ? `Trend: ${resolvedTrend} vs yesterday`
                : inboxResult.state === "restricted"
                  ? "Issue-resolution totals are limited for your role."
                  : "Issue-resolution totals are temporarily unavailable."
            }
            tone={buildMetricTone(inboxResult.state, resolvedToday ?? 0, { positive: "success", attention: "success" })}
          />
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardTitle>Severity Lanes</CardTitle>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusChip label="Compliance rules" tone="info" />
              {validationMetrics ? (
                <>
                  <StatusChip
                    label={`${validationMetrics.blocking} blocking`}
                    tone={validationMetrics.blocking > 0 ? "danger" : "neutral"}
                  />
                  <StatusChip
                    label={`${validationMetrics.warnings} warning`}
                    tone={validationMetrics.warnings > 0 ? "warning" : "neutral"}
                  />
                  <StatusChip label="Action required" tone="neutral" />
                </>
              ) : (
                <>
                  <StatusChip
                    label={validationState === "restricted" ? "Blocking restricted" : "Blocking unavailable"}
                    tone="neutral"
                  />
                  <StatusChip
                    label={validationState === "restricted" ? "Warnings restricted" : "Warnings unavailable"}
                    tone="neutral"
                  />
                </>
              )}
            </div>
            <p className="mt-3 text-sm text-slate-600">
              {validationState === "available"
                ? "Use Issue Inbox for fix assignment. Product-level validation execution happens from Product Detail."
                : validationState === "restricted"
                  ? "Validation drilldowns stay available, but severity totals are intentionally redacted for your role."
                  : "Validation drilldowns stay available while live severity totals reconnect."}
            </p>
          </Card>

          <Card>
            <CardTitle>Actions</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              {validationState === "available"
                ? "Split by severity to clear blockers first, then improve warnings."
                : "Open the detailed workspaces directly while shared validation totals are limited."}
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
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/quality/validation", error));
    }
    throw error;
  }
}
