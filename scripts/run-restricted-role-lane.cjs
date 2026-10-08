#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 restricted-role lane runner.
 *
 * Runs the integration tests listed in scripts/restricted-role-lane.v1.json with the API process connected as the restricted
 * runtime role (NOSUPERUSER, NOBYPASSRLS, non-owner) while each test keeps its admin connection for seeding and inspection.
 * See scripts/ci/restricted-db-preload.cjs for how only the API is switched.
 *
 * The lane is REQUIRED and RATCHETING:
 *   PASS             the test passed under the restricted role
 *   EXPECTED_FAIL    the test is listed as expected to fail (tracked, with the migration PR that fixes it) and did
 *   UNEXPECTED_FAIL  a test not listed as expected-failing failed: the lane fails
 *   UNEXPECTED_PASS  a test listed as expected-failing passed: the lane fails until the baseline is ratcheted down
 * It also fails if it cannot show that the API really connected as the restricted role, so a misconfigured lane can never pass.
 *
 *   DATABASE_URL                 admin URL of a freshly migrated, disposable database (the role script has been run)
 *   RESTRICTED_ROLE_PASSWORD     the password given to the role script (optional, same default)
 *   LANE_ONLY                    optional comma-separated test file names to run a subset
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { resolveRestrictedRoleName, restrictedUrlFor } = require("./ci/restricted-lane-config.cjs");
const { safeFailureStage } = require("./ci/restricted-lane-safe-diagnostics.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const lane = JSON.parse(fs.readFileSync(process.env.LANE_CONFIG || path.join(__dirname, "restricted-role-lane.v1.json"), "utf8"));
const { IDENTITY_PROOF_TESTS, classifyFailure, evaluate, isFailureSignal } = require("./ci/restricted-lane-evaluate.cjs");
const ROLE = resolveRestrictedRoleName();
const adminUrl = String(process.env.DATABASE_URL || "").trim();
if (!adminUrl) {
  console.error("DATABASE_URL (admin) is required.");
  process.exit(2);
}
const rolePassword = String(process.env.RESTRICTED_ROLE_PASSWORD || "vexa_runtime_ci_password").replace(/[^A-Za-z0-9_]/g, "");
const restrictedUrl = restrictedUrlFor(adminUrl, ROLE, rolePassword);
const preload = path.join(__dirname, "ci", "restricted-db-preload.cjs").split("\\").join("/");
const only = String(process.env.LANE_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const tests = lane.tests.filter((t) => only.length === 0 || only.includes(t));
const expectedFailing = new Map(lane.expectedFailing.map((e) => [e.test, e]));
const CONCURRENCY = Number(process.env.LANE_CONCURRENCY || 6);
const TIMEOUT_MS = Number(process.env.LANE_TIMEOUT_SECONDS || 300) * 1000;
// Integration subjects can complete their database work before a coarse timer
// samples pg_stat_activity. This lane runs only against disposable local DBs.
const SESSION_MONITOR_INTERVAL_MS = 100;

const MAX_SIGNAL_LINES = 12;

function runTest(test) {
  return new Promise((resolve) => {
    const started = Date.now();
    const env = {
      ...process.env,
      DATABASE_URL: adminUrl,
      DATABASE_URL_POOLED: adminUrl,
      DATABASE_URL_DIRECT: adminUrl,
      VEXA_RESTRICTED_DATABASE_URL: restrictedUrl,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${preload}`.trim(),
    };
    const child = spawn(process.execPath, [path.join(REPO_ROOT, "apps", "api", "test", "integration", test)], { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    const tail = [];
    // Raw child output exists only while its process is alive so we can derive a
    // fixed category. It is discarded before the result reaches CI or evidence.
    const signals = [];
    const keep = (chunk) => {
      for (const line of String(chunk).split("\n")) {
        if (line.trim()) {
          const clean = line.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 300);
          tail.push(clean);
          if (tail.length > 60) {
            tail.shift();
          }
          if (signals.length < MAX_SIGNAL_LINES && isFailureSignal(clean) && !signals.includes(clean)) {
            signals.push(clean);
          }
        }
      }
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const timedOut = signal === "SIGKILL";
      const failureCategory = code === 0 ? null : classifyFailure({ timedOut, signals, tail });
      const failureStage = code === 0 ? null : safeFailureStage([...signals, ...tail]);
      resolve({
        test,
        passed: code === 0,
        code,
        timedOut,
        seconds: Math.round((Date.now() - started) / 1000),
        failureCategory,
        failureStage,
      });
    });
  });
}

async function main() {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const apiUsers = new Set();
  const observeRestrictedApiSessions = async () => {
    try {
      const rows = await admin.$queryRaw`SELECT usename FROM pg_stat_activity WHERE application_name = 'vexa-pim-api-restricted'`;
      for (const r of rows) {
        apiUsers.add(r.usename);
      }
    } catch {
      /* the monitor is best effort */
    }
  };
  const monitor = setInterval(() => void observeRestrictedApiSessions(), SESSION_MONITOR_INTERVAL_MS);

  const results = [];
  const queue = [...tests];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const test = queue.shift();
        const r = await runTest(test);
        results.push(r);
        console.log(`${r.passed ? "ok  " : "FAIL"} ${test} (${r.seconds}s)${r.passed ? "" : ` ${r.failureCategory}${r.failureStage ? ` ${r.failureStage}` : ""}`}`);
      }
    }),
  );
  clearInterval(monitor);
  await admin.$disconnect().catch(() => undefined);

  const verdict = evaluate(results.sort((x, y) => x.test.localeCompare(y.test)), expectedFailing, apiUsers, ROLE);
  const rows = verdict.classified;
  const count = verdict.count;
  const sessionsOk = verdict.sessionsOk;
  const lines = [
    "## Restricted-role lane",
    "",
    `The API ran as \`${ROLE}\` (NOSUPERUSER, NOBYPASSRLS, non-owner). Sessions observed with application name vexa-pim-api-restricted: ${apiUsers.size === 0 ? "NONE" : [...apiUsers].join(", ")}.`,
    "",
    `| Result | Count |`,
    `|---|---|`,
    `| PASS | ${count("PASS")} |`,
    `| EXPECTED_FAIL (tracked) | ${count("EXPECTED_FAIL")} |`,
    `| UNEXPECTED_FAIL | ${count("UNEXPECTED_FAIL")} |`,
    `| UNEXPECTED_PASS (ratchet the baseline down) | ${count("UNEXPECTED_PASS")} |`,
    "",
  ];
  for (const r of rows.filter((x) => x.status === "UNEXPECTED_FAIL" || x.status === "UNEXPECTED_PASS")) {
    lines.push(`- **${r.status}** ${r.test}${r.timedOut ? " (timed out)" : ""}`);
    if (r.status === "UNEXPECTED_FAIL") {
      lines.push(`  exit code ${r.code === null ? "none" : r.code}${r.timedOut ? ", killed on timeout" : ""}, ${r.seconds}s, category ${r.failureCategory}${r.failureStage ? `, stage ${r.failureStage}` : ""}`);
    }
  }
  for (const r of rows.filter((x) => x.status === "EXPECTED_FAIL")) {
    lines.push(`- expected failing: ${r.test} (tracked by ${r.expected.tracks}: ${r.expected.reason})`);
  }
  if (!sessionsOk) {
    lines.push("", "**The lane could not show that the API connected as the restricted role, so it cannot pass.**");
  }
  const summary = lines.join("\n");
  console.log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  if (process.env.LANE_RESULTS_OUT) {
    // This file is consumed by the v2 evidence runner. Keep it deliberately
    // diagnostic enough to classify a failed lane, but never retain child output.
    fs.writeFileSync(
      process.env.LANE_RESULTS_OUT,
      `${JSON.stringify({
        sessionObserved: sessionsOk,
        identityProof: verdict.identityProof,
        identityProofTest: [...IDENTITY_PROOF_TESTS].find((test) => rows.some((row) => row.test === test && row.status === "PASS")) || null,
        tests: rows.map(({ test, status, code, timedOut, seconds, failureCategory, failureStage }) => ({
          test,
          status,
          code,
          timedOut,
          seconds,
          failureCategory,
          failureStage,
        })),
      }, null, 2)}\n`,
    );
  }
  if (!verdict.ok) {
    console.error(`restricted-role lane failed: ${count("UNEXPECTED_FAIL")} unexpected failure(s), ${count("UNEXPECTED_PASS")} unexpected pass(es), sessions ${sessionsOk ? "ok" : "NOT proven restricted"}`);
    process.exit(1);
  }
  console.log("restricted-role lane passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
