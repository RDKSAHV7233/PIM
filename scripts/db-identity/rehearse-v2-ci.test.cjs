"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ci = fs.readFileSync(path.resolve(__dirname, "..", "..", ".github", "workflows", "ci.yml"), "utf8");
const match = /\n  db-identity-rehearsal-v2:\n([\s\S]*?)(?=\n  [a-z0-9-]+:\n|$)/.exec(ci);
assert.ok(match, "CI defines the v2 rehearsal job");
const job = match[1];
assert.match(job, /postgres: \["16", "18"\]/, "CI keeps independent PG16 and PG18 lanes");
assert.match(job, /rehearse-v2\.cjs --output artifacts\/db-identity-rehearsal-v2-pg/, "CI runs the v2 runner with an evidence artifact path");
assert.match(job, /validate-rehearse-v2-evidence\.cjs/, "CI validates evidence before upload");
assert.match(job, /id: evidence_validation/, "CI exposes the independent evidence validation result");
assert.match(job, /sha256sum artifacts\/db-identity-rehearsal-v2-pg/, "CI records the checksum of the validated JSON itself");
assert.match(
  job,
  /- name: Upload validated redacted rehearsal evidence\s+if: always\(\) && steps\.evidence_validation\.outcome == 'success' && steps\.evidence_checksum\.outcome == 'success'/,
  "CI uploads evidence only after validation and JSON checksum recording succeed",
);
assert.match(job, /actions\/upload-artifact@v4/, "CI uploads only the designated evidence artifact");
assert.doesNotMatch(job, /continue-on-error:\s*true/, "the v2 rehearsal cannot fail silently");

console.log("rehearsal v2 CI guard tests passed.");
