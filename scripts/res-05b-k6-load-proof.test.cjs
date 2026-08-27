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
assert(k6Script.includes("res05b_http_429_rate"), "k6 script must track 429 rate separately");
assert(k6Script.includes("res05b_request_failure_rate"), "k6 script must track request failure rate");
assert(k6Script.includes("queueWaitingObserved"), "k6 script must record queue waiting observations from health payload");
assert(k6Script.includes("queueActiveObserved"), "k6 script must record queue active observations from health payload");
assert(k6Script.includes("queueFailureIncrease"), "k6 script must record queue failed observations from health payload");
assert(k6Script.includes("RES05B_CREDENTIALS_JSON"), "k6 script must support distributed credential input");
assert(k6Script.includes("RES05B_MIN_DISTRIBUTED_CREDENTIALS"), "k6 script must define the distributed credential minimum");
assert(k6Script.includes("RES05B_LOGIN_STAGGER_SECONDS"), "k6 script must support login pacing for distributed setup");
assert(k6Script.includes("RES05B_SESSION_THINK_TIME_MIN_SECONDS"), "k6 script must support explicit minimum session think time");
assert(k6Script.includes("RES05B_SESSION_THINK_TIME_MAX_SECONDS"), "k6 script must support explicit maximum session think time");
assert(k6Script.includes("RES05B_ALLOW_SINGLE_CREDENTIAL_STRESS"), "k6 script must gate single-credential stress experiments explicitly");
assert(k6Script.includes("RES05B_ALLOW_DOCUMENTED_429"), "k6 script must require an explicit opt-in before accepting 429 responses");
assert(k6Script.includes("isDistributedLoadProfile(PROFILE)"), "k6 script must detect distributed acceptance profiles");
assert(k6Script.includes("defaultLoginStaggerSeconds(PROFILE, CREDENTIALS.length)"), "distributed setup must default to a safe login stagger");
assert(k6Script.includes("sleep(LOGIN_STAGGER_SECONDS)"), "distributed credential login must be paced");
assert(k6Script.includes("setupTimeoutForProfile(profile)"), "k6 options must extend setup timeout for paced distributed login");
assert(k6Script.includes('return isDistributedLoadProfile(profile) ? "20m" : "1m"'), "distributed setup timeout must allow paced logins");
assert(k6Script.includes("defaultSessionThinkTime(PROFILE)"), "distributed profiles must use rate-aware default think time");
assert(k6Script.includes("return { min: 10, max: 14 }"), "distributed default think time must stay below source-IP throttle");
assert(
  k6Script.includes("requires at least ${MIN_DISTRIBUTED_CREDENTIALS} credentials"),
  "expected/burst/sustained profiles must fail closed without distributed credentials",
);
assert(k6Script.includes('"res05b_http_429_rate": ["rate==0"]'), "429 responses must fail thresholds by default");
assert(k6Script.includes("credentialCount"), "k6 summary must include credential count without exposing identities");
assert(k6Script.includes("distributionMode"), "k6 summary must include distribution mode");
assert(k6Script.includes("loginStaggerSeconds"), "k6 summary must include login pacing metadata");
assert(k6Script.includes("sessionThinkTimeSeconds"), "k6 summary must include session pacing metadata");
assert(
  k6Script.includes('RES05B_SUMMARY_PATH || "res-05b-k6-summary.json"'),
  "default k6 summary path must not require a pre-created directory",
);
assert(k6Script.includes("RES05B_ENABLE_MUTATIONS"), "k6 script must explicitly gate mutation workload");
assert(
  k6Script.includes("mutation workload is intentionally not implemented in this read-only harness"),
  "mutation path must fail closed in this harness",
);
assert(k6Script.includes("isSuccessfulResponse(health)"), "k6 setup must not rely on Node-style response.ok");
assert(k6Script.includes("isSuccessfulResponse(login)"), "k6 login setup must not rely on Node-style response.ok");
assert(k6Script.includes("/catalog/products?slim=true&limit=20"), "k6 script must sample the normal slim product-list route");
assert(!k6Script.includes("/catalog/products?limit=20"), "k6 script must not sample the heavier preview product-list route");
assert(k6Script.includes("/dashboard/health"), "k6 script must sample the current dashboard health API route");
assert(k6Script.includes("/audit/logs?limit=10"), "k6 script must sample the current audit logs API route");
assert(!k6Script.includes("/dashboard/snapshot"), "k6 script must not sample the removed dashboard snapshot route");
assert(!k6Script.includes('"/audit?limit=10"'), "k6 script must not sample the removed bare audit route");
assert(!k6Script.includes("console.log(ADMIN_PASSWORD"), "k6 script must not print passwords");
assert(!k6Script.includes("Authorization}`"), "k6 script must not interpolate authorization headers into logs");
assert(!k6Script.includes("console.log(credential"), "k6 script must not print credentials");
assert(!k6Script.includes("JSON.stringify(CREDENTIALS"), "k6 script must not serialize credentials into summaries or logs");

assert(doc.includes("RES-05B"), "doc must describe RES-05B");
assert(doc.includes("read-only"), "doc must state read-only default");
assert(doc.includes("k6"), "doc must document k6 usage");
assert(doc.includes("Queue wait latency"), "doc must separate queue wait latency");
assert(doc.includes("Job execution latency"), "doc must separate job execution latency");
assert(doc.includes("No production settings"), "doc must prohibit production setting changes");
assert(doc.includes("NOT ACCEPTED"), "doc must avoid accepting RES-05B without runtime proof");
assert(doc.includes("workflow-scope credential"), "doc must record the current workflow-scope blocker");
assert(doc.includes("RES05B_CREDENTIALS_JSON"), "doc must describe distributed credential input");
assert(doc.includes("10 credentials"), "doc must record the approved distributed workload minimum");
assert(doc.includes("RES05B_LOGIN_STAGGER_SECONDS"), "doc must document login pacing");
assert(doc.includes("setupTimeout"), "doc must document distributed setup timeout behavior");
assert(doc.includes("RES05B_SESSION_THINK_TIME_MIN_SECONDS"), "doc must document session think-time pacing");
assert(doc.includes("10-14 seconds"), "doc must record the distributed profile default think-time range");
assert(doc.includes("429 responses fail by default"), "doc must document default 429 failure behavior");
assert(doc.includes("RES05B_ALLOW_DOCUMENTED_429"), "doc must document explicit rate-limit experiment opt-in");

assert(
  pkg.scripts["test:res-05b:k6-contract"] === "node scripts/res-05b-k6-load-proof.test.cjs",
  "package.json must expose test:res-05b:k6-contract",
);
assert(
  pkg.scripts["load:res-05b:k6"] === "k6 run scripts/res-05b-k6-load-proof.js",
  "package.json must expose load:res-05b:k6",
);

console.log("RES-05B k6 load proof contract: PASS");
