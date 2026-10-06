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

const REPO_ROOT = path.resolve(__dirname, "..");
const lane = JSON.parse(fs.readFileSync(process.env.LANE_CONFIG || path.join(__dirname, "restricted-role-lane.v1.json"), "utf8"));
const { evaluate } = require("./ci/restricted-lane-evaluate.cjs");
const ROLE = "vexa_runtime_ci";
const adminUrl = String(process.env.DATABASE_URL || "").trim();
if (!adminUrl) {
  console.error("DATABASE_URL (admin) is required.");
  process.exit(2);
}
const rolePassword = String(process.env.RESTRICTED_ROLE_PASSWORD || "vexa_runtime_ci_password").replace(/[^A-Za-z0-9_]/g, "");
const restrictedUrl = (() => {
  const u = new URL(adminUrl);
  u.username = ROLE;
  u.password = rolePassword;
  return u.toString();
})();
const preload = path.join(__dirname, "ci", "restricted-db-preload.cjs").split("\\").join("/");
const only = String(process.env.LANE_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const tests = lane.tests.filter((t) => only.length === 0 || only.includes(t));
const expectedFailing = new Map(lane.expectedFailing.map((e) => [e.test, e]));
const CONCURRENCY = Number(process.env.LANE_CONCURRENCY || 6);
const TIMEOUT_MS = Number(process.env.LANE_TIMEOUT_SECONDS || 300) * 1000;

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
    const keep = (chunk) => {
      for (const line of String(chunk).split("\n")) {
        if (line.trim()) {
          tail.push(line.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 300));
          if (tail.length > 60) {
            tail.shift();
          }
        }
      }
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ test, passed: code === 0, code, timedOut: signal === "SIGKILL", seconds: Math.round((Date.now() - started) / 1000), tail });
    });
  });
}

async function main() {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const apiUsers = new Set();
  const monitor = setInterval(async () => {
    try {
      const rows = await admin.$queryRaw`SELECT usename FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'vexa-pim-api-restricted'`;
      for (const r of rows) {
        apiUsers.add(r.usename);
      }
    } catch {
      /* the monitor is best effort */
    }
  }, 1500);

  const results = [];
  const queue = [...tests];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const test = queue.shift();
        const r = await runTest(test);
        results.push(r);
        console.log(`${r.passed ? "ok  " : "FAIL"} ${test} (${r.seconds}s)`);
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
      lines.push("  ```", ...r.tail.slice(-12).map((l) => `  ${l}`), "  ```");
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
    fs.writeFileSync(process.env.LANE_RESULTS_OUT, `${JSON.stringify(rows.map(({ tail, ...rest }) => ({ ...rest, expected: undefined })), null, 2)}\n`);
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
