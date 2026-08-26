#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const k6ScriptPath = path.join(repoRoot, "scripts", "res-05b-k6-load-proof.js");
const docPath = path.join(repoRoot, "docs", "execution", "RES-05B_K6_LOAD_PROOF.md");
const packagePath = path.join(repoRoot, "package.json");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(file) {
  assert(fs.existsSync(file), `Missing file: ${path.relative(repoRoot, file)}`);
  return fs.readFileSync(file, "utf8");
}

const k6Script = read(k6ScriptPath);
const doc = read(docPath);
const pkg = JSON.parse(read(packagePath));

assert(k6Script.includes("import http from \"k6/http\""), "k6 script must use k6/http");
assert(k6Script.includes("RES05B_PROFILE"), "k6 script must select an explicit RES05B_PROFILE");
assert(k6Script.includes("health"), "k6 script must include health profile");
assert(k6Script.includes("smoke"), "k6 script must include smoke profile");
assert(k6Script.includes("baseline"), "k6 script must include baseline profile");
assert(k6Script.includes("expected"), "k6 script must include expected profile");
assert(k6Script.includes("burst"), "k6 script must include burst profile");
assert(k6Script.includes("sustained"), "k6 script must include sustained profile");
assert(k6Script.includes("res05b_http_5xx_rate"), "k6 script must track 5xx rate");
assert(k6Script.includes("res05b_request_failure_rate"), "k6 script must track request failure rate");
assert(k6Script.includes("queueWaitingObserved"), "k6 script must record queue waiting observations from health payload");
assert(k6Script.includes("queueActiveObserved"), "k6 script must record queue active observations from health payload");
assert(k6Script.includes("queueFailureIncrease"), "k6 script must record queue failed observations from health payload");
assert(k6Script.includes("RES05B_ENABLE_MUTATIONS"), "k6 script must explicitly gate mutation workload");
assert(
  k6Script.includes("mutation workload is intentionally not implemented in this read-only harness"),
  "mutation path must fail closed in this harness",
);
assert(k6Script.includes("isSuccessfulResponse(health)"), "k6 setup must not rely on Node-style response.ok");
assert(k6Script.includes("isSuccessfulResponse(login)"), "k6 login setup must not rely on Node-style response.ok");
assert(k6Script.includes("/dashboard/health"), "k6 script must sample the current dashboard health API route");
assert(k6Script.includes("/audit/logs?limit=10"), "k6 script must sample the current audit logs API route");
assert(!k6Script.includes("/dashboard/snapshot"), "k6 script must not sample the removed dashboard snapshot route");
assert(!k6Script.includes('"/audit?limit=10"'), "k6 script must not sample the removed bare audit route");
assert(!k6Script.includes("console.log(ADMIN_PASSWORD"), "k6 script must not print passwords");
assert(!k6Script.includes("Authorization}`"), "k6 script must not interpolate authorization headers into logs");

assert(doc.includes("RES-05B"), "doc must describe RES-05B");
assert(doc.includes("read-only"), "doc must state read-only default");
assert(doc.includes("k6"), "doc must document k6 usage");
assert(doc.includes("Queue wait latency"), "doc must separate queue wait latency");
assert(doc.includes("Job execution latency"), "doc must separate job execution latency");
assert(doc.includes("No production settings"), "doc must prohibit production setting changes");
assert(doc.includes("NOT ACCEPTED"), "doc must avoid accepting RES-05B without runtime proof");
assert(doc.includes("workflow-scope credential"), "doc must record the current workflow-scope blocker");

assert(
  pkg.scripts["test:res-05b:k6-contract"] === "node scripts/res-05b-k6-load-proof.test.cjs",
  "package.json must expose test:res-05b:k6-contract",
);
assert(
  pkg.scripts["load:res-05b:k6"] === "k6 run scripts/res-05b-k6-load-proof.js",
  "package.json must expose load:res-05b:k6",
);

console.log("RES-05B k6 load proof contract: PASS");
