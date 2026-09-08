#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const assert = require("node:assert/strict");

const {
  LARGE_PR_APPROVAL_LABEL,
  REQUIRED_TEAM_APPROVAL_LABEL,
  classifyDomains,
  evaluateGovernance,
  evaluateScope,
  hasAddedControllerMutationDecorator,
  hasLargePrApproval,
  hasRequiredTeamApproval,
  isAuthOrSessionBoundaryPath,
  isConnectorCredentialPath,
  isRequiredTeamReviewPath,
  isShopifyConnectorPath,
  isWooCommerceConnectorPath,
  parseNumstat,
  summarizeScope,
} = require("./check-pr-scope.cjs");

function buildEntries(count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    additions: 20,
    deletions: 5,
    file: `${prefix}/file-${index}.ts`,
  }));
}

function main() {
  assert.deepEqual(parseNumstat("10\t2\tapps/api/src/auth/auth.service.ts\n-\t-\tassets/logo.png\n"), [
    { additions: 10, deletions: 2, file: "apps/api/src/auth/auth.service.ts" },
    { additions: 0, deletions: 0, file: "assets/logo.png" },
  ]);

  assert.deepEqual(
    classifyDomains([
      ".github/workflows/ci.yml",
      "apps/api/src/auth/auth.service.ts",
      "apps/api/test/integration/auth-login-lockout.test.cjs",
      "apps/web/src/middleware.ts",
      "docs/release.md",
    ]),
    ["api-auth", "api-tests", "ci", "docs", "web"],
  );

  const focusedSummary = summarizeScope(buildEntries(10, "apps/api/src/catalog"));
  assert.deepEqual(evaluateScope(focusedSummary, false), {
    approved: false,
    ok: true,
    reasons: [],
  });

  const oversizedEntries = [
    ...buildEntries(12, "apps/api/src/auth"),
    ...buildEntries(12, "apps/api/test/integration"),
    ...buildEntries(12, "apps/web/src"),
  ];
  const oversizedSummary = summarizeScope(oversizedEntries);
  const rejected = evaluateScope(oversizedSummary, false);
  assert.equal(rejected.ok, false);
  assert.match(rejected.reasons.join("\n"), /risk domains/);
  assert.equal(evaluateScope(oversizedSummary, true).ok, true);

  const lineHeavySummary = summarizeScope([{ additions: 2600, deletions: 1, file: "apps/api/src/catalog/catalog.service.ts" }]);
  assert.match(evaluateScope(lineHeavySummary, false).reasons.join("\n"), /2500-line review bound/);

  const generatedSummary = summarizeScope([
    { additions: 100, deletions: 10, file: "scripts/generate-postman-collection.cjs" },
    { additions: 9000, deletions: 200, file: "docs/openapi.json" },
    { additions: 6000, deletions: 100, file: "docs/openapi.yaml" },
    { additions: 8000, deletions: 0, file: "docs/vexa-pim.postman_collection.json" },
  ]);
  assert.equal(generatedSummary.changedLines, 110, "only non-generated lines counted");
  assert.equal(generatedSummary.generatedFilesExcluded, 3, "3 generated files excluded");
  assert.equal(generatedSummary.changedFiles, 4, "all files still counted for file limit");
  assert.equal(evaluateScope(generatedSummary, false).ok, true, "passes with generated files excluded");

  assert.equal(hasLargePrApproval([LARGE_PR_APPROVAL_LABEL], {}), true);
  assert.equal(hasLargePrApproval([], { PR_SCOPE_ALLOW_LARGE: "true" }), true);
  assert.equal(hasLargePrApproval([], {}), false);

  assert.equal(isAuthOrSessionBoundaryPath("apps/api/src/auth/jwt-auth.guard.ts"), true);
  assert.equal(isAuthOrSessionBoundaryPath("apps/api/test/integration/auth-revocation.test.cjs"), true);
  assert.equal(isWooCommerceConnectorPath("apps/api/src/connectors/woocommerce/woocommerce.service.ts"), true);
  assert.equal(isShopifyConnectorPath("apps/api/src/connectors/shopify/shopify.connector.ts"), true);
  assert.equal(isShopifyConnectorPath("apps/api/test/integration/shopify-runtime-foundation.test.cjs"), true);
  assert.equal(isConnectorCredentialPath("apps/api/src/connectors/shopify/shopify.connector.ts"), true);
  assert.equal(isConnectorCredentialPath("apps/api/src/connectors/woocommerce/woocommerce.connector.ts"), true);
  assert.equal(isConnectorCredentialPath("apps/api/src/catalog/catalog.service.ts"), false);
  assert.equal(isRequiredTeamReviewPath("apps/api/src/connectors/shopify/shopify.connector.ts"), true);
  assert.equal(isRequiredTeamReviewPath("packages/db/prisma/migrations/20260906000000_change/migration.sql"), true);
  assert.equal(isRequiredTeamReviewPath("apps/api/src/catalog/catalog.service.ts"), false);
  assert.equal(
    hasAddedControllerMutationDecorator({
      file: "apps/api/src/error-authority/error-authority-ops.controller.ts",
      patch: '+  @Post(":issueId/resolve")\n+  resolveIssue() {}',
    }),
    true,
    "new API controller mutation decorators are required-team governance surfaces",
  );
  assert.equal(
    hasAddedControllerMutationDecorator({
      file: "apps/api/src/error-authority/error-authority-ops.controller.ts",
      patch: '+  @Get(":issueId")\n+  getIssue() {}',
    }),
    false,
    "read-only controller routes do not trigger mutation-surface governance",
  );
  assert.equal(
    hasAddedControllerMutationDecorator({
      file: "apps/api/test/integration/error-authority-ops.test.cjs",
      patch: '+  @Post(":issueId/resolve")',
    }),
    false,
    "test files containing decorator text do not trigger source-controller governance",
  );

  const authOnlyEntries = [
    { additions: 20, deletions: 5, file: "apps/api/src/auth/jwt-auth.guard.ts" },
  ];
  const authMissingApproval = evaluateGovernance(authOnlyEntries, [], {});
  assert.equal(authMissingApproval.ok, false);
  assert.match(authMissingApproval.reasons.join("\n"), /required-team file/);
  assert.equal(
    evaluateGovernance(authOnlyEntries, [REQUIRED_TEAM_APPROVAL_LABEL], {}).ok,
    true,
    "required-team label approves focused high-risk paths",
  );
  assert.equal(
    hasRequiredTeamApproval([], { PR_SCOPE_ALLOW_REQUIRED_TEAM: "true" }),
    true,
    "explicit env override is available for protected emergency workflows",
  );

  const mixedConnectorAndAuth = evaluateGovernance(
    [
      { additions: 12, deletions: 4, file: "apps/api/src/connectors/woocommerce/woocommerce-publisher.service.ts" },
      { additions: 8, deletions: 2, file: "apps/api/src/auth/token-blocklist.service.ts" },
    ],
    [LARGE_PR_APPROVAL_LABEL, REQUIRED_TEAM_APPROVAL_LABEL],
    {},
  );
  assert.equal(mixedConnectorAndAuth.ok, false, "large and required-team labels do not bypass split rule");
  assert.match(mixedConnectorAndAuth.reasons.join("\n"), /must be split/);

  const mixedShopifyAndAuth = evaluateGovernance(
    [
      { additions: 12, deletions: 4, file: "apps/api/src/connectors/shopify/shopify.connector.ts" },
      { additions: 8, deletions: 2, file: "apps/api/src/auth/token-blocklist.service.ts" },
    ],
    [LARGE_PR_APPROVAL_LABEL, REQUIRED_TEAM_APPROVAL_LABEL],
    {},
  );
  assert.equal(mixedShopifyAndAuth.ok, false, "split rule also covers Shopify, not just WooCommerce");
  assert.match(mixedShopifyAndAuth.reasons.join("\n"), /must be split/);

  const shopifyOnlyEntries = [
    { additions: 20, deletions: 5, file: "apps/api/src/connectors/shopify/shopify.connector.ts" },
  ];
  const shopifyMissingApproval = evaluateGovernance(shopifyOnlyEntries, [], {});
  assert.equal(shopifyMissingApproval.ok, false, "Shopify connector changes require the label, same as WooCommerce");
  assert.match(shopifyMissingApproval.reasons.join("\n"), /required-team file/);
  assert.equal(
    evaluateGovernance(shopifyOnlyEntries, [REQUIRED_TEAM_APPROVAL_LABEL], {}).ok,
    true,
    "required-team label approves focused Shopify connector changes",
  );

  const mutationEndpointEntries = [
    {
      additions: 12,
      deletions: 0,
      file: "apps/api/src/error-authority/error-authority-ops.controller.ts",
      patch: '+  @Post(":issueId/resolve")\n+  async resolveIssue() {}',
    },
  ];
  const mutationMissingApproval = evaluateGovernance(mutationEndpointEntries, [], {});
  assert.equal(mutationMissingApproval.ok, false, "new API mutation endpoints require required-team approval");
  assert.deepEqual(mutationMissingApproval.requiredTeamFiles, [
    "apps/api/src/error-authority/error-authority-ops.controller.ts",
  ]);
  assert.match(mutationMissingApproval.reasons.join("\n"), /required-team file/);
  assert.equal(
    evaluateGovernance(mutationEndpointEntries, [REQUIRED_TEAM_APPROVAL_LABEL], {}).ok,
    true,
    "required-team label approves focused new API mutation endpoints",
  );

  assert.equal(
    evaluateGovernance([{ additions: 5, deletions: 1, file: "apps/web/src/app/dashboard/page.tsx" }], [], {}).ok,
    true,
    "ordinary focused product work is unaffected",
  );

  console.log("check-pr-scope.test.cjs: PASS");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
