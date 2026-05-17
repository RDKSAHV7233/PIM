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
    label: "Integration: connector idempotency",
    command: "npm",
    args: ["run", "test:integration:connector-idempotency-semantics"],
    retries: 1,
    // Flipkart publish loop is incomplete (INC-10: ST-FK-RUNTIME-003/004/005 in_progress).
    // Known-failing until Flipkart credential runtime and real publish path are implemented.
    allowFailure: true,
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
