#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const {
  CI_QUARANTINED_TESTS,
  DB_DEPENDENT_TESTS,
  GLOB_COVERED_TESTS,
  listActualTestFiles,
} = require("./check-integration-test-coverage.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const TEST_DIR = path.join(REPO_ROOT, "apps/web/test/integration");

function parseArgs(argv) {
  const args = argv.slice(2);
  let timeoutSeconds = 30;
  const only = [];
  for (const arg of args) {
    if (arg.startsWith("--timeout=")) {
      timeoutSeconds = Number.parseInt(arg.slice("--timeout=".length), 10) || 30;
      continue;
    }
    only.push(arg);
  }
  return { timeoutSeconds, only };
}

function normalizeRequestedTest(name) {
  const base = path.basename(String(name ?? "").trim());
  return base.endsWith(".test.cjs") ? base : `${base}.test.cjs`;
}

function runTest(testFile, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [path.join(TEST_DIR, testFile)], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        WEB_INTEGRATION_DB_FREE_RUNNER: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 2_000).unref();
    }, timeoutMs);
    timer.unref();

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        testFile,
        code: code ?? (timedOut ? 124 : 1),
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        testFile,
        code: 1,
        signal: null,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: `${stderr}\nspawn error: ${error.message}`,
      });
    });
  });
}

async function main() {
  const { timeoutSeconds, only } = parseArgs(process.argv);
  const actualFiles = new Set(listActualTestFiles());
  const dbDependent = new Set(DB_DEPENDENT_TESTS);
  const requested = only.length > 0
    ? only.map(normalizeRequestedTest)
    : [...GLOB_COVERED_TESTS].sort();

  const invalid = requested.filter((testFile) => !actualFiles.has(testFile));
  if (invalid.length > 0) {
    throw new Error(`Unknown web integration test(s): ${invalid.join(", ")}`);
  }

  const unsafe = requested.filter((testFile) => dbDependent.has(testFile));
  if (unsafe.length > 0) {
    throw new Error(`DB-dependent test(s) cannot run in the DB-free web batch: ${unsafe.join(", ")}`);
  }

  const timeoutMs = timeoutSeconds * 1000;
  console.log(`[web-integration-db-free] Running ${requested.length} DB-free web integration test(s), timeout=${timeoutSeconds}s each.`);
  if (CI_QUARANTINED_TESTS.length > 0 && only.length === 0) {
    console.log(
      `[web-integration-db-free] Quarantined ${CI_QUARANTINED_TESTS.length} known failing DB-free test(s): ${CI_QUARANTINED_TESTS.join(", ")}`,
    );
  }

  const failures = [];
  for (const testFile of requested) {
    process.stdout.write(`[web-integration-db-free] START ${testFile}\n`);
    const result = await runTest(testFile, timeoutMs);
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    if (result.code === 0 && !result.timedOut) {
      console.log(`[web-integration-db-free] PASS ${testFile} ${result.durationMs}ms`);
      continue;
    }
    failures.push(result);
    console.error(
      `[web-integration-db-free] FAIL ${testFile} code=${result.code} signal=${result.signal ?? "none"} timeout=${result.timedOut} durationMs=${result.durationMs}`,
    );
  }

  console.log(`[web-integration-db-free] SUMMARY total=${requested.length} failed=${failures.length}`);
  if (failures.length > 0) {
    console.error(`[web-integration-db-free] FAILED ${failures.map((failure) => failure.testFile).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
