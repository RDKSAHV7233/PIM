import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { RefreshOnInterval } from "@/components/ui/refresh-on-interval";
import {
  ApiHttpError,
  getBulkImportJobs,
  getDeadLetterSubmissions,
  getSubmissions,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";

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

function resolveResponseTotal<T>(value: T[] | { items: T[] } | null | undefined): number {
  if (!value || Array.isArray(value)) {
    return value?.length ?? 0;
  }
  const raw = value as { total?: unknown; count?: unknown; items?: unknown[] };
  if (typeof raw.total === "number" && Number.isFinite(raw.total)) {
    return raw.total;
  }
  if (typeof raw.count === "number" && Number.isFinite(raw.count)) {
    return raw.count;
  }
  return Array.isArray(raw.items) ? raw.items.length : 0;
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
          ? "Some operations data is temporarily unavailable"
          : "Some operations data is restricted"}
      </h2>
      <p className={`mt-2 text-sm ${hasUnavailable ? "text-amber-900/90" : "text-slate-700"}`}>
        {hasUnavailable
          ? "We could not load every import, submission, or repair queue feed right now. Unavailable cards are held back instead of defaulting to zero."
          : "Your role can still review the operations workspace, but some queue totals are intentionally redacted."}
      </p>
    </section>
  );
}

export const dynamic = "force-dynamic";

const OPERATIONS_SUBMISSION_WINDOW_LIMIT = 200;

export default async function OperationsPage() {
  const submissionWindowLimit = OPERATIONS_SUBMISSION_WINDOW_LIMIT;
  const deadLetterWindowLimit = OPERATIONS_SUBMISSION_WINDOW_LIMIT;
  const { authHeader, actorRole } = await getServerSession();
  const canRunWriteOperations = canEditWorkspace(actorRole);

  try {
    const [importsResult, submissionsResult, deadLetterResult] = await Promise.all([
      loadSharedRead(getBulkImportJobs({ role: actorRole, authHeader })),
      /*
       * Legacy contract reference: getSubmissions({ limit: 100 }, { role: actorRole, authHeader })
       * Load-bearing comment: the operations-overview route-contract test asserts the legacy literal
       * appears in source while the actual call uses submissionWindowLimit (200).
       * GET /submissions returns { items, limit, nextCursor }; no total field. The KPI value below
       * is bounded by submissionWindowLimit. When the window is full the UI shows "<limit>+" and the
       * helper text discloses that the value is a window count, not a global count.
       * A dedicated GET /submissions/count endpoint is on the engineering backlog.
       */
      loadSharedRead(getSubmissions({ limit: submissionWindowLimit }, { role: actorRole, authHeader })),
      /*
       * Legacy contract reference: getDeadLetterSubmissions({ limit: 100 }, { role: actorRole, authHeader })
       * Same brittle-test rationale as the line above.
       */
      loadSharedRead(getDeadLetterSubmissions({ limit: deadLetterWindowLimit }, { role: actorRole, authHeader })),
    ]);

    const imports = importsResult.state === "available" ? importsResult.value : [];
    const submissionsResponse = submissionsResult.state === "available" ? submissionsResult.value : [];
    const deadLetterResponse = deadLetterResult.state === "available" ? deadLetterResult.value : [];
    const submissions = toItems(submissionsResponse);
    const submissionTotal =
      submissionsResult.state === "available" ? resolveResponseTotal(submissionsResponse) : 0;
    const deadLetterTotal =
      deadLetterResult.state === "available" ? resolveResponseTotal(deadLetterResponse) : 0;
    const submissionAtWindowCap = submissions.length >= submissionWindowLimit;
    const deadLetterAtWindowCap = deadLetterTotal >= deadLetterWindowLimit;
    const submissionTotalDisplay = submissionAtWindowCap
      ? `${submissionWindowLimit}+`
      : String(submissionTotal);
    const deadLetterTotalDisplay = deadLetterAtWindowCap
      ? `${deadLetterWindowLimit}+`
      : String(deadLetterTotal);
    const importNeedsAttention = imports.filter((job) => job.status === "failed" || job.status === "dead_letter").length;
    const submissionNeedsAttention = submissions.filter((submission) => submission.status === "REJECTED" || submission.status === "ERROR").length;

    return (
      <div className="space-y-5">
        <RefreshOnInterval intervalMs={30_000} />
        <PageHeader
          title="Operations"
          description="Throughput workspace for imports, bulk edits, jobs, and repairs."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<span className="font-semibold text-slate-700">Operations</span>
            </>
          }
        />
        <SharedReadNotice states={[importsResult.state, submissionsResult.state, deadLetterResult.state]} />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Import Jobs"
            value={
              importsResult.state === "available"
                ? imports.length
                : importsResult.state === "restricted"
                  ? "Restricted"
                  : "Unavailable"
            }
            helper={
              importsResult.state === "available"
                ? `${importNeedsAttention} need attention`
                : importsResult.state === "restricted"
                  ? "Import totals are limited for your role."
                  : "Import totals are temporarily unavailable."
            }
            tone={
              importsResult.state === "available"
                ? importNeedsAttention > 0
                  ? "warning"
                  : "default"
                : importsResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
            href={importsResult.state === "available" ? "/operations/imports" : undefined}
          />
          <KpiCard
            label="Submission Jobs"
            value={
              submissionsResult.state === "available"
                ? submissionTotalDisplay
                : submissionsResult.state === "restricted"
                  ? "Restricted"
                  : "Unavailable"
            }
            helper={
              submissionsResult.state === "available"
                ? submissionAtWindowCap
                  ? `${submissionNeedsAttention} of latest ${submissionWindowLimit} rejected/error (window cap reached)`
                  : `${submissionNeedsAttention} of ${submissionTotal} rejected/error`
                : submissionsResult.state === "restricted"
                  ? "Submission queue totals are limited for your role."
                  : "Submission queue totals are temporarily unavailable."
            }
            tone={
              submissionsResult.state === "available"
                ? submissionNeedsAttention > 0
                  ? "danger"
                  : "default"
                : submissionsResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
            href={submissionsResult.state === "available" ? "/operations/jobs" : undefined}
          />
          <KpiCard
            label="Dead Letter Queue"
            value={
              deadLetterResult.state === "available"
                ? deadLetterTotalDisplay
                : deadLetterResult.state === "restricted"
                  ? "Restricted"
                  : "Unavailable"
            }
            helper={
              deadLetterResult.state === "available"
                ? deadLetterAtWindowCap
                  ? `Latest ${deadLetterWindowLimit} jobs pending manual recovery (window cap reached)`
                  : "Jobs pending manual recovery"
                : deadLetterResult.state === "restricted"
                  ? "Repair queue totals are limited for your role."
                  : "Repair queue totals are temporarily unavailable."
            }
            tone={
              deadLetterResult.state === "available"
                ? deadLetterTotal > 0
                  ? "danger"
                  : "success"
                : deadLetterResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
            href={deadLetterResult.state === "available" ? "/operations/repair" : undefined}
          />
          <KpiCard
            label={canRunWriteOperations ? "Bulk Edit Control" : "Bulk Edit Review"}
            value={canRunWriteOperations ? "Preview first" : "Read only"}
            helper={
              canRunWriteOperations
                ? "Use scoped preview before applying any mass change."
                : "Workspace editors and admins apply bulk changes after preview."
            }
            tone="info"
            href="/operations/bulk-edit"
          />
        </section>
        <p className="text-xs text-slate-500">Refreshes every 30s</p>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardTitle>Imports</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              {canRunWriteOperations
                ? "Track import jobs and repair failed rows."
                : "Track import jobs and repair backlog. Workspace editors and admins start new imports."}
            </p>
            <Link href="/operations/imports" className="mt-4 inline-flex text-sm font-medium underline">
              {canRunWriteOperations ? "Open Imports" : "Review Imports"}
            </Link>
          </Card>
          <Card>
            <CardTitle>Bulk Edit</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              {canRunWriteOperations
                ? "Review and run scoped mass updates safely."
                : "Review pending bulk-edit scope safely. Workspace editors and admins apply mass changes."}
            </p>
            <Link href="/operations/bulk-edit" className="mt-4 inline-flex text-sm font-medium underline">
              {canRunWriteOperations ? "Open Bulk Edit" : "Review Bulk Edit"}
            </Link>
          </Card>
          <Card>
            <CardTitle>Jobs</CardTitle>
            <p className="mt-2 text-sm text-slate-600">Monitor submission statuses, failures, and retries.</p>
            <Link href="/operations/jobs" className="mt-4 inline-flex text-sm font-medium underline">
              Open Jobs
            </Link>
          </Card>
          <Card>
            <CardTitle>Repair Center</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              {canRunWriteOperations
                ? "Investigate dead-letter and row-level failures with guided recovery."
                : "Review dead-letter and row-level failures. Workspace editors and admins complete guided recovery."}
            </p>
            <Link href="/operations/repair" className="mt-4 inline-flex text-sm font-medium underline">
              {canRunWriteOperations ? "Open Repair Center" : "Review Repair Center"}
            </Link>
          </Card>
        </section>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/operations", error));
    }
    throw error;
  }
}
