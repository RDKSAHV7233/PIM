#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");

const STEPS = [
  { label: "API lint", command: "npm", args: ["run", "lint", "--workspace", "@pim1/api"] },
  { label: "API build", command: "npm", args: ["run", "build", "--workspace", "@pim1/api"] },
  { label: "Web lint", command: "npm", args: ["run", "lint", "--workspace", "@pim1/web"] },
  { label: "Web build", command: "npm", args: ["run", "build", "--workspace", "@pim1/web"] },
  { label: "API build (post-web)", command: "npm", args: ["run", "build", "--workspace", "@pim1/api"] },
  {
    // Env-validation suite: proves that the API process refuses to start under
    // invalid or insecure env configurations (short JWT_SECRET, wrong
    // QUEUE_BACKEND in staging, missing commercial-ops token, etc.).
    // Runs early so a bad env config doesn't silently pass other gates.
    label: "Integration: env validation",
    command: "npm",
    args: ["run", "test:integration:env-validation"],
    retries: 1,
  },
  {
    label: "Integration: bulk edit empty scope",
    command: "npm",
    args: ["run", "test:integration:bulk-edit-empty-scope"],
    retries: 1,
  },
  {
    label: "Integration: catalog completeness",
    command: "npm",
    args: ["run", "test:integration:catalog-completeness"],
    retries: 1,
  },
  {
    label: "Integration: mapping manager",
    command: "npm",
    args: ["run", "test:integration:mapping-manager"],
    retries: 1,
  },
  {
    label: "Integration: media SSRF guard",
    command: "npm",
    args: ["run", "test:integration:media-ssrf-guard"],
    retries: 1,
  },
  {
    label: "Integration: bulk import tenant boundary",
    command: "npm",
    args: ["run", "test:integration:bulk-import-tenant-boundary"],
    retries: 1,
  },
  {
    label: "Integration: marketplace capability gating",
    command: "npm",
    args: ["run", "test:integration:marketplace-capability-gating"],
    retries: 1,
  },
  {
    label: "Integration: connector idempotency",
    command: "npm",
    args: ["run", "test:integration:connector-idempotency-semantics"],
    retries: 1,
  },
  {
    label: "Integration: webhook dedupe scope",
    command: "npm",
    args: ["run", "test:integration:webhook-dedupe-scope"],
    retries: 1,
  },
  {
    label: "Integration: tenant isolation",
    command: "npm",
    args: ["run", "test:integration:rls-isolation"],
    retries: 1,
  },
  {
    label: "Integration: rejection notification",
    command: "npm",
    args: ["run", "test:integration:rejection-notification"],
    retries: 1,
  },
  {
    label: "Integration: metrics KPI trends",
    command: "npm",
    args: ["run", "test:integration:metrics-kpi-trends"],
    retries: 1,
  },
  {
    label: "Integration: dashboard aggregations",
    command: "npm",
    args: ["run", "test:integration:dashboard-aggregations"],
    retries: 1,
  },
  {
    label: "Integration: product workflow transitions",
    command: "npm",
    args: ["run", "test:integration:product-workflow-transitions"],
    retries: 1,
  },
  {
    label: "Integration: access-policy remediation",
    command: "npm",
    args: ["run", "test:integration:access-policy-remediation"],
    retries: 1,
  },
  {
    label: "Integration: delegated access scopes",
    command: "npm",
    args: ["run", "test:integration:delegated-access-scopes"],
    retries: 1,
  },
  {
    // ApprovalComment contract — model + API surfaced post-V3 PO sign-off (2026-05-06).
    // Required to continuously verify the V4-approved claim that approval comments are proven.
    label: "Integration: approval comments contract",
    command: "npm",
    args: ["run", "test:integration:approval-comments"],
    retries: 1,
  },
  {
    // Product activity timeline — AuditLog-sourced; sits behind the index added by migration
    // 20260517000002_auditlog_resource_action_index. ADR-013 references this query path.
    label: "Integration: product activity timeline",
    command: "npm",
    args: ["run", "test:integration:product-activity-timeline"],
    retries: 1,
  },
  {
    // OIDC IdP-config step-up auth — runtime proof that StepUpGuard with the
    // auth_config_high_risk scope correctly gates POST/DELETE /auth/oidc-config,
    // rejects scope-mismatched tokens with 403, and does not gate the GET endpoint.
    // Complements the static admin-oidc-config-route-contract.test.cjs web test.
    label: "Integration: OIDC config step-up",
    command: "npm",
    args: ["run", "test:integration:auth-oidc-config-step-up"],
    retries: 1,
  },
  {
    // Meesho connector runtime foundation — proves local validation rules,
    // xlsx export magic bytes, and error normalisation work against compiled dist.
    // No DB needed; runs entirely against apps/api/dist/.
    label: "Integration: Meesho runtime foundation",
    command: "npm",
    args: ["run", "test:integration:meesho-runtime-foundation"],
    retries: 1,
  },
  {
    // Product relationships (INC-40 RG-C4) — bundles, kits, cross-sell links.
    // Tests CRUD lifecycle and tenant isolation for product_relationships table.
    label: "Integration: product relationships",
    command: "npm",
    args: ["run", "test:integration:product-relationships"],
    retries: 1,
  },
  {
    // Workflow collaboration + SLA (RG-C5) — change requests, SLA config,
    // overdue count. Tests multi-role enforcement and cross-tenant isolation.
    label: "Integration: workflow collaboration SLA",
    command: "npm",
    args: ["run", "test:integration:workflow-collaboration-sla"],
    retries: 1,
  },
  // ── Phase 2 gate promotions ──────────────────────────────────────────────
  // Auth security cluster — if session/token primitives are broken,
  // later auth-dependent tests give misleading failures; gate early.
  {
    label: "Integration: auth token revocation",
    command: "npm",
    args: ["run", "test:integration:auth-revocation"],
    retries: 1,
  },
  {
    label: "Integration: JWT blocklist contract",
    command: "npm",
    args: ["run", "test:integration:jwt-blocklist-contract"],
    retries: 1,
  },
  {
    label: "Integration: MFA login contract",
    command: "npm",
    args: ["run", "test:integration:auth-mfa-login-contract"],
    retries: 1,
  },
  {
    label: "Integration: auth login lockout",
    command: "npm",
    args: ["run", "test:integration:auth-login-lockout"],
    retries: 1,
  },
  {
    label: "Integration: auth password reset",
    command: "npm",
    args: ["run", "test:integration:auth-password-reset"],
    retries: 1,
  },
  {
    label: "Integration: MFA enrollment",
    command: "npm",
    args: ["run", "test:integration:mfa-enrollment"],
    retries: 1,
  },
  // Tenant boundary cluster
  {
    label: "Integration: variant tenant uniqueness",
    command: "npm",
    args: ["run", "test:integration:variant-tenant-uniqueness"],
    retries: 1,
  },
  {
    label: "Integration: category tenant uniqueness",
    command: "npm",
    args: ["run", "test:integration:category-tenant-uniqueness"],
    retries: 1,
  },
  // Core infrastructure
  {
    label: "Integration: credential rotation",
    command: "npm",
    args: ["run", "test:integration:credential-rotation"],
    retries: 1,
  },
  {
    label: "Integration: cursor pagination",
    command: "npm",
    args: ["run", "test:integration:cursor-pagination"],
    retries: 1,
  },
  {
    label: "Integration: outbound webhooks",
    command: "npm",
    args: ["run", "test:integration:outbound-webhooks"],
    retries: 1,
  },
  // Connector and marketplace
  {
    label: "Integration: connector capability orchestration",
    command: "npm",
    args: ["run", "test:integration:connector-capability-orchestration"],
    retries: 1,
  },
  {
    label: "Integration: connector issue contract",
    command: "npm",
    args: ["run", "test:integration:connector-issue-contract"],
    retries: 1,
  },
  {
    label: "Integration: submission lifecycle API",
    command: "npm",
    args: ["run", "test:integration:submission-lifecycle-api"],
    retries: 1,
  },
  // ── Phase 3 gate promotions ──────────────────────────────────────────────
  // Public auth and user lifecycle — onboarding path must not regress silently.
  {
    label: "Integration: public signup",
    command: "npm",
    args: ["run", "test:integration:public-signup"],
    retries: 1,
  },
  {
    label: "Integration: web public signup flow",
    command: "npm",
    args: ["run", "test:integration:web-public-signup"],
    retries: 1,
  },
  {
    label: "Integration: auth legacy hash migration",
    command: "npm",
    args: ["run", "test:integration:auth-legacy-hash-migration"],
    retries: 1,
  },
  {
    label: "Integration: workspace user CRUD",
    command: "npm",
    args: ["run", "test:integration:workspace-user-crud"],
    retries: 1,
  },
  {
    label: "Integration: auth account privacy",
    command: "npm",
    args: ["run", "test:integration:auth-account-privacy"],
    retries: 1,
  },
  {
    label: "Integration: auth account privacy authz",
    command: "npm",
    args: ["run", "test:integration:auth-account-privacy-authz"],
    retries: 1,
  },
  // Audit and governance
  {
    label: "Integration: audit actor context",
    command: "npm",
    args: ["run", "test:integration:audit-actor-context"],
    retries: 1,
  },
  {
    label: "Integration: payload governance policy",
    command: "npm",
    args: ["run", "test:integration:payload-governance-policy"],
    retries: 1,
  },
  // API surface
  {
    label: "Integration: API keys",
    command: "npm",
    args: ["run", "test:integration:api-keys"],
    retries: 1,
  },
  {
    label: "Integration: connector mapping lifecycle",
    command: "npm",
    args: ["run", "test:integration:connector-mapping-lifecycle"],
    retries: 1,
  },
  // Billing / commercial tier enforcement
  {
    label: "Integration: billing commercial control",
    command: "npm",
    args: ["run", "test:integration:billing-commercial-control"],
    retries: 1,
  },
  {
    label: "Integration: billing upgrade request",
    command: "npm",
    args: ["run", "test:integration:billing-upgrade-request"],
    retries: 1,
  },
  {
    label: "Integration: billing commercial notifications",
    command: "npm",
    args: ["run", "test:integration:billing-commercial-notifications"],
    retries: 1,
  },
  {
    label: "Integration: billing commercial tenant search",
    command: "npm",
    args: ["run", "test:integration:billing-commercial-tenant-search"],
    retries: 1,
  },
  {
    label: "Integration: billing commercial suspension",
    command: "npm",
    args: ["run", "test:integration:billing-commercial-suspension"],
    retries: 1,
  },
  {
    label: "Integration: billing commercial side effects",
    command: "npm",
    args: ["run", "test:integration:billing-commercial-side-effects"],
    retries: 1,
  },
  {
    label: "Integration: billing commercial marketplace suspension",
    command: "npm",
    args: ["run", "test:integration:billing-commercial-marketplace-suspension"],
    retries: 1,
  },
  // Infrastructure reliability
  {
    label: "Integration: bulk import preflight",
    command: "npm",
    args: ["run", "test:integration:bulk-import-preflight"],
    retries: 1,
  },
  {
    label: "Integration: worker backpressure",
    command: "npm",
    args: ["run", "test:integration:worker-backpressure"],
    retries: 1,
  },
  {
    label: "Integration: queue durability",
    command: "npm",
    args: ["run", "test:integration:queue-durability"],
    retries: 1,
  },
  // Connector marketplace
  {
    label: "Integration: Flipkart token expiry alerting",
    command: "npm",
    args: ["run", "test:integration:flipkart-token-expiry-alerting"],
    retries: 1,
  },
  {
    label: "Integration: marketplace readiness batch",
    command: "npm",
    args: ["run", "test:integration:marketplace-readiness-batch"],
    retries: 1,
  },
  // ── Phase 4: web route-contract static checks ────────────────────────────
  // These are pure filesystem assertions (no server, no DB) so they run fast
  // and act as a cheap early-exit if a Next.js page loses a required import.
  // Admin routes
  {
    label: "Contract: admin entry routes",
    command: "npm",
    args: ["run", "test:integration:admin-entry-route-contract"],
    retries: 0,
  },
  {
    label: "Contract: admin users routes",
    command: "npm",
    args: ["run", "test:integration:admin-users-route-contract"],
    retries: 0,
  },
  {
    label: "Contract: admin connectors routes",
    command: "npm",
    args: ["run", "test:integration:admin-connectors-route-contract"],
    retries: 0,
  },
  {
    label: "Contract: admin API keys routes",
    command: "npm",
    args: ["run", "test:integration:admin-api-keys-route-contract"],
    retries: 0,
  },
  {
    label: "Contract: admin webhooks routes",
    command: "npm",
    args: ["run", "test:integration:admin-webhooks-route-contract"],
    retries: 0,
  },
  // Dashboard + billing admin UI
  {
    label: "Contract: dashboard route",
    command: "npm",
    args: ["run", "test:integration:dashboard-route-contract"],
    retries: 0,
  },
  {
    label: "Contract: dashboard signup funnel UI",
    command: "npm",
    args: ["run", "test:integration:dashboard-signup-funnel-ui"],
    retries: 0,
  },
  {
    label: "Contract: admin plan signup conversion UI",
    command: "npm",
    args: ["run", "test:integration:admin-plan-signup-conversion-ui"],
    retries: 0,
  },
  {
    label: "Contract: admin plan signup export UI",
    command: "npm",
    args: ["run", "test:integration:admin-plan-signup-export-ui"],
    retries: 0,
  },
  // Quality routes
  {
    label: "Contract: quality overview route",
    command: "npm",
    args: ["run", "test:integration:quality-overview-route-contract"],
    retries: 0,
  },
  {
    label: "Contract: quality approvals route",
    command: "npm",
    args: ["run", "test:integration:quality-approvals-route-contract"],
    retries: 0,
  },
  {
    label: "Contract: quality issues route",
    command: "npm",
    args: ["run", "test:integration:quality-issues-route-contract"],
    retries: 0,
  },
  // Channels routes
  {
    label: "Contract: channels overview route",
    command: "npm",
    args: ["run", "test:integration:channels-overview-route-contract"],
    retries: 0,
  },
  {
    label: "Contract: channels health route",
    command: "npm",
    args: ["run", "test:integration:channels-health-route-contract"],
    retries: 0,
  },
  {
    label: "Contract: channels submissions route",
    command: "npm",
    args: ["run", "test:integration:channels-submissions-route-contract"],
    retries: 0,
  },
  {
    label: "Contract: channel connector detail route",
    command: "npm",
    args: ["run", "test:integration:channel-connector-detail-route-contract"],
    retries: 0,
  },
  // Operations routes
  {
    label: "Contract: operations imports route",
    command: "npm",
    args: ["run", "test:integration:operations-imports-route-contract"],
    retries: 0,
  },
  {
    label: "Contract: operations overview route",
    command: "npm",
    args: ["run", "test:integration:operations-overview-route-contract"],
    retries: 0,
  },
  {
    label: "Contract: operations jobs route",
    command: "npm",
    args: ["run", "test:integration:operations-jobs-route-contract"],
    retries: 0,
  },
  {
    label: "Contract: operations bulk edit route",
    command: "npm",
    args: ["run", "test:integration:operations-bulk-edit-route-contract"],
    retries: 0,
  },
  {
    label: "Contract: operations repair route",
    command: "npm",
    args: ["run", "test:integration:operations-repair-route-contract"],
    retries: 0,
  },
  // Catalog routes
  {
    label: "Contract: catalog products route",
    command: "npm",
    args: ["run", "test:integration:catalog-products-route-contract"],
    retries: 0,
  },
  {
    label: "Contract: product detail route",
    command: "npm",
    args: ["run", "test:integration:product-detail-route-contract"],
    retries: 0,
  },
  // URL compatibility
  {
    label: "Contract: legacy alias routes",
    command: "npm",
    args: ["run", "test:integration:legacy-alias-routes"],
    retries: 0,
  },
  // Internal commercial ops
  {
    label: "Contract: internal commercial ops UI",
    command: "npm",
    args: ["run", "test:integration:internal-commercial-ops-ui"],
    retries: 0,
  },
  // ── Phase 5: final API/integration suites ────────────────────────────────
  // Web auth surface
  {
    label: "Integration: web auth cookie CSRF",
    command: "npm",
    args: ["run", "test:integration:web-auth-cookie-csrf"],
    retries: 1,
  },
  {
    label: "Integration: auth recovery UI",
    command: "npm",
    args: ["run", "test:integration:auth-recovery-ui"],
    retries: 1,
  },
  {
    label: "Integration: auth suspension UI",
    command: "npm",
    args: ["run", "test:integration:auth-suspension-ui"],
    retries: 1,
  },
  {
    label: "Integration: admin privacy UI",
    command: "npm",
    args: ["run", "test:integration:admin-privacy-ui"],
    retries: 1,
  },
  // Connector and marketplace gating
  {
    label: "Integration: connector action matrix UI gating",
    command: "npm",
    args: ["run", "test:integration:connector-action-matrix-ui-gating"],
    retries: 1,
  },
  {
    label: "Integration: marketplace capability UI gating",
    command: "npm",
    args: ["run", "test:integration:marketplace-capability-ui-gating"],
    retries: 1,
  },
  {
    label: "Integration: connector access entitlements",
    command: "npm",
    args: ["run", "test:integration:connector-access-entitlements"],
    retries: 1,
  },
  {
    label: "Integration: connector payload snapshot cap",
    command: "npm",
    args: ["run", "test:integration:connector-payload-snapshot-cap"],
    retries: 1,
  },
  // Product and catalog data quality
  {
    label: "Integration: create product pricing normalization",
    command: "npm",
    args: ["run", "test:integration:create-product-pricing-normalization"],
    retries: 1,
  },
  {
    label: "Integration: ONDC feature gating",
    command: "npm",
    args: ["run", "test:integration:ondc-feature-gating"],
    retries: 1,
  },
  {
    label: "Integration: Amazon authoritative validation",
    command: "npm",
    args: ["run", "test:integration:amazon-authoritative-validation"],
    retries: 1,
  },
  {
    label: "Integration: issue inbox",
    command: "npm",
    args: ["run", "test:integration:issue-inbox"],
    retries: 1,
  },
  // Commercial governance
  {
    label: "Integration: billing commercial governance access",
    command: "npm",
    args: ["run", "test:integration:billing-commercial-governance-access"],
    retries: 1,
  },
  {
    label: "Integration: notifications center",
    command: "npm",
    args: ["run", "test:integration:notifications-center"],
    retries: 1,
  },
  {
    label: "Integration: quality reviewer role",
    command: "npm",
    args: ["run", "test:integration:quality-reviewer-role"],
    retries: 1,
  },
  {
    label: "Integration: marketplace worker failure visibility",
    command: "npm",
    args: ["run", "test:integration:marketplace-worker-failure-visibility"],
    retries: 1,
  },
  {
    // RG-C6: Enterprise-scale catalog search — faceted filters, cursor pagination,
    // access-policy scope, and unauthenticated 401 guard. 7-assertion proof.
    label: "Integration: enterprise search",
    command: "npm",
    args: ["run", "test:integration:enterprise-search"],
    retries: 1,
  },
    { label: "Guard: unsafe raw", command: "npm", args: ["run", "guard:unsafe-raw"] },
  { label: "Guard: sensitive GET policy", command: "npm", args: ["run", "guard:sensitive-gets"] },
];

function runStep(step) {
  const maxAttempts = (step.retries ?? 0) + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`\n==> ${step.label}${maxAttempts > 1 ? ` (attempt ${attempt}/${maxAttempts})` : ""}`);
    const command =
      process.platform === "win32" && step.command === "npm" ? "cmd.exe" : step.command;
    const args =
      process.platform === "win32" && step.command === "npm"
        ? ["/d", "/s", "/c", ["npm", ...step.args].join(" ")]
        : step.args;
    const result = spawnSync(command, args, {
      stdio: "inherit",
      shell: false,
    });
    if (!result.error && typeof result.status === "number" && result.status === 0) {
      return;
    }
    const baseError = result.error
      ? `${result.error.message}`
      : typeof result.status === "number"
        ? `exited with ${result.status}`
        : "unknown exit status";
    if (attempt < maxAttempts) {
      console.warn(`Retrying step after failure: ${step.label} (${baseError})`);
      continue;
    }
    if (step.allowFailure) {
      console.warn(`Gate step KNOWN-FAILING (allowFailure=true): ${step.label} -> ${baseError}`);
      return;
    }
    throw new Error(`Gate step failed: ${step.label} (${command} ${args.join(" ")}) -> ${baseError}`);
  }
}

const knownFailingSteps = [];

function main() {
  const startedAt = new Date();
  for (const step of STEPS) {
    runStep(step);
    if (step.allowFailure) knownFailingSteps.push(step.label);
  }
  const finishedAt = new Date();
  console.log(
    JSON.stringify(
      {
        status: "ok",
        suite: "INCREMENT_CORE_GATES",
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        totalSteps: STEPS.length,
        knownFailingSteps,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
