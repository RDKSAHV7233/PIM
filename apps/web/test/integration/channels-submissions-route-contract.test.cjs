#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SUBMISSIONS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "channels", "submissions", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(SUBMISSIONS_PAGE, "utf8");

  assert(
      source.includes("await getServerSession();"),
    "Channels submissions must derive server auth context from the shared auth/session helpers.",
  );
  assert(
    source.includes('const statusFilter = String(query.status ?? "").trim().toUpperCase();') &&
      source.includes('const connectorSlug = String(query.connectorSlug ?? "").trim().toLowerCase();'),
    "Channels submissions must normalize status and connector slug filters before using them.",
  );
  assert(
    source.includes("getSubmissions(") &&
      source.includes("limit: 100,") &&
      source.includes("status: statusFilter || undefined,") &&
      source.includes("connectorSlug: connectorSlug || undefined,") &&
      source.includes("{ role: actorRole, authHeader }"),
    "Channels submissions must call the shared submissions client with normalized filters and shared auth context.",
  );
  assert(
    source.includes("function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[]") &&
      source.includes("return Array.isArray(value.items) ? value.items : [];"),
    "Channels submissions must normalize array-vs-paginated submission payloads through a shared toItems helper.",
  );
  assert(
    source.includes('if (normalized === "PENDING" || normalized === "RETRYING") {') &&
      source.includes('if (normalized === "REJECTED" || normalized === "ERROR" || normalized === "DEAD_LETTER") {') &&
      source.includes('label="Total Submissions"') &&
      source.includes('label="Pending"') &&
      source.includes('label="Accepted"') &&
      source.includes('label="Rejected / Error"'),
    "Channels submissions must derive KPI cards and status tones from live normalized submission states.",
  );
  assert(
    source.includes("Submission triage guide") &&
      source.includes("Watch pending work") &&
      source.includes("Open Jobs for recovery") &&
      source.includes("Trace product context") &&
      source.includes("needs an explicit retry after catalog or connector fixes.") &&
      source.includes("latest payload context, readiness state, or mapped channel data behind a submission."),
    "Channels submissions must guide operators on when to monitor history, when to recover in Jobs, and when to inspect the product context.",
  );
  assert(
    source.includes('id="channel-submissions-status"') &&
      source.includes('id="channel-submissions-connector"') &&
      source.includes('href="/channels/submissions"') &&
      source.includes('href="/channels/health"') &&
      source.includes('href="/operations/jobs"'),
    "Channels submissions must expose filter controls plus clear and workspace deep links for operators.",
  );
  assert(
    source.includes('href={`/products/${encodeURIComponent(submission.productId)}`}') &&
      source.includes("StatusChip label={normalizeStatus(submission.status)} tone={statusTone(submission.status)}") &&
      source.includes("submission.submittedAt") &&
      source.includes("formatDateTime") &&
      source.includes("CardTitle>Latest Submission Timeline</CardTitle>") &&
      source.includes("Timeline className=\"mt-3\" items={submissionTimelineItems(latestSubmission)}"),
    "Channels submissions must keep product drilldown, normalized status chips, and submission timestamps visible in the table.",
  );
  assert(
    source.includes('No submissions found for the current filter scope.') &&
      source.includes('redirect(buildLoginRedirect("/channels/submissions", error));'),
    "Channels submissions must surface a truthful empty state and redirect auth failures through the shared login helper.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "channels_submissions_route_uses_shared_server_auth_context",
          "channels_submissions_route_normalizes_filters_before_fetch",
          "channels_submissions_route_fetches_submissions_with_normalized_query",
          "channels_submissions_route_normalizes_list_payload_shape",
          "channels_submissions_route_derives_kpis_and_status_tones",
          "channels_submissions_route_guides_submission_triage",
          "channels_submissions_route_preserves_operator_filters_and_links",
          "channels_submissions_route_keeps_product_drilldowns_and_timestamps",
          "channels_submissions_route_handles_empty_and_auth_redirect_states",
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
  console.error("Channels submissions route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
