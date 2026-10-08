"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const v2 = require("./rehearse-v2.cjs");

assert.equal(v2.localAdminUrl("postgresql://postgres:pw@localhost:5432/postgres").hostname, "localhost");
assert.throws(() => v2.localAdminUrl("postgresql://postgres:pw@example.com:5432/postgres"), /loopback/);
assert.throws(() => v2.localAdminUrl("postgresql://postgres:pw@127.0.0.2:5432/postgres"), /loopback/);
assert.throws(() => v2.parseOutput([]), /required/);

const passed = v2.baseStageResults([{ name: "create-roles", ok: true }, { name: "rollback ownership", ok: true }], 0);
assert.equal(passed.get("ROLE_CREATION").result, "PASS");
assert.equal(passed.get("ROLLBACK").result, "PASS");
assert.equal(passed.get("BACKUP").result, "FAIL", "missing stage evidence fails closed");
assert.equal(v2.baseStageResults([{ name: "create-roles", ok: false }], 1).get("ROLE_CREATION").result, "FAIL");
assert.equal(v2.assertRuntimeAttributes([{ rolname: "vexa_runtime", rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, ownedObjects: 0 }]), true);
assert.equal(v2.assertRuntimeAttributes([{ rolname: "vexa_runtime", rolsuper: true, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, ownedObjects: 0 }]), false);
assert.equal(v2.assertRuntimeAttributes([{ rolname: "vexa_runtime", rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, ownedObjects: 1 }]), false);
assert.equal(v2.scanForSecrets({ safe: "BASE_CHECKS_PASSED" }), true);
assert.equal(v2.scanForSecrets({ unsafe: "postgresql://user:password@host/db" }), false);
const laneEnv = v2.laneEnvironment(v2.localAdminUrl("postgresql://postgres:pw@localhost:5432/postgres"), "C:\\tmp\\lane.json", "worker-backpressure.test.cjs");
assert.equal(laneEnv.LANE_CONCURRENCY, "1", "the v2 evidence lane is serial so local API listeners cannot collide");
assert.equal(laneEnv.APP_ENV, "development");
assert.equal(laneEnv.R2_BUCKET_NAME, "pim1-ci");
assert.equal(v2.laneIdentityProven({ sessionObserved: false }, [{ test: "credential-rotation-tenant-iteration.test.cjs", status: "PASS" }]), true, "the dedicated restricted-identity assertion proves short-lived API subjects");
assert.equal(v2.laneIdentityProven({ sessionObserved: false }, [{ test: "credential-rotation-tenant-iteration.test.cjs", status: "UNEXPECTED_FAIL" }]), false);
assert.deepEqual(
  v2.laneFailureSummary("RESTRICTED_ROLE_LANE", {
    diagnostic: "RESTRICTED_LANE_UNEXPECTED_FAILURE",
    artifactRefs: [{ test: "subject.test.cjs", status: "UNEXPECTED_FAIL", exitCode: 1, timedOut: false, failureCategory: "RLS_DENIED", failureStage: "TENANT_PROVISIONING", seconds: 2 }],
  }),
  {
    stage: "RESTRICTED_ROLE_LANE",
    diagnostic: "RESTRICTED_LANE_UNEXPECTED_FAILURE",
    failures: [{ test: "subject.test.cjs", status: "UNEXPECTED_FAIL", exitCode: 1, timedOut: false, failureCategory: "RLS_DENIED", failureStage: "TENANT_PROVISIONING" }],
  },
  "CI diagnostics retain only fixed failure metadata",
);

const valid = {
  schemaVersion: 1,
  runId: crypto.randomUUID(),
  startedAt: "2026-10-08T00:00:00.000Z",
  finishedAt: "2026-10-08T00:01:00.000Z",
  repo: { headSha: "a".repeat(40), ref: "main", sourceHeadSha: "e".repeat(40), sourceRef: "security/710r", dirty: false },
  runner: { version: "1", sha256: "b".repeat(64) },
  runnerSha256: "b".repeat(64),
  identityManifestSha256: "c".repeat(64),
  rehearsalConfigSha256: "d".repeat(64),
  postgres: { majorVersion: 16 },
  roleAttributes: [],
  stages: v2.STAGES.map((name) => ({
    name,
    startedAt: "2026-10-08T00:00:00.000Z",
    finishedAt: "2026-10-08T00:00:00.000Z",
    durationMs: 0,
    exitCode: 0,
    result: "PASS",
    diagnostic: "TEST_PASSED",
    artifactRefs: [],
  })),
  executionResult: { status: "PASS" },
  overallResult: "PASS",
  validationResult: { status: "PASS" },
  secretScanResult: { status: "PASS" },
};
assert.equal(v2.validateEvidence(valid).ok, true);
assert.equal(v2.validateEvidence({ ...valid, stages: valid.stages.slice(1) }).ok, false, "missing stage prevents validation");
assert.equal(
  v2.validateEvidence({
    ...valid,
    stages: valid.stages.map((item, index) => index === 7
      ? { ...item, artifactRefs: [{ test: "worker-backpressure.test.cjs", status: "UNEXPECTED_FAIL", exitCode: 1, timedOut: false, seconds: 2, failureCategory: "RLS_DENIED", failureStage: null }] }
      : item),
  }).ok,
  true,
  "sanitized lane classifications are valid evidence",
);
assert.equal(
  v2.validateEvidence({
    ...valid,
    stages: valid.stages.map((item, index) => index === 7
      ? { ...item, artifactRefs: [{ test: "worker-backpressure.test.cjs", status: "UNEXPECTED_FAIL", exitCode: 1, timedOut: false, seconds: 2, failureCategory: "RLS_DENIED", failureStage: null, output: "not allowed" }] }
      : item),
  }).ok,
  false,
  "raw lane output cannot become evidence",
);
assert.equal(
  v2.validateEvidence({
    ...valid,
    stages: valid.stages.map((item, index) => index === 7
      ? { ...item, artifactRefs: [{ test: "worker-backpressure.test.cjs", status: "UNEXPECTED_FAIL", exitCode: 1, timedOut: false, seconds: 2, failureCategory: "ARBITRARY_TEXT", failureStage: null }] }
      : item),
  }).ok,
  false,
  "only fixed failure categories are valid evidence",
);
const artifact = path.join(os.tmpdir(), `rehearsal-v2-test-${process.pid}.json`);
assert.equal(v2.writeValidatedEvidence(artifact, valid).ok, true);
assert.ok(fs.existsSync(artifact));
fs.rmSync(artifact, { force: true });
assert.equal(v2.writeValidatedEvidence(artifact, { ...valid, note: "postgresql://secret@host/db" }).ok, false, "unsafe artifact is not written");
assert.equal(fs.existsSync(artifact), false);

console.log("rehearsal v2 unit tests passed.");
