#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const JOBS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "operations", "jobs", "page.tsx");
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractFunctionBody(source, signature) {
  const start = source.indexOf(signature);
  assert(start !== -1, `actions.ts: could not locate "${signature}"`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`actions.ts: unterminated body for "${signature}"`);
}

function run() {
  const source = fs.readFileSync(JOBS_PAGE, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS_FILE, "utf8");

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
      source.includes("const [submissionsResult, deadLetterResult, bulkPublishRunsResult, installationsResult] = await Promise.all([") &&
      source.includes("loadSharedRead(getSubmissions(") &&
      source.includes("status: statusFilter || undefined,") &&
      source.includes("connectorSlug: connectorSlug || undefined,") &&
      source.includes("loadSharedRead(getDeadLetterSubmissions({ limit: deadLetterLimit }, { role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getBulkPublishRuns({ limit: 20, installationId: bulkPublishInstallationId || undefined }, { role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getInstalledConnectors({ role: actorRole, authHeader })).catch("),
    "Operations jobs must fetch submissions, dead-letter records, bulk-publish runs, and installed connectors together through explicit shared-read wrappers.",
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

  assert(
    source.includes('key: "store"') &&
      source.includes('header: "Store"') &&
      source.includes("installationById.get(run.installationId)") &&
      source.includes("resolveInstallationLabel(installation)"),
    "Bulk Publish Runs must show which installation/store each run belongs to, not just its connector slug " +
      "(a tenant with two installations of the same connector would otherwise see indistinguishable rows).",
  );

  assert(
    source.includes("const showBulkPublishStoreFilter = installations.length > 1;") &&
      source.includes('id="jobs-installation-filter"') &&
      source.includes('name="installationId"'),
    "Bulk Publish Runs must expose a store filter once a tenant has more than one installation to disambiguate between.",
  );

  assert(
    /getInstalledConnectors\(\{ role: actorRole, authHeader \}\)\)\.catch\([\s\S]{0,200}error\.status === 401[\s\S]{0,60}throw error;[\s\S]{0,40}return \{ state: "unavailable" \};/.test(source),
    "The installed-connectors fetch only labels/filters bulk-publish runs, so any failure other than an expired " +
      "session (401) must degrade to 'unavailable' instead of rethrowing and taking down the whole Jobs page.",
  );

  assert(
    /const buildJobsHref = [\s\S]{0,500}params\.set\("installationId", bulkPublishInstallationId\)/.test(source),
    "Submission detail links must preserve the Bulk Publish Runs store filter instead of silently clearing it.",
  );

  assert(
    source.includes("const hiddenBulkPublishStoreFilter =") &&
      source.includes("!(showBulkPublishStoreFilter && installationById.has(bulkPublishInstallationId))") &&
      source.includes("Clear store filter") &&
      !/installations\.find\(\(item\) => item\.id === run\.installationId\)/.test(source) &&
      source.includes('installationsResult.state === "available" ? "Installation no longer connected" : "Store details unavailable"'),
    "A URL store filter must never narrow Bulk Publish Runs invisibly, the Store column must use a single id->installation " +
      "map, and it must not claim an installation is disconnected when the installation list simply failed to load.",
  );

  assert(
    source.includes("{`${installation.slug} — ${resolveInstallationLabel(installation)}`}") &&
      source.includes("{safeText(run.installationId)}") &&
      !/<span className="text-xs text-slate-400">—<\/span>/.test(source),
    "Bulk Publish Runs store options must carry the connector slug (the list spans every connector type), " +
      "and a run whose installation was removed must still show its installation id instead of a generic dash " +
      "(otherwise two removed stores become indistinguishable again).",
  );

  const returnParamsBody = extractFunctionBody(actionsSource, "function operationsJobsReturnParams(");
  const retrySubmissionBody = extractFunctionBody(actionsSource, "export async function retrySubmissionAction(");
  const retryBulkBody = extractFunctionBody(actionsSource, "export async function retryFailedBulkPublishRunAction(");
  assert(
    returnParamsBody.includes('keepToJobs("status", "submissionStatus")') &&
      returnParamsBody.includes('keepToJobs("connectorSlug", "submissionConnector")') &&
      returnParamsBody.includes('keepToJobs("submissionId", "jobsSubmissionId")') &&
      returnParamsBody.includes('keepToJobs("installationId", "installationId")') &&
      retrySubmissionBody.includes("operationsJobsReturnParams(formData)") &&
      retryBulkBody.includes("operationsJobsReturnParams(formData)") &&
      !retryBulkBody.includes('redirect("/operations/jobs")') &&
      !retryBulkBody.includes('handleSessionExpired(error, "/operations/jobs")'),
    "Both Jobs-page retry actions must return the operator to the same filtered view (status, connector, " +
      "selected submission, store) on success, on failure and on session expiry, instead of a bare /operations/jobs.",
  );

  assert(
    /<form action=\{retrySubmissionAction\}>[\s\S]{0,600}name="installationId" value=\{bulkPublishInstallationId\}/.test(source) &&
      /<form action=\{retryFailedBulkPublishRunAction\}>[\s\S]{0,900}name="submissionStatus" value=\{statusFilter\}[\s\S]{0,200}name="submissionConnector" value=\{connectorSlug\}[\s\S]{0,200}name="jobsSubmissionId" value=\{selectedSubmissionId\}[\s\S]{0,200}name="installationId" value=\{bulkPublishInstallationId\}/.test(source),
    "Both retry forms must post the current Jobs view state so the retry actions can restore it.",
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
          "operations_jobs_route_shows_installation_store_per_bulk_publish_run",
          "operations_jobs_route_exposes_installation_filter_when_multiple_stores_exist",
          "operations_jobs_route_disambiguates_store_options_and_removed_installations",
          "operations_jobs_route_degrades_installations_fetch_failures",
          "operations_jobs_route_preserves_store_filter_on_submission_links",
          "operations_jobs_route_never_applies_store_filter_invisibly",
          "operations_jobs_route_retry_actions_preserve_view_state",
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
