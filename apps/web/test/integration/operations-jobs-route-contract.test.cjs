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
    source.includes("const authHeader = await getServerAuthHeader();") &&
      source.includes("const actorRole = await getServerActorRole();"),
    "Operations jobs must derive shared auth/session context from the server helpers.",
  );
  assert(
    source.includes('const statusFilter = String(query.status ?? "").trim().toUpperCase();') &&
      source.includes('const connectorSlug = String(query.connectorSlug ?? "").trim().toLowerCase();') &&
      source.includes('const selectedSubmissionId = String(query.submissionId ?? "").trim();'),
    "Operations jobs must normalize status, connector slug, and submission selection filters before fetching.",
  );
  assert(
    source.includes("const [submissionsResponse, deadLetterResponse] = await Promise.all([") &&
      source.includes("getSubmissions(") &&
      source.includes("status: statusFilter || undefined,") &&
      source.includes("connectorSlug: connectorSlug || undefined,") &&
      source.includes("getDeadLetterSubmissions({ limit: deadLetterLimit }, { role: actorRole, authHeader })"),
    "Operations jobs must fetch submissions and dead-letter records together from the shared auth context.",
  );
  assert(
    source.includes("function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[]") &&
      source.includes("return Array.isArray(value.items) ? value.items : [];") &&
      source.includes("const selectedSubmission = selectedSubmissionId") &&
      source.includes("submissions.find((submission) => submission.id === selectedSubmissionId) ?? null"),
    "Operations jobs must normalize list payload shapes and resolve the selected submission from the current result set.",
  );
  assert(
    source.includes("const statusCounts = submissions.reduce<Record<string, number>>(") &&
      source.includes('label="Visible Submissions"') &&
      source.includes("Latest ${visibleSubmissionLimit} matching jobs") &&
      source.includes('label="Pending"') &&
      source.includes('label="Rejected / Error"') &&
      source.includes('label="Dead Letter"') &&
      source.includes("Latest ${deadLetterLimit} dead-letter jobs"),
    "Operations jobs must derive the jobs KPI cards from live normalized submission counts and dead-letter volume.",
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
      source.includes('secondaryAction={{ label: "Open Repair Center", href: "/operations/repair" }}'),
    "Operations jobs must surface an honest empty state with a repair-center escalation path.",
  );
  assert(
    source.includes('className={`border-t border-slate-200 ${') &&
      source.includes('selectedSubmissionId === submission.id ? "bg-amber-50" : "hover:bg-slate-50/50"') &&
      source.includes("CardTitle>Selected Submission Detail</CardTitle>") &&
      source.includes("selectedSubmission.channelErrors.length === 0 ? ("),
    "Operations jobs must highlight the selected submission row and surface a detail panel with honest channel-error handling.",
  );
  assert(
    source.includes('href="/operations/repair"') &&
      source.includes('href="/channels/connectors"') &&
      source.includes('redirect(buildLoginRedirect("/operations/jobs", error));'),
    "Operations jobs must deep-link operators into repair/channel workspaces and redirect auth failures through the shared login helper.",
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
