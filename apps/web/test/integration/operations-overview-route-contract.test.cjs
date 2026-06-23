#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const OPERATIONS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "operations", "page.tsx");
const ROLE_CAPABILITIES = path.join(REPO_ROOT, "apps", "web", "src", "lib", "role-capabilities.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(OPERATIONS_PAGE, "utf8");
  const roleCapabilitiesSource = fs.readFileSync(ROLE_CAPABILITIES, "utf8");

  assert(
      source.includes("await getServerSession();"),
    "Operations overview must derive shared auth/session context from the server helpers.",
  );
  assert(
    source.includes('type SharedReadState = "available" | "restricted" | "unavailable";') &&
      source.includes("async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>>") &&
      source.includes("const [importsResult, submissionsResult, deadLetterResult] = await Promise.all([") &&
      source.includes("loadSharedRead(getBulkImportJobs({ role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getSubmissions({ limit: submissionWindowLimit }, { role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getDeadLetterSubmissions({ limit: deadLetterWindowLimit }, { role: actorRole, authHeader }))"),
    "Operations overview must wrap import, submission, and dead-letter reads so restricted and unavailable states stay explicit.",
  );
  assert(
    source.includes("function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[]") &&
      source.includes('label="Import Jobs"') &&
      source.includes('label="Submission Jobs"') &&
      source.includes('label="Dead Letter Queue"') &&
      source.includes('label={canRunWriteOperations ? "Bulk Edit Control" : "Bulk Edit Review"}'),
    "Operations overview must normalize list payload shapes and derive core operations KPIs from live import, submission, and dead-letter data.",
  );
  assert(
    source.includes("Some operations data is temporarily unavailable") &&
      source.includes("Some operations data is restricted") &&
      source.includes("Import totals are limited for your role.") &&
      source.includes("Submission queue totals are temporarily unavailable.") &&
      source.includes("Repair queue totals are limited for your role.") &&
      source.includes('href={importsResult.state === "available" ? "/operations/imports" : undefined}') &&
      source.includes('href={submissionsResult.state === "available" ? "/operations/jobs" : undefined}') &&
      source.includes('href={deadLetterResult.state === "available" ? "/operations/repair" : undefined}'),
    "Operations overview must render explicit restricted and unavailable queue states and avoid drilldown KPI links when truth is not authoritative.",
  );
  assert(
    roleCapabilitiesSource.includes('return role === "admin" || role === "editor";') &&
      source.includes("const canRunWriteOperations = canEditWorkspace(actorRole);") &&
      source.includes("Workspace editors and admins start new imports.") &&
      source.includes("Workspace editors and admins apply mass changes.") &&
      source.includes("Workspace editors and admins complete guided recovery.") &&
      source.includes('{canRunWriteOperations ? "Open Bulk Edit" : "Review Bulk Edit"}'),
    "Operations overview must describe write-capable workflows honestly for roles that can only review operations state.",
  );
  assert(
    source.includes('href="/operations/imports"') &&
      source.includes('href="/operations/bulk-edit"') &&
      source.includes('href="/operations/jobs"') &&
      source.includes('href="/operations/repair"'),
    "Operations overview must deep-link operators into imports, bulk edit, jobs, and repair workspaces.",
  );
  assert(
    source.includes('if (error instanceof ApiHttpError && error.status === 401)') &&
      source.includes('redirect(buildLoginRedirect("/operations", error));'),
    "Operations overview must redirect only expired sessions while preserving restricted shared-read states in-page.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "operations_overview_route_uses_shared_server_auth_context",
          "operations_overview_route_fetches_imports_submissions_and_dead_letter_with_explicit_shared_read_states",
          "operations_overview_route_derives_live_operations_kpis",
          "operations_overview_route_distinguishes_restricted_and_unavailable_truth",
          "operations_overview_route_adjusts_write_workflow_copy_for_read_only_roles",
          "operations_overview_route_links_to_core_operations_workspaces",
          "operations_overview_route_redirects_only_expired_sessions",
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
  console.error("Operations overview route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
