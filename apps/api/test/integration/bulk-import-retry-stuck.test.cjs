#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("\nbulk-import-retry-stuck contract tests\n");

test("controller exposes POST runs/:id/retry-stuck endpoint", () => {
  const controllerSrc = fs.readFileSync(
    path.join(REPO_ROOT, "apps/api/src/bulk-import/bulk-import.controller.ts"),
    "utf8",
  );
  assert.ok(
    controllerSrc.includes('@Post("runs/:id/retry-stuck")'),
    "Controller must have @Post('runs/:id/retry-stuck') decorator",
  );
  assert.ok(
    controllerSrc.includes("retryStuckRows"),
    "Controller must call retryStuckRows method",
  );
});

test("run service implements retryStuckRows", () => {
  const serviceSrc = fs.readFileSync(
    path.join(REPO_ROOT, "apps/api/src/bulk-import/bulk-import-run.service.ts"),
    "utf8",
  );
  assert.ok(
    serviceSrc.includes("async retryStuckRows("),
    "BulkImportRunService must implement retryStuckRows",
  );
  assert.ok(
    serviceSrc.includes("processJob"),
    "retryStuckRows must delegate to processJob for actual row processing",
  );
  assert.ok(
    serviceSrc.includes("refreshRunCounters"),
    "retryStuckRows must refresh run counters after processing",
  );
});

test("retryStuckRows targets queued and retrying rows", () => {
  const serviceSrc = fs.readFileSync(
    path.join(REPO_ROOT, "apps/api/src/bulk-import/bulk-import-run.service.ts"),
    "utf8",
  );
  assert.ok(
    serviceSrc.includes("BulkImportRowStatus.queued") && serviceSrc.includes("BulkImportRowStatus.retrying"),
    "retryStuckRows must check for queued and retrying row statuses",
  );
});

test("Next.js proxy route exists for retry-stuck", () => {
  const routePath = path.join(
    REPO_ROOT,
    "apps/web/src/app/api/bulk-import/runs/[runId]/retry-stuck/route.ts",
  );
  assert.ok(fs.existsSync(routePath), "Next.js proxy route must exist at runs/[runId]/retry-stuck/route.ts");
  const routeSrc = fs.readFileSync(routePath, "utf8");
  assert.ok(
    routeSrc.includes("retry-stuck"),
    "Proxy route must forward to /retry-stuck NestJS endpoint",
  );
  assert.ok(
    routeSrc.includes("validateCsrf"),
    "Proxy route must validate CSRF",
  );
});

test("server action retryStuckRunAction exists", () => {
  const actionsSrc = fs.readFileSync(
    path.join(REPO_ROOT, "apps/web/src/app/actions.ts"),
    "utf8",
  );
  assert.ok(
    actionsSrc.includes("export async function retryStuckRunAction"),
    "retryStuckRunAction must be exported from actions.ts",
  );
  assert.ok(
    actionsSrc.includes("retry-stuck"),
    "retryStuckRunAction must call the retry-stuck endpoint",
  );
});

test("imports page imports retryStuckRunAction", () => {
  const pageSrc = fs.readFileSync(
    path.join(REPO_ROOT, "apps/web/src/app/operations/imports/page.tsx"),
    "utf8",
  );
  assert.ok(
    pageSrc.includes("retryStuckRunAction"),
    "Imports page must import and use retryStuckRunAction",
  );
  assert.ok(
    pageSrc.includes("Retry stuck rows"),
    "Imports page must show 'Retry stuck rows' button label",
  );
  assert.ok(
    pageSrc.includes("Import appears stuck"),
    "Imports page must show stuck import banner in run detail view",
  );
});

console.log("\nDone.\n");
