#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "quality", "validation", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");

  assert(
    source.includes("await getServerSession();"),
    "Validation page must derive shared auth/session context from the server helpers.",
  );
  assert(
    source.includes('type SharedReadState = "available" | "restricted" | "unavailable";') &&
      source.includes("async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>>") &&
      source.includes("const [healthResult, inboxResult] = await Promise.all([") &&
      source.includes("loadSharedRead(getDashboardHealth({ role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getIssueInbox({ limit: 50 }, { role: actorRole, authHeader }))"),
    "Validation page must load health and issue inbox reads through explicit shared-read wrappers.",
  );
  assert(
    source.includes("Some validation data is temporarily unavailable") &&
      source.includes("Some validation data is restricted") &&
      source.includes("Blocking validation totals are limited for your role.") &&
      source.includes("Warning totals are temporarily unavailable.") &&
      source.includes("Issue-resolution totals are limited for your role."),
    "Validation page must distinguish restricted and unavailable validation metrics instead of defaulting to healthy totals.",
  );
  assert(
    source.includes('label="Blocking Issues"') &&
      source.includes('label="Warnings"') &&
      source.includes('label="Validation Scope"') &&
      source.includes('label="Resolved Today"') &&
      source.includes('label={validationState === "restricted" ? "Blocking restricted" : "Blocking unavailable"}'),
    "Validation page must preserve the core KPI and severity-lane contract while exposing degraded states honestly.",
  );
  assert(
    source.includes('href="/quality/issues?severity=BLOCKING"') &&
      source.includes('href="/quality/issues?severity=WARNING"') &&
      source.includes('href="/catalog/products"'),
    "Validation page must keep the primary drilldown links for issue and product follow-up.",
  );
  assert(
    source.includes('if (error instanceof ApiHttpError && error.status === 401)') &&
      source.includes('redirect(buildLoginRedirect("/quality/validation", error));'),
    "Validation page must redirect only expired sessions while preserving restricted shared-read states in-page.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "quality_validation_route_uses_shared_server_auth_context",
          "quality_validation_route_fetches_health_and_inbox_with_explicit_shared_read_states",
          "quality_validation_route_distinguishes_restricted_and_unavailable_metrics",
          "quality_validation_route_preserves_core_validation_kpis_and_drilldowns",
          "quality_validation_route_redirects_only_expired_sessions",
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
  console.error("Quality validation route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
