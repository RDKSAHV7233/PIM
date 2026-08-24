#!/usr/bin/env node
/**
 * Parallel integration test runner.
 *
 * Each integration test is fully isolated:
 *   - random port (7100–7219)
 *   - unique tenant key (Date.now() suffix)
 *   - in-memory queue + Redis disabled
 * So there is no correctness reason to run them serially.
 *
 * Usage:
 *   node scripts/run-integration-parallel.cjs [--timeout=120] test1.test.cjs test2.test.cjs ...
 *
 *   # or use the npm shorthand which runs the CI gate tests in parallel:
 *   npm run test:integration:parallel
 */
/* eslint-disable no-console */
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");

// ── CLI parsing ───────────────────────────────────────────────────────────────

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

const LABEL_COLORS = ["\x1b[36m", "\x1b[35m", "\x1b[33m", "\x1b[32m", "\x1b[34m"];

function color(c, text) {
  return `${c}${text}${COLORS.reset}`;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let timeoutSeconds = 180;
  const testFiles = [];
  for (const arg of args) {
    if (arg.startsWith("--timeout=")) {
      timeoutSeconds = parseInt(arg.split("=")[1], 10) || 180;
    } else {
      testFiles.push(arg);
    }
  }
  return { timeoutSeconds, testFiles };
}

// Default test suite — mirrors the 5 tests in `npm test`
const DEFAULT_TESTS = [
  "apps/api/test/integration/auth-revocation.test.cjs",
  "apps/api/test/integration/connector-idempotency-semantics.test.cjs",
  "apps/api/test/integration/marketplace-worker-failure-visibility.test.cjs",
  "apps/api/test/integration/worker-backpressure.test.cjs",
  "apps/api/test/integration/connector-mapping-lifecycle.test.cjs",
  "apps/api/test/integration/error-authority-api-filter-runtime.test.cjs",
];

// ── Runner ────────────────────────────────────────────────────────────────────

/**
 * Run a single test file as a child process.
 * @param {string} testFile  relative path from repo root
 * @param {string} label     short display name
 * @param {string} labelColor ANSI color escape for the label
 * @param {number} timeoutMs kill if not done within this many ms
 * @returns {Promise<{ label: string; exitCode: number; durationMs: number }>}
 */
function runTest(testFile, label, labelColor, timeoutMs) {
  return new Promise((resolve) => {
    const absPath = path.isAbsolute(testFile) ? testFile : path.join(REPO_ROOT, testFile);
    const prefix = color(labelColor, `[${label}]`);

    const child = spawn(process.execPath, [absPath], {
      cwd: REPO_ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const startMs = Date.now();

    child.stdout.on("data", (chunk) => {
      for (const line of String(chunk).trimEnd().split(/\r?\n/)) {
        console.log(`${prefix} ${line}`);
      }
    });

    child.stderr.on("data", (chunk) => {
      for (const line of String(chunk).trimEnd().split(/\r?\n/)) {
        console.error(`${prefix} ${line}`);
      }
    });

    let settled = false;
    const killTimer = setTimeout(() => {
      if (!settled) {
        child.kill("SIGTERM");
        setTimeout(() => { if (!settled) child.kill("SIGKILL"); }, 5000);
        console.error(
          color(COLORS.red, `[TIMEOUT] ${label} exceeded ${timeoutMs / 1000}s — process killed`),
        );
      }
    }, timeoutMs);
    killTimer.unref();

    child.on("close", (code) => {
      settled = true;
      clearTimeout(killTimer);
      resolve({ label, exitCode: code ?? 1, durationMs: Date.now() - startMs });
    });

    child.on("error", (err) => {
      settled = true;
      clearTimeout(killTimer);
      console.error(`${prefix} spawn error: ${err.message}`);
      resolve({ label, exitCode: 1, durationMs: Date.now() - startMs });
    });
  });
}

async function main() {
  const { timeoutSeconds, testFiles } = parseArgs(process.argv);
  const tests = testFiles.length > 0 ? testFiles : DEFAULT_TESTS;

  const totalMs = timeoutSeconds * 1000;
  const shortNames = tests.map((f) => path.basename(f, ".test.cjs"));

  console.log(color(COLORS.bold, `\n▶  Running ${tests.length} integration tests in parallel`));
  for (const name of shortNames) {
    console.log(`   • ${name}`);
  }
  console.log();

  const wallStart = Date.now();

  const results = await Promise.all(
    tests.map((file, i) =>
      runTest(file, shortNames[i], LABEL_COLORS[i % LABEL_COLORS.length], totalMs),
    ),
  );

  const wallMs = Date.now() - wallStart;

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(color(COLORS.bold, "\n── Results ──────────────────────────────────────────"));
  let failures = 0;
  for (const { label, exitCode, durationMs } of results) {
    const ok = exitCode === 0;
    const icon = ok ? color(COLORS.green, "✓") : color(COLORS.red, "✗");
    const dur = `${(durationMs / 1000).toFixed(1)}s`;
    if (!ok) failures += 1;
    console.log(`  ${icon}  ${label.padEnd(52)} ${dur}`);
  }

  console.log(color(COLORS.bold, "─────────────────────────────────────────────────────"));
  const wallSec = (wallMs / 1000).toFixed(1);
  const summary =
    failures === 0
      ? color(COLORS.green, `All ${results.length} passed`)
      : color(COLORS.red, `${failures} of ${results.length} failed`);
  console.log(`  ${summary}  (wall time: ${wallSec}s)\n`);

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
