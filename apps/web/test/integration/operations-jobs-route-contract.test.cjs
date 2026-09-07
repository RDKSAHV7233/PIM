#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const JOBS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "operations", "jobs", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(JOBS_PAGE, "utf8");

  assert(
      source.includes("await getServerSession();"),
    "Operations jobs must derive shared auth/session context from the server helpers.",
  );
  assert(
    source.includes('const statusFilter = String(query.status ?? "").trim().toUpperCase();') &&
      source.includes('const connectorSlug = String(query.connectorSlug ?? "").trim().toLowerCase();') &&
      source.includes('const selectedSubmissionId = String(query.submissionId ?? "").trim();'),
    "Operations jobs must normalize status, connector slug, and submission selection filters before fetching.",
  );
  assert(
    source.includes('type SharedReadState = "available" | "restricted" | "unavailable";') &&
      source.includes("async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>>") &&
      source.includes("const [submissionsResult, deadLetterResult, bulkPublishRunsResult] = await Promise.all([") &&
      source.includes("loadSharedRead(getSubmissions(") &&
      source.includes("status: statusFilter || undefined,") &&
      source.includes("connectorSlug: connectorSlug || undefined,") &&
      source.includes("loadSharedRead(getDeadLetterSubmissions({ limit: deadLetterLimit }, { role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getBulkPublishRuns(20, { role: actorRole, authHeader }))"),
    "Operations jobs must fetch submissions, dead-letter records, and bulk-publish runs together through explicit shared-read wrappers.",
  );
  assert(
    source.includes("function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[]") &&
      source.includes("return value.filter(Boolean);") &&
      source.includes("return Array.isArray(value.items) ? value.items.filter(Boolean) : [];") &&
      source.includes("if (submissionsResult.state === \"restricted\") {") &&
      source.includes("if (submissionsResult.state === \"unavailable\") {") &&
      source.includes("const selectedSubmission = selectedSubmissionId") &&
      source.includes("submissions.find((submission) => submission.id === selectedSubmissionId) ?? null"),
    "Operations jobs must normalize list payload shapes, gate the core submission feed honestly, and resolve the selected submission from the current result set.",
  );
  assert(
    source.includes("function safeText(value: unknown, fallback = \"-\"): string") &&
      source.includes("function safeCount(value: unknown): number") &&
      source.includes("function channelErrorsFor(value: {") &&
      source.includes("function bulkPublishRunStatusLabel(status: unknown): string") &&
      source.includes("function bulkPublishRunProgressLabel(run: {") &&
      source.includes("channelErrorsFor(selectedSubmission).length === 0 ? (") &&
      source.includes("bulkPublishRunProgressLabel(run)") &&
      source.includes("getRowKey={(run) => safeText(run.id)}") &&
      !source.includes("selectedSubmission.channelErrors.length === 0 ? (") &&
      !source.includes("run.status.replace(/_/g, \" \")"),
    "Operations jobs must defensively normalize live operational row fields before rendering Server Components.",
  );
  assert(
    source.includes("function operatorRecoveryReason(value: unknown): string") &&
      source.includes("Retry attempt did not resume automatically. Review connector health, then requeue from the Repair Center.") &&
      source.includes("internalRetryLeakPatterns.some((pattern) => pattern.test(reason))") &&
      source.includes("operatorRecoveryReason(job.dlqReason || job.failureReason)") &&
      !source.includes('safeText(job.dlqReason || job.failureReason, "Needs recovery.")'),
    "Operations jobs must translate internal retry diagnostics before rendering dead-letter recovery reasons.",
  );
  assert(
    source.includes("const statusCounts = submissions.reduce<Record<string, number>>(") &&
      source.includes('label="Visible Submissions"') &&
      source.includes("Latest ${visibleSubmissionLimit} matching jobs") &&
      source.includes('label="Pending"') &&
      source.includes('label="Rejected / Error"') &&
      source.includes('label="Dead Letter"') &&
      source.includes("Combined failure totals are temporarily unavailable.") &&
      source.includes("Dead-letter volume is limited for your role."),
    "Operations jobs must derive the jobs KPI cards from live submission counts while keeping dead-letter truth explicit when that supporting feed is restricted or unavailable.",
  );
  assert(
    source.includes("<RefreshOnInterval intervalMs={30_000} />") &&
      source.includes('id="jobs-status-filter"') &&
      source.includes('id="jobs-connector-filter"') &&
      source.includes('id="jobs-submission-filter"') &&
      source.includes('href="/operations/jobs"'),
    "Operations jobs must auto-refresh and expose normalized filter controls with a clear path back to the base route.",
  );
  assert(
    source.includes('title="No submission jobs found"') &&
      source.includes('description="No jobs match the current filter scope."') &&
      source.includes("Job recovery access is restricted") &&
      source.includes("Job recovery is temporarily unavailable") &&
      source.includes('secondaryAction={{ label: "Open Repair Center", href: "/operations/repair" }}'),
    "Operations jobs must surface honest restricted, unavailable, and empty states with a repair-center escalation path.",
  );
  assert(
    source.includes('className={`border-t border-slate-200 ${') &&
      source.includes('selectedSubmissionId === submission.id ? "bg-amber-50" : "hover:bg-slate-50/50"') &&
      source.includes("CardTitle>Selected Submission Detail</CardTitle>") &&
      source.includes("channelErrorsFor(selectedSubmission).length === 0 ? (") &&
      source.includes('text-sm font-medium text-slate-900">Submission recovery timeline</p>') &&
      source.includes("Timeline className=\"mt-3\" items={submissionTimelineItems(selectedSubmission)}"),
    "Operations jobs must highlight the selected submission row and surface a detail panel with honest channel-error handling.",
  );
  assert(
    source.includes('href="/operations/repair"') &&
      source.includes('href="/channels/connectors"') &&
      source.includes('if (error instanceof ApiHttpError && error.status === 401)') &&
      source.includes('redirect(buildLoginRedirect("/operations/jobs", error));'),
    "Operations jobs must deep-link operators into repair/channel workspaces and redirect only expired sessions through the shared login helper.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "operations_jobs_route_uses_shared_server_auth_context",
          "operations_jobs_route_normalizes_filter_inputs",
          "operations_jobs_route_fetches_submissions_and_dead_letter_in_parallel",
          "operations_jobs_route_normalizes_payload_shapes_and_selected_submission",
          "operations_jobs_route_defensively_normalizes_live_operational_fields",
          "operations_jobs_route_translates_internal_retry_diagnostics",
          "operations_jobs_route_derives_kpis_from_live_status_counts",
          "operations_jobs_route_exposes_refresh_and_filter_controls",
          "operations_jobs_route_surfaces_empty_state_with_repair_escalation",
          "operations_jobs_route_highlights_selected_submission_detail",
          "operations_jobs_route_links_to_repair_channels_and_redirects_auth_failures",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Operations jobs route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
