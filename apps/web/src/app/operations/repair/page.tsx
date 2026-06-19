import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getBulkImportJobs, getDeadLetterSubmissions } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { translateJobStatus } from "@/lib/errors";
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

function isOperationsRepairApiUnavailable(error: unknown): boolean {
  if (error instanceof ApiHttpError) {
    return error.status === 429 || error.status === 500 || error.status === 502 || error.status === 503 || error.status === 504;
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
    if (isOperationsRepairApiUnavailable(error)) {
      return { state: "unavailable" };
    }
    throw error;
  }
}

function OperationsRepairStatusState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Repair Center"
        description="Resolve failed imports and dead-letter channel submissions."
        breadcrumb={
          <>
            Dashboard / Operations / <span className="font-semibold text-slate-700">Repair Center</span>
          </>
        }
      />
      <Card aria-live="polite" aria-atomic="true">
        <CardTitle>{title}</CardTitle>
        <p className="mt-3 text-sm text-slate-600">{description}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/operations" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Open operations overview
          </Link>
          <Link href="/operations/jobs" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Open Jobs
          </Link>
        </div>
      </Card>
    </div>
  );
}

export default async function OperationsRepairPage() {
  const { authHeader, actorRole } = await getServerSession();

  try {
    const [importJobsResult, deadLetterResult] = await Promise.all([
      loadSharedRead(getBulkImportJobs({ role: actorRole, authHeader })),
      loadSharedRead(getDeadLetterSubmissions({ limit: 100 }, { role: actorRole, authHeader })),
    ]);

    if (importJobsResult.state === "restricted") {
      return (
        <OperationsRepairStatusState
          title="Import repair access is restricted"
          description="Your role can open operations, but import repair backlog details are intentionally redacted."
        />
      );
    }

    if (importJobsResult.state === "unavailable") {
      return (
        <OperationsRepairStatusState
          title="Import repair is temporarily unavailable"
          description="We could not load import repair backlog right now. The page is held in an unavailable state instead of showing a false zero-repair queue."
        />
      );
    }

    const importJobs = importJobsResult.value;
    const deadLetterSubmissions =
      deadLetterResult.state === "available" ? toItems(deadLetterResult.value) : [];
    const failedImports = importJobs.filter((job) => job.deadLetterRows > 0 || job.failedRows > 0);
    const deadLetterRows = failedImports.reduce((sum, job) => sum + job.deadLetterRows, 0);
    const failedRows = failedImports.reduce((sum, job) => sum + job.failedRows, 0);
    const submissionDeadLetterValue =
      deadLetterResult.state === "available"
        ? deadLetterSubmissions.length
        : deadLetterResult.state === "restricted"
          ? "Restricted"
          : "Unavailable";

    return (
      <div className="space-y-5">
        <PageHeader
          title="Repair Center"
          description="Resolve failed imports and dead-letter channel submissions."
          breadcrumb={
            <>
              Dashboard / Operations / <span className="font-semibold text-slate-700">Repair Center</span>
            </>
          }
          actions={
            <>
              <Link href="/operations/imports" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                Import Repairs
              </Link>
              <Link href="/operations/jobs" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                Submission Jobs
              </Link>
            </>
          }
        />

        {deadLetterResult.state !== "available" ? (
          <section
            aria-live="polite"
            aria-atomic="true"
            role="status"
            className={`rounded-xl border p-4 shadow-sm ${
              deadLetterResult.state === "unavailable" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"
            }`}
          >
            <h2 className={`text-sm font-semibold ${deadLetterResult.state === "unavailable" ? "text-amber-900" : "text-slate-900"}`}>
              {deadLetterResult.state === "unavailable"
                ? "Submission dead-letter data is temporarily unavailable"
                : "Submission dead-letter data is restricted"}
            </h2>
            <p className={`mt-2 text-sm ${deadLetterResult.state === "unavailable" ? "text-amber-900/90" : "text-slate-700"}`}>
              {deadLetterResult.state === "unavailable"
                ? "We could not load escalated submission backlog right now. Dead-letter counts are held back instead of defaulting to healthy zeroes."
                : "Your role can still review import repair backlog, but submission dead-letter details are intentionally redacted."}
            </p>
          </section>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Import Jobs Requiring Repair" value={failedImports.length} tone={failedImports.length > 0 ? "warning" : "success"} />
          <KpiCard label="Import Dead-Letter Rows" value={deadLetterRows} tone={deadLetterRows > 0 ? "danger" : "default"} />
          <KpiCard label="Import Failed Rows" value={failedRows} tone={failedRows > 0 ? "warning" : "default"} />
          <KpiCard
            label="Submission Dead Letter Queue"
            value={submissionDeadLetterValue}
            helper={
              deadLetterResult.state === "available"
                ? "Escalated submission backlog"
                : deadLetterResult.state === "restricted"
                  ? "Submission dead-letter totals are limited for your role."
                  : "Submission dead-letter totals are temporarily unavailable."
            }
            tone={
              deadLetterResult.state === "available"
                ? deadLetterSubmissions.length > 0
                  ? "danger"
                  : "default"
                : deadLetterResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
        </section>

        <Card>
          <CardTitle>Repair playbook</CardTitle>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Fix source data first</p>
              <p className="mt-1 text-sm text-slate-600">
                Repair import rows when the catalog payload itself is incomplete, malformed, or mapped to the wrong category context.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Retry delivery only when ready</p>
              <p className="mt-1 text-sm text-slate-600">
                Move to Jobs after the catalog or connector issue is resolved so retries do not repeat the same downstream failure.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Escalate repeated dead letter</p>
              <p className="mt-1 text-sm text-slate-600">
                Escalate when the same submission keeps failing after fixes, because that usually points to connector configuration or receiver-side drift.
              </p>
            </div>
          </div>
        </Card>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Import Jobs Needing Repair</CardTitle>
            {failedImports.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No import repair backlog.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {failedImports.slice(0, 10).map((job) => (
                  <li key={job.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50/50">
                    <div>
                      <p className="font-mono text-xs text-slate-700">{job.id}</p>
                      <p className="text-slate-600">{job.category?.path ?? job.categoryId}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusChip label={`${job.deadLetterRows} dead letter`} tone={job.deadLetterRows > 0 ? "danger" : "warning"} />
                      <Link href={`/operations/imports?bulkJobId=${encodeURIComponent(job.id)}`} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                        Repair
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Submission Dead Letter Queue</CardTitle>
            {deadLetterResult.state === "restricted" ? (
              <p className="mt-2 text-sm text-slate-600">Submission dead-letter details are restricted for your role.</p>
            ) : deadLetterResult.state === "unavailable" ? (
              <p className="mt-2 text-sm text-slate-600">Submission dead-letter details are temporarily unavailable.</p>
            ) : deadLetterSubmissions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No dead-letter submission backlog.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {deadLetterSubmissions.slice(0, 10).map((submission) => (
                  <li key={submission.id} className="rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50/50">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-xs text-slate-700">{submission.id}</p>
                      <StatusChip label={translateJobStatus(submission.status)} tone="warning" />
                    </div>
                    <p className="mt-1 text-slate-600">Channel: {submission.channel}</p>
                    <p className="text-xs text-slate-500">{submission.failureReason ?? submission.dlqReason ?? "No reason recorded"}</p>
                    <Link href="/operations/jobs" className="mt-2 inline-flex rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                      Open in Jobs
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/operations/repair", error));
    }
    throw error;
  }
}
