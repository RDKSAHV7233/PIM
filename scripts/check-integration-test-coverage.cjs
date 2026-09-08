#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

/**
 * Drift guard for apps/web/test/integration/*.test.cjs coverage bookkeeping.
 *
 * PIM#617 hit a failure mode where apps/api/jest.config.js's hand-maintained
 * `testMatch` allowlist silently drifted from the files actually on disk —
 * new test files went uncounted with nothing in CI to catch it. The web
 * integration suite has no jest glob at all (each file is wired into
 * .github/workflows/ci.yml individually, or is a DB-dependent file wired on
 * its own), so it is exposed to the exact same drift risk, just via a
 * different mechanism: a new .test.cjs file lands and nobody adds it to
 * either bucket below, so it silently never runs anywhere.
 *
 * This script is the CI gate that catches that drift. It maintains two
 * declared buckets:
 *
 *   - DB_DEPENDENT_TESTS: files that need a real Postgres and are wired
 *     individually (see the `backend-tests` job in ci.yml). Kept short and
 *     explicit on purpose — anything DB-dependent must be a conscious,
 *     named decision, never something that falls through by default.
 *   - CI_QUARANTINED_TESTS: DB-free files that currently fail when executed
 *     in the CI-style DB-free runner. They are explicit debt, not silent
 *     exclusions.
 *   - GLOB_COVERED_TESTS: DB-free files run by
 *     scripts/run-web-integration-db-free.cjs in CI.
 *
 * Declaring every file here (rather than trusting a runtime glob) is what
 * gives this check teeth: a new file that isn't added to one bucket fails
 * the build instead of disappearing quietly.
 *
 * Pure filesystem check — no database, no build step, runs in the `build`
 * job. Fails if:
 *   - a `.test.cjs` file exists on disk that isn't declared in either bucket
 *     (drift: someone added a test and forgot to account for it), or
 *   - a bucket lists a file that no longer exists on disk (drift: someone
 *     renamed/deleted a test and left a stale entry behind), or
 *   - the same filename is declared in both buckets (ambiguous ownership).
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const INTEGRATION_DIR = path.join(REPO_ROOT, "apps/web/test/integration");

// Files that connect to a real Postgres. Wired individually into the
// `backend-tests` job (or explicitly pending that wiring — see PIM#754
// sprint notes) rather than assumed safe to run without a database.
const DB_DEPENDENT_TESTS = [
  "auth-cookie-csrf.test.cjs",
  "mfa-login-db-proof.test.cjs",
  "public-signup-web-flow.test.cjs",
];

// DB-free tests that are deliberately NOT part of the runnable CI batch yet
// because the first full PIM#754 execution exposed existing dormant failures.
// Keep this list small, visible, and issue-backed; moving a file out requires
// making it pass under scripts/run-web-integration-db-free.cjs.
const CI_QUARANTINED_TESTS = [
  "admin-commercial-route-contract.test.cjs",
  "admin-oidc-config-route-contract.test.cjs",
  "admin-plan-signup-conversion-ui.test.cjs",
  "catalog-delete-ui.test.cjs",
  "catalog-products-route-contract.test.cjs",
  "dashboard-signup-funnel-ui.test.cjs",
  "internal-ops-summary-ui.test.cjs",
  "mapping-editor-component.test.cjs",
  "pending-feedback-rollout-ui.test.cjs",
  "product-detail-fetch-orchestration.test.cjs",
];

// DB-free tests that are runnable in the CI batch today.
const GLOB_COVERED_TESTS = [
  "account-suspended-route-contract.test.cjs",
  "admin-api-keys-route-contract.test.cjs",
  "admin-audit-route-contract.test.cjs",
  "admin-auth-policy-route-contract.test.cjs",
  "admin-connectors-route-contract.test.cjs",
  "admin-entry-route-contract.test.cjs",
  "admin-form-accessibility.test.cjs",
  "admin-form-errors-a11y.test.cjs",
  "admin-plan-route-contract.test.cjs",
  "admin-plan-signup-export-ui.test.cjs",
  "admin-privacy-ui.test.cjs",
  "admin-users-route-contract.test.cjs",
  "admin-webhooks-route-contract.test.cjs",
  "advanced-responsive-panels.test.cjs",
  "api-base-url-env.test.cjs",
  "api-http-error-guard.test.cjs",
  "apm-vendor-decision.test.cjs",
  "app-dialog-focus-return.test.cjs",
  "app-drawer-a11y.test.cjs",
  "app-sidebar-prefetch-disabled.test.cjs",
  "approval-comments-ui.test.cjs",
  "approval-diff-workspace.test.cjs",
  "approval-evidence-workspace-ui.test.cjs",
  "audit-explorer-ui.test.cjs",
  "auth-recovery-ui.test.cjs",
  "auth-redirect-sanitizer-runtime.test.cjs",
  "auth-redirect-sanitizer.test.cjs",
  "auth-shell-ui.test.cjs",
  "auth-login-upstream-unavailable.test.cjs",
  "auth-suspension-ui.test.cjs",
  "backup-restore-evidence.test.cjs",
  "brand-logo-ui.test.cjs",
  "browser-error-capture.test.cjs",
  "bulk-edit-billing-fallback.test.cjs",
  "bulk-edit-diff-preview-responsive.test.cjs",
  "bulk-edit-status-filter.test.cjs",
  "bulk-import-auto-start-ui.test.cjs",
  "bulk-import-error-resilience.test.cjs",
  "bulk-import-pending-button-ui.test.cjs",
  "bulk-import-preflight-ui.test.cjs",
  "bulk-import-process-action-ui.test.cjs",
  "bulk-import-row-verification-ui.test.cjs",
  "bulk-import-staged-workflow-ui.test.cjs",
  "bulk-import-start-button-ui.test.cjs",
  "bulk-media-association-timeout-ambiguous-outcome.test.cjs",
  "bulk-publish-timeout-ambiguous-outcome.test.cjs",
  "catalog-attribute-actions-cache.test.cjs",
  "catalog-attributes-route-contract.test.cjs",
  "catalog-categories-hydration.test.cjs",
  "catalog-categories-route-contract.test.cjs",
  "catalog-first-shell.test.cjs",
  "channel-connector-detail-route-contract.test.cjs",
  "channel-connector-detail-shopify-ui.test.cjs",
  "channels-connector-catalog-link-route-contract.test.cjs",
  "channels-connector-recovery-route-contract.test.cjs",
  "channels-health-route-contract.test.cjs",
  "channels-mappings-route-contract.test.cjs",
  "channels-overview-route-contract.test.cjs",
  "channels-submission-detail-route-contract.test.cjs",
  "channels-submissions-route-contract.test.cjs",
  "connector-access-admin-form.test.cjs",
  "connector-access-delete-helper.test.cjs",
  "connector-account-health-sync-signal.test.cjs",
  "connector-action-matrix-ui-gating.test.cjs",
  "connector-capability-matrix-ui.test.cjs",
  "connector-claim-consistency.test.cjs",
  "connector-install-form.test.cjs",
  "connector-issue-snapshot-dedupe.test.cjs",
  "connector-launch-honesty-ui.test.cjs",
  "connector-legacy-route-redirects.test.cjs",
  "connector-oauth-initiation-contract.test.cjs",
  "connectors-hub-route-contract.test.cjs",
  "connectors-setup-route-contract.test.cjs",
  "dashboard-api-fallback-ui.test.cjs",
  "dashboard-approval-truth.test.cjs",
  "dashboard-route-contract.test.cjs",
  "env-gate.test.cjs",
  "error-authority-env-contract.test.cjs",
  "error-authority-negative-runtime-proof-route.test.cjs",
  "error-authority-render-runtime-proof-page.test.cjs",
  "error-authority-runtime-proof-route.test.cjs",
  "error-authority-server-action-runtime-proof-page.test.cjs",
  "export-status-completed-label.test.cjs",
  "global-search-ui.test.cjs",
  "handle-session-expired-action-migration.test.cjs",
  "import-preflight-wizard.test.cjs",
  "internal-commercial-ops-ui.test.cjs",
  "internal-ops-errors-ui.test.cjs",
  "internal-surface-gating.test.cjs",
  "issue-inbox-ui.test.cjs",
  "legacy-alias-routes.test.cjs",
  "mapping-account-mismatch-guard.test.cjs",
  "mapping-account-scope-contract.test.cjs",
  "mapping-canonical-ui.test.cjs",
  "mapping-dirty-state-ui.test.cjs",
  "mapping-editor-prop-contract.test.cjs",
  "mapping-lazy-panels.test.cjs",
  "mapping-readiness-version-context-ui.test.cjs",
  "mapping-step-up-ui.test.cjs",
  "mapping-structured-editor.test.cjs",
  "mapping-workflow-ui.test.cjs",
  "marketplace-capability-ui-gating.test.cjs",
  "media-governance-ui.test.cjs",
  "media-route-contract.test.cjs",
  "media-thumbnail-ui.test.cjs",
  "mfa-web-pages-contract.test.cjs",
  "myntra-nykaa-install-form.test.cjs",
  "middleware-server-action-session-expired.test.cjs",
  "next-server-error-capture.test.cjs",
  "no-public-pricing-policy.test.cjs",
  "notification-center-severity-ui.test.cjs",
  "notification-center-ui.test.cjs",
  "notifications-page-route-contract.test.cjs",
  "ondc-route-contract.test.cjs",
  "operations-bulk-edit-route-contract.test.cjs",
  "operations-imports-route-contract.test.cjs",
  "operations-jobs-route-contract.test.cjs",
  "operations-overview-route-contract.test.cjs",
  "operations-repair-route-contract.test.cjs",
  "ops-cockpit-ui.test.cjs",
  "pilot-go-conditions-remediation-ui.test.cjs",
  "plan-comparison-limit-formatting.test.cjs",
  "plan-usage-sku-meter-copy.test.cjs",
  "product-content-taxcodes-approval-guard.test.cjs",
  "product-detail-readiness-batch.test.cjs",
  "product-detail-route-contract.test.cjs",
  "product-detail-workflow-ui.test.cjs",
  "product-dirty-state-ui.test.cjs",
  "product-media-readiness-channel-ineligible-label.test.cjs",
  "product-media-readiness-main-image-url.test.cjs",
  "product-shell-uiux.test.cjs",
  "product-variant-lifecycle-ui.test.cjs",
  "product-workbench-readiness-batch.test.cjs",
  "product-workbench-ui.test.cjs",
  "product-workflow-edit-lock-ui.test.cjs",
  "products-empty-search-state.test.cjs",
  "products-index-route-contract.test.cjs",
  "products-workbench-bulk-publish-selection.test.cjs",
  "public-signup-ui.test.cjs",
  "public-signup-web-flow-readiness-timeout.test.cjs",
  "publish-export-pilot-proof-ui.test.cjs",
  "quality-approvals-route-contract.test.cjs",
  "quality-completeness-route-contract.test.cjs",
  "quality-issues-route-contract.test.cjs",
  "quality-overview-route-contract.test.cjs",
  "quality-reviewer-role-ui.test.cjs",
  "quality-validation-route-contract.test.cjs",
  "railway-web-runtime-contract.test.cjs",
  "rejection-route-contract.test.cjs",
  "resolve-session-expired-redirect.test.cjs",
  "role-aware-frontend-alignment-ui.test.cjs",
  "route-loading-states.test.cjs",
  "search-route-contract.test.cjs",
  "security-mfa-token-cookie.test.cjs",
  "security-webhook-apikey-input.test.cjs",
  "server-session-hardening.test.cjs",
  "settings-pricing-route-contract.test.cjs",
  "shopify-channel-surface.test.cjs",
  "shopify-connector-portfolio-context-ui.test.cjs",
  "shopify-connector-readiness-panel-ui.test.cjs",
  "shopify-managed-install-handoff-ui.test.cjs",
  "taxonomy-search-component.test.cjs",
  "test-data-governance-patterns.test.cjs",
  "timeline-component.test.cjs",
  "validation-issue-panel-responsive.test.cjs",
  "variant-edit-desktop-mobile-form-id-collision.test.cjs",
  "version-manager-component.test.cjs",
  "version-manager-mobile-actions.test.cjs",
  "version-manager-responsive.test.cjs",
  "webhook-deliveries-copy-ui.test.cjs",
  "woocommerce-launch-copy-consistency.test.cjs",
];

function listActualTestFiles(dir = INTEGRATION_DIR) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".test.cjs"))
    .sort();
}

function findDuplicates(list) {
  const seen = new Set();
  const duplicates = new Set();
  for (const entry of list) {
    if (seen.has(entry)) {
      duplicates.add(entry);
    }
    seen.add(entry);
  }
  return Array.from(duplicates).sort();
}

/**
 * @param {string[]} actualFiles  files that currently exist on disk
 * @param {string[]} dbDependent  declared DB_DEPENDENT_TESTS
 * @param {string[]} globCovered  declared GLOB_COVERED_TESTS
 * @param {string[]} quarantined  declared CI_QUARANTINED_TESTS
 */
function evaluateCoverage(actualFiles, dbDependent, globCovered, quarantined = []) {
  const declared = [...dbDependent, ...globCovered, ...quarantined];
  const declaredSet = new Set(declared);
  const actualSet = new Set(actualFiles);

  const uncovered = actualFiles.filter((f) => !declaredSet.has(f)).sort();
  const stale = declared.filter((f) => !actualSet.has(f)).sort();
  const crossBucketDuplicates = findDuplicates(declared).sort();
  const duplicatesWithinBucket = [
    ...findDuplicates(dbDependent),
    ...findDuplicates(globCovered),
    ...findDuplicates(quarantined),
  ].sort();

  const ok =
    uncovered.length === 0 &&
    stale.length === 0 &&
    crossBucketDuplicates.length === 0 &&
    duplicatesWithinBucket.length === 0;

  return { ok, uncovered, stale, crossBucketDuplicates, duplicatesWithinBucket, declaredCount: declared.length };
}

function main() {
  const actualFiles = listActualTestFiles();
  const result = evaluateCoverage(actualFiles, DB_DEPENDENT_TESTS, GLOB_COVERED_TESTS, CI_QUARANTINED_TESTS);

  console.log(
    `[integration-test-coverage] apps/web/test/integration: ${actualFiles.length} file(s) on disk, ${result.declaredCount} declared (${DB_DEPENDENT_TESTS.length} DB-dependent + ${GLOB_COVERED_TESTS.length} CI-runnable DB-free + ${CI_QUARANTINED_TESTS.length} quarantined DB-free).`,
  );

  if (result.ok) {
    console.log("[integration-test-coverage] OK — every file is accounted for, no stale entries.");
    return;
  }

  console.error("[integration-test-coverage] Coverage allowlist has drifted from apps/web/test/integration/:");

  if (result.uncovered.length > 0) {
    console.error(
      `\n- ${result.uncovered.length} file(s) exist on disk but are declared in none of DB_DEPENDENT_TESTS, GLOB_COVERED_TESTS, or CI_QUARANTINED_TESTS:`,
    );
    for (const file of result.uncovered) {
      console.error(`    ${file}`);
    }
    console.error(
      "  Add each to scripts/check-integration-test-coverage.cjs — GLOB_COVERED_TESTS if it runs in the DB-free CI batch, DB_DEPENDENT_TESTS if it needs a real Postgres, or CI_QUARANTINED_TESTS only with issue-backed failing evidence.",
    );
  }

  if (result.stale.length > 0) {
    console.error(`\n- ${result.stale.length} declared file(s) no longer exist on disk (stale entries):`);
    for (const file of result.stale) {
      console.error(`    ${file}`);
    }
    console.error("  Remove them from scripts/check-integration-test-coverage.cjs.");
  }

  if (result.crossBucketDuplicates.length > 0) {
    console.error(`\n- ${result.crossBucketDuplicates.length} file(s) declared in multiple buckets:`);
    for (const file of result.crossBucketDuplicates) {
      console.error(`    ${file}`);
    }
    console.error("  A file must have exactly one owner bucket.");
  }

  if (result.duplicatesWithinBucket.length > 0) {
    console.error(`\n- ${result.duplicatesWithinBucket.length} file(s) listed more than once in the same bucket:`);
    for (const file of result.duplicatesWithinBucket) {
      console.error(`    ${file}`);
    }
  }

  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  DB_DEPENDENT_TESTS,
  CI_QUARANTINED_TESTS,
  GLOB_COVERED_TESTS,
  evaluateCoverage,
  findDuplicates,
  listActualTestFiles,
};
