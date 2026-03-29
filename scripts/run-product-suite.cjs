#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");

const BASE_STEPS = [
  { label: "API lint", command: "npm", args: ["run", "lint", "--workspace", "@pim1/api"] },
  { label: "API build", command: "npm", args: ["run", "build", "--workspace", "@pim1/api"] },
  { label: "Web lint", command: "npm", args: ["run", "lint", "--workspace", "@pim1/web"] },
  { label: "Web build", command: "npm", args: ["run", "build", "--workspace", "@pim1/web"] },
];

const SUITES = {
  shell: [
    { label: "UI/UX: auth shell", command: "node", args: ["apps/web/test/integration/auth-shell-ui.test.cjs"] },
    { label: "UI/UX: product shell", command: "node", args: ["apps/web/test/integration/product-shell-uiux.test.cjs"] },
    { label: "UI/UX: global search", command: "node", args: ["apps/web/test/integration/global-search-ui.test.cjs"] },
    { label: "UI/UX: notification center", command: "node", args: ["apps/web/test/integration/notification-center-ui.test.cjs"] },
    { label: "UI/UX: catalog categories hydration", command: "node", args: ["apps/web/test/integration/catalog-categories-hydration.test.cjs"] },
  ],
  catalog: [
    { label: "UI/UX: catalog-first shell", command: "node", args: ["apps/web/test/integration/catalog-first-shell.test.cjs"] },
    { label: "UI/UX: catalog products route contract", command: "node", args: ["apps/web/test/integration/catalog-products-route-contract.test.cjs"] },
    { label: "UI/UX: product workbench", command: "node", args: ["apps/web/test/integration/product-workbench-ui.test.cjs"] },
    { label: "UI/UX: product detail route contract", command: "node", args: ["apps/web/test/integration/product-detail-route-contract.test.cjs"] },
    { label: "UI/UX: product detail workflow", command: "node", args: ["apps/web/test/integration/product-detail-workflow-ui.test.cjs"] },
    { label: "API: create product normalization", command: "npm", args: ["run", "test:integration:create-product-pricing-normalization"] },
    { label: "API: product workflow transitions", command: "npm", args: ["run", "test:integration:product-workflow-transitions"] },
  ],
  publish: [
    { label: "UI/UX: channels overview route contract", command: "node", args: ["apps/web/test/integration/channels-overview-route-contract.test.cjs"] },
    { label: "UI/UX: channels health route contract", command: "node", args: ["apps/web/test/integration/channels-health-route-contract.test.cjs"] },
    { label: "UI/UX: channels submissions route contract", command: "node", args: ["apps/web/test/integration/channels-submissions-route-contract.test.cjs"] },
    { label: "UI/UX: channel connector detail route contract", command: "node", args: ["apps/web/test/integration/channel-connector-detail-route-contract.test.cjs"] },
    { label: "UI/UX: mapping canonical", command: "node", args: ["apps/web/test/integration/mapping-canonical-ui.test.cjs"] },
    { label: "UI/UX: mapping structured editor", command: "node", args: ["apps/web/test/integration/mapping-structured-editor.test.cjs"] },
    { label: "UI/UX: mapping editor component", command: "node", args: ["apps/web/test/integration/mapping-editor-component.test.cjs"] },
    { label: "UI/UX: taxonomy search component", command: "node", args: ["apps/web/test/integration/taxonomy-search-component.test.cjs"] },
    { label: "UI/UX: version manager component", command: "node", args: ["apps/web/test/integration/version-manager-component.test.cjs"] },
    { label: "UI/UX: mapping step-up", command: "node", args: ["apps/web/test/integration/mapping-step-up-ui.test.cjs"] },
    { label: "UI/UX: mapping workflow", command: "node", args: ["apps/web/test/integration/mapping-workflow-ui.test.cjs"] },
    { label: "API: mapping lifecycle", command: "npm", args: ["run", "test:integration:connector-mapping-lifecycle"] },
    { label: "API: readiness batch", command: "npm", args: ["run", "test:integration:marketplace-readiness-batch"] },
    { label: "API: submission lifecycle", command: "npm", args: ["run", "test:integration:submission-lifecycle-api"] },
  ],
  operations: [
    { label: "UI/UX: ops cockpit", command: "node", args: ["apps/web/test/integration/ops-cockpit-ui.test.cjs"] },
    { label: "UI/UX: operations imports route contract", command: "node", args: ["apps/web/test/integration/operations-imports-route-contract.test.cjs"] },
    { label: "UI/UX: operations jobs route contract", command: "node", args: ["apps/web/test/integration/operations-jobs-route-contract.test.cjs"] },
    { label: "UI/UX: operations bulk edit route contract", command: "node", args: ["apps/web/test/integration/operations-bulk-edit-route-contract.test.cjs"] },
    { label: "UI/UX: operations repair route contract", command: "node", args: ["apps/web/test/integration/operations-repair-route-contract.test.cjs"] },
    { label: "UI/UX: notification center", command: "node", args: ["apps/web/test/integration/notification-center-ui.test.cjs"] },
    { label: "API: dashboard aggregations", command: "npm", args: ["run", "test:integration:dashboard-aggregations"] },
    { label: "API: notifications center", command: "npm", args: ["run", "test:integration:notifications-center"] },
    { label: "API: metrics KPI trends", command: "npm", args: ["run", "test:integration:metrics-kpi-trends"] },
    { label: "API: worker failure visibility", command: "npm", args: ["run", "test:integration:marketplace-worker-failure-visibility"] },
  ],
  governance: [
    { label: "UI/UX: connector access admin form", command: "node", args: ["apps/web/test/integration/connector-access-admin-form.test.cjs"] },
    { label: "UI/UX: admin users route contract", command: "node", args: ["apps/web/test/integration/admin-users-route-contract.test.cjs"] },
    { label: "UI/UX: admin connectors route contract", command: "node", args: ["apps/web/test/integration/admin-connectors-route-contract.test.cjs"] },
    { label: "UI/UX: admin api keys route contract", command: "node", args: ["apps/web/test/integration/admin-api-keys-route-contract.test.cjs"] },
    { label: "UI/UX: admin webhooks route contract", command: "node", args: ["apps/web/test/integration/admin-webhooks-route-contract.test.cjs"] },
    { label: "UI/UX: quality reviewer role", command: "node", args: ["apps/web/test/integration/quality-reviewer-role-ui.test.cjs"] },
    { label: "UI/UX: quality approvals route contract", command: "node", args: ["apps/web/test/integration/quality-approvals-route-contract.test.cjs"] },
    { label: "UI/UX: quality issues route contract", command: "node", args: ["apps/web/test/integration/quality-issues-route-contract.test.cjs"] },
    { label: "API: api keys", command: "npm", args: ["run", "test:integration:api-keys"] },
    { label: "API: outbound webhooks", command: "npm", args: ["run", "test:integration:outbound-webhooks"] },
    { label: "API: connector access entitlements", command: "npm", args: ["run", "test:integration:connector-access-entitlements"] },
    { label: "API: audit actor context", command: "npm", args: ["run", "test:integration:audit-actor-context"] },
    { label: "API: auth login lockout", command: "npm", args: ["run", "test:integration:auth-login-lockout"] },
    { label: "API: quality reviewer role", command: "npm", args: ["run", "test:integration:quality-reviewer-role"] },
    { label: "API: issue inbox", command: "npm", args: ["run", "test:integration:issue-inbox"] },
    { label: "API: tenant isolation", command: "npm", args: ["run", "test:integration:rls-isolation"] },
  ],
  reporting: [
    { label: "UI/UX: dashboard route contract", command: "node", args: ["apps/web/test/integration/dashboard-route-contract.test.cjs"] },
    { label: "UI/UX: dashboard signup funnel", command: "node", args: ["apps/web/test/integration/dashboard-signup-funnel-ui.test.cjs"] },
    { label: "UI/UX: dashboard approval truth", command: "node", args: ["apps/web/test/integration/dashboard-approval-truth.test.cjs"] },
    { label: "UI/UX: admin plan signup conversion", command: "node", args: ["apps/web/test/integration/admin-plan-signup-conversion-ui.test.cjs"] },
    { label: "UI/UX: admin plan signup export", command: "node", args: ["apps/web/test/integration/admin-plan-signup-export-ui.test.cjs"] },
    { label: "API: dashboard aggregations", command: "npm", args: ["run", "test:integration:dashboard-aggregations"] },
    { label: "API: metrics KPI trends", command: "npm", args: ["run", "test:integration:metrics-kpi-trends"] },
  ],
  cleanup: [
    { label: "UI/UX: legacy alias routes", command: "node", args: ["apps/web/test/integration/legacy-alias-routes.test.cjs"] },
    { label: "UI/UX: internal surface gating", command: "node", args: ["apps/web/test/integration/internal-surface-gating.test.cjs"] },
  ],
};

SUITES.uiux = [
  ...SUITES.shell,
  { label: "UI/UX: catalog products route contract", command: "node", args: ["apps/web/test/integration/catalog-products-route-contract.test.cjs"] },
  { label: "UI/UX: product workbench", command: "node", args: ["apps/web/test/integration/product-workbench-ui.test.cjs"] },
  { label: "UI/UX: product detail route contract", command: "node", args: ["apps/web/test/integration/product-detail-route-contract.test.cjs"] },
  { label: "UI/UX: product detail workflow", command: "node", args: ["apps/web/test/integration/product-detail-workflow-ui.test.cjs"] },
  { label: "UI/UX: dashboard route contract", command: "node", args: ["apps/web/test/integration/dashboard-route-contract.test.cjs"] },
  { label: "UI/UX: mapping workflow", command: "node", args: ["apps/web/test/integration/mapping-workflow-ui.test.cjs"] },
  { label: "UI/UX: connector access admin form", command: "node", args: ["apps/web/test/integration/connector-access-admin-form.test.cjs"] },
  { label: "UI/UX: ops cockpit", command: "node", args: ["apps/web/test/integration/ops-cockpit-ui.test.cjs"] },
];

SUITES.full = [
  ...SUITES.shell,
  ...SUITES.catalog,
  ...SUITES.publish,
  ...SUITES.operations,
  ...SUITES.governance,
  ...SUITES.reporting,
  ...SUITES.cleanup,
];

function spawnCommand(step) {
  const isNpm = step.command === "npm";
  const command = process.platform === "win32" && isNpm ? "cmd.exe" : step.command;
  const args =
    process.platform === "win32" && isNpm
      ? ["/d", "/s", "/c", ["npm", ...step.args].join(" ")]
      : step.args;
  return { command, args };
}

function runStep(step) {
  const { command, args } = spawnCommand(step);
  console.log(`\n==> ${step.label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
  });
  if (!result.error && typeof result.status === "number" && result.status === 0) {
    return;
  }
  const reason = result.error
    ? result.error.message
    : typeof result.status === "number"
      ? `exited with ${result.status}`
      : "unknown status";
  throw new Error(`Product suite step failed: ${step.label} (${command} ${args.join(" ")}) -> ${reason}`);
}

function dedupeSteps(steps) {
  const seen = new Set();
  return steps.filter((step) => {
    const key = `${step.command}|${step.args.join(" ")}|${step.label}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function resolveSuite(name) {
  if (!name || name === "full") {
    return { name: "full", steps: dedupeSteps([...BASE_STEPS, ...SUITES.full]) };
  }
  if (!Object.prototype.hasOwnProperty.call(SUITES, name)) {
    throw new Error(`Unknown product suite "${name}". Valid suites: ${Object.keys(SUITES).sort().join(", ")}`);
  }
  return { name, steps: dedupeSteps([...BASE_STEPS, ...SUITES[name]]) };
}

function main() {
  const requestedSuite = process.argv[2] ?? "full";
  const suite = resolveSuite(requestedSuite);
  const startedAt = new Date();
  for (const step of suite.steps) {
    runStep(step);
  }
  const finishedAt = new Date();
  console.log(
    JSON.stringify(
      {
        status: "ok",
        suite: `PRODUCT_${suite.name.toUpperCase()}`,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        totalSteps: suite.steps.length,
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
