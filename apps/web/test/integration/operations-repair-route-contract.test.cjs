#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "operations", "repair", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");

  assert(
    source.includes("const authHeader = await getServerAuthHeader();") &&
      source.includes("const actorRole = await getServerActorRole();"),
    "Operations repair must derive shared server auth/session context.",
  );
  assert(
    source.includes("const [importJobs, deadLetterRaw] = await Promise.all([") &&
      source.includes("getBulkImportJobs({ role: actorRole, authHeader })") &&
      source.includes("getDeadLetterSubmissions({ limit: 100 }, { role: actorRole, authHeader })"),
    "Operations repair must fetch import backlog and dead-letter submissions together from the shared auth context.",
  );
  assert(
    source.includes("function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[]") &&
      source.includes("return Array.isArray(value.items) ? value.items : [];"),
    "Operations repair must normalize dead-letter list payloads through the shared toItems helper.",
  );
  assert(
    source.includes('const failedImports = importJobs.filter((job) => job.deadLetterRows > 0 || job.failedRows > 0);') &&
      source.includes("const deadLetterRows = failedImports.reduce((sum, job) => sum + job.deadLetterRows, 0);") &&
      source.includes("const failedRows = failedImports.reduce((sum, job) => sum + job.failedRows, 0);"),
    "Operations repair must derive import repair backlog and row counts from live import job failure fields.",
  );
  assert(
    source.includes('label="Import Jobs Requiring Repair"') &&
      source.includes('label="Import Dead-Letter Rows"') &&
      source.includes('label="Import Failed Rows"') &&
      source.includes('label="Submission Dead Letter Queue"'),
    "Operations repair must surface KPI cards for both import-repair and submission dead-letter backlog.",
  );
  assert(
    source.includes("Repair playbook") &&
      source.includes("Fix source data first") &&
      source.includes("Retry delivery only when ready") &&
      source.includes("Escalate repeated dead letter") &&
      source.includes("that usually points to connector configuration or receiver-side drift."),
    "Operations repair must guide operators through a clear repair workflow, not just expose backlog counts and links.",
  );
  assert(
    source.includes('href="/operations/imports"') &&
      source.includes('href="/operations/jobs"') &&
      source.includes('href={`/operations/imports?bulkJobId=${encodeURIComponent(job.id)}`}') &&
      source.includes('Open in Jobs'),
    "Operations repair must deep-link operators into imports and jobs, including scoped repair links for failed import jobs.",
  );
  assert(
    source.includes('No import repair backlog.') &&
      source.includes('No dead-letter submission backlog.'),
    "Operations repair must surface honest empty states for both repair queues.",
  );
  assert(
    source.includes('StatusChip label={`${job.deadLetterRows} dead letter`} tone={job.deadLetterRows > 0 ? "danger" : "warning"}') &&
      source.includes('StatusChip label={translateJobStatus(submission.status)} tone="warning"') &&
      source.includes('submission.failureReason ?? submission.dlqReason ?? "No reason recorded"'),
    "Operations repair must expose meaningful status chips and failure reasons for both import and submission repair queues.",
  );
  assert(
    source.includes('redirect(buildLoginRedirect("/operations/repair", error));'),
    "Operations repair must redirect expired or forbidden sessions through the shared login helper.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "operations_repair_route_uses_shared_server_auth_context",
          "operations_repair_route_fetches_import_and_dead_letter_backlog_in_parallel",
          "operations_repair_route_normalizes_dead_letter_payload_shape",
          "operations_repair_route_derives_import_backlog_counts",
          "operations_repair_route_surfaces_core_repair_kpis",
          "operations_repair_route_guides_repair_workflow",
          "operations_repair_route_links_to_scoped_import_and_jobs_workspaces",
          "operations_repair_route_surfaces_honest_empty_states",
          "operations_repair_route_exposes_status_and_failure_reasons",
          "operations_repair_route_redirects_auth_failures",
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
  console.error("Operations repair route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
