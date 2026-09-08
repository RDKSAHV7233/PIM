#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const TARGET_FILE = path.join(REPO_ROOT, "apps/web/test/integration/public-signup-web-flow.test.cjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert(start >= 0, `Expected ${name} to exist.`);
  const nextFunction = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, nextFunction === -1 ? undefined : nextFunction);
}

function run() {
  const source = fs.readFileSync(TARGET_FILE, "utf8");
  const waitForHttp = extractFunction(source, "waitForHttp");
  const startProcess = source.slice(source.indexOf("function startProcess"), source.indexOf("async function stopProcess"));
  const stopProcess = source.slice(source.indexOf("async function stopProcess"), source.indexOf("function hasDatabaseAccess"));

  assert(
    waitForHttp.includes("deadline = Date.now() + timeoutMs"),
    "waitForHttp must keep an overall readiness deadline.",
  );
  assert(
    waitForHttp.includes("AbortSignal.timeout("),
    "waitForHttp fetch attempts must have their own abort timeout so one hung socket cannot bypass the overall deadline.",
  );
  assert(
    waitForHttp.includes("deadline - Date.now()"),
    "Per-attempt timeout must be bounded by the remaining overall readiness deadline.",
  );
  assert(
    !waitForHttp.includes('fetch(url, { method: "GET" });'),
    "waitForHttp must not use an unbounded bare fetch for readiness probes.",
  );
  assert(
    startProcess.includes('detached: process.platform !== "win32"'),
    "Spawned API/web processes must run in a process group on POSIX so cleanup reaches npm/Next child processes.",
  );
  assert(
    stopProcess.includes("process.kill(-proc.pid, \"SIGTERM\")") &&
      stopProcess.includes("process.kill(-proc.pid, \"SIGKILL\")"),
    "stopProcess must terminate the spawned process group and escalate if children keep the test process alive.",
  );
  assert(
    source.includes("await Promise.allSettled([stopProcess(webProcess), stopProcess(apiProcess)])"),
    "public signup flow must await process cleanup before the test exits.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "public_signup_waitForHttp_keeps_overall_deadline",
          "public_signup_waitForHttp_uses_per_attempt_abort_timeout",
          "public_signup_waitForHttp_has_no_unbounded_bare_fetch",
          "public_signup_child_processes_spawn_in_posix_process_group",
          "public_signup_cleanup_terminates_process_group_and_awaits_exit",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("public-signup-web-flow readiness timeout contract failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
