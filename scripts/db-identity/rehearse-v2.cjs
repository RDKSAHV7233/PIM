#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FAILURE_CATEGORIES } = require("../ci/restricted-lane-evaluate.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PRODLIKE_DATABASE = "rehearsal_prodlike";
const FRESH_DATABASE = "rehearsal_fresh";
const REHEARSAL_DATABASES = [PRODLIKE_DATABASE, FRESH_DATABASE, "rehearsal_restored", "rehearsal_restored_plain"];
const STAGES = [
  "SETUP",
  "CURRENT_STATE_REPRODUCTION",
  "ROLE_CREATION",
  "GRANT_APPLICATION",
  "OWNERSHIP_TRANSFER",
  "MIGRATION_AS_MIGRATOR",
  "RUNTIME_APPLICATION_TESTS",
  "WORKER_AND_SCHEDULER_TESTS",
  "RESTRICTED_ROLE_LANE",
  "BACKUP",
  "RESTORE",
  "REPORTER",
  "OPS",
  "NEGATIVE_SECURITY_TESTS",
  "ROLLBACK",
  "POST_ROLLBACK_VERIFICATION",
  "EVIDENCE_WRITE",
];

const BASE_STAGE_RULES = {
  CURRENT_STATE_REPRODUCTION: /starting state|snapshot taken|ownership split|target-model verifier FAILS on the starting state/i,
  ROLE_CREATION: /create-roles/i,
  GRANT_APPLICATION: /apply-grants|grant checks/i,
  OWNERSHIP_TRANSFER: /ownership transfer|apply-ownership|plan-ownership|owned by the migrator/i,
  MIGRATION_AS_MIGRATOR: /migration|migrate deploy|migrator/i,
  RUNTIME_APPLICATION_TESTS: /runtime role|tenant-a|tenant-b|own-tenant|platform control row/i,
  BACKUP: /backup role|pg_dump|daily backup/i,
  RESTORE: /pg_restore|restor(e|ed)|plain-SQL backup/i,
  REPORTER: /reporter|audit report|media-integrity report/i,
  OPS: /ops role|backfill|operator scripts/i,
  NEGATIVE_SECURITY_TESTS: /cross-tenant|cannot switch|cannot run migrations|refuses|BYPASSRLS|superuser/i,
  ROLLBACK: /rollback/i,
  POST_ROLLBACK_VERIFICATION: /re-apply forward|old role is untouched|rollback also left the data unchanged/i,
};

function parseOutput(argv = process.argv.slice(2)) {
  const index = argv.indexOf("--output");
  if (index < 0 || !argv[index + 1]) throw new Error("--output <artifact-path> is required.");
  return path.resolve(argv[index + 1]);
}

function localAdminUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("REHEARSAL_ADMIN_URL is required.");
  const url = new URL(raw);
  if (!/^postgres(?:ql)?:$/.test(url.protocol) || !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error("The v2 rehearsal only accepts an explicit loopback PostgreSQL administrative URL.");
  }
  return url;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function git(args) {
  return cp.execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function repositoryMetadata() {
  let sourceHeadSha = null;
  let sourceRef = null;
  const eventPath = String(process.env.GITHUB_EVENT_PATH || "").trim();
  if (eventPath && fs.existsSync(eventPath)) {
    try {
      const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
      sourceHeadSha = typeof event.pull_request?.head?.sha === "string" ? event.pull_request.head.sha : null;
      sourceRef = typeof event.pull_request?.head?.ref === "string" ? event.pull_request.head.ref : null;
    } catch {
      // Git metadata remains available without an Actions event payload.
    }
  }
  return {
    headSha: git(["rev-parse", "HEAD"]),
    ref: String(process.env.GITHUB_REF || "").trim() || git(["rev-parse", "--abbrev-ref", "HEAD"]),
    sourceHeadSha,
    sourceRef,
    dirty: git(["status", "--porcelain"]) !== "",
  };
}

function stage(name, result = "NOT_RUN", diagnostic = "NOT_RUN", artifactRefs = [], metadata = {}) {
  return {
    name,
    startedAt: metadata.startedAt || null,
    finishedAt: metadata.finishedAt || null,
    durationMs: Number.isInteger(metadata.durationMs) && metadata.durationMs >= 0 ? metadata.durationMs : null,
    exitCode: Number.isInteger(metadata.exitCode) ? metadata.exitCode : null,
    result,
    diagnostic,
    artifactRefs,
  };
}

function initialStages() {
  return new Map(STAGES.map((name) => [name, stage(name)]));
}

function setStage(stages, name, result, diagnostic, artifactRefs = [], metadata = {}) {
  const finishedAt = metadata.finishedAt || new Date().toISOString();
  const startedAt = metadata.startedAt || finishedAt;
  const durationMs = Number.isInteger(metadata.durationMs) && metadata.durationMs >= 0
    ? metadata.durationMs
    : Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  const exitCode = Number.isInteger(metadata.exitCode) ? metadata.exitCode : (result === "PASS" ? 0 : 1);
  stages.set(name, stage(name, result, diagnostic, artifactRefs, { ...metadata, startedAt, finishedAt, durationMs, exitCode }));
}

function runNode(script, args, env) {
  const result = cp.spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.error ? -1 : result.status, signal: result.signal || null };
}

function baseStageResults(checks, childStatus) {
  const out = new Map();
  for (const [name, pattern] of Object.entries(BASE_STAGE_RULES)) {
    const matches = checks.filter((check) => pattern.test(check.name));
    if (matches.length === 0) {
      out.set(name, stage(name, "FAIL", "BASE_CHECK_NOT_RECORDED"));
    } else if (matches.some((check) => check.ok !== true)) {
      out.set(name, stage(name, "FAIL", "BASE_CHECK_FAILED"));
    } else if (childStatus !== 0) {
      out.set(name, stage(name, "FAIL", "BASE_REHEARSAL_EXITED_NONZERO"));
    } else {
      out.set(name, stage(name, "PASS", "BASE_CHECKS_PASSED"));
    }
  }
  return out;
}

function assertRuntimeAttributes(rows) {
  const runtime = rows.find((row) => row.rolname === "vexa_runtime");
  return !!runtime && runtime.rolsuper === false && runtime.rolbypassrls === false && runtime.rolcreaterole === false && runtime.rolcreatedb === false && runtime.ownedObjects === 0;
}

function scanForSecrets(value) {
  const serialized = JSON.stringify(value);
  return !/(?:postgres(?:ql)?:\/\/|\bBearer\s+[A-Za-z0-9._-]+|(?:password|token|secret)\s*[=:]\s*\S+)/i.test(serialized);
}

function validateEvidence(evidence) {
  const errors = [];
  if (evidence.schemaVersion !== 1) errors.push("schemaVersion");
  if (!/^[0-9a-f-]{36}$/i.test(String(evidence.runId || ""))) errors.push("runId");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(evidence.startedAt || "")) || !/^\d{4}-\d{2}-\d{2}T/.test(String(evidence.finishedAt || ""))) errors.push("timestamps");
  if (!/^[0-9a-f]{40}$/i.test(String(evidence.repo && evidence.repo.headSha))) errors.push("repo.headSha");
  if (!String(evidence.repo && evidence.repo.ref || "").trim()) errors.push("repo.ref");
  if (evidence.repo && evidence.repo.sourceHeadSha !== null && !/^[0-9a-f]{40}$/i.test(String(evidence.repo.sourceHeadSha))) errors.push("repo.sourceHeadSha");
  if (evidence.repo && evidence.repo.sourceRef !== null && !String(evidence.repo.sourceRef).trim()) errors.push("repo.sourceRef");
  if (!evidence.repo || evidence.repo.dirty !== false) errors.push("repo.dirty");
  if (!Number.isInteger(evidence.postgres && evidence.postgres.majorVersion)) errors.push("postgres.majorVersion");
  for (const key of ["runnerSha256", "identityManifestSha256", "rehearsalConfigSha256"]) {
    if (!/^[0-9a-f]{64}$/i.test(String(evidence[key] || ""))) errors.push(key);
  }
  const stages = Array.isArray(evidence.stages) ? evidence.stages : [];
  if (stages.length !== STAGES.length || stages.some((item, index) => item.name !== STAGES[index])) errors.push("stages");
  for (const item of stages) {
    if (!["PASS", "FAIL", "NOT_RUN"].includes(item.result) || !/^[A-Z0-9_]{3,80}$/.test(String(item.diagnostic || ""))) errors.push(`stage:${item.name}`);
    if (
      item.result !== "NOT_RUN" &&
      (!/^\d{4}-\d{2}-\d{2}T/.test(String(item.startedAt || "")) ||
        !/^\d{4}-\d{2}-\d{2}T/.test(String(item.finishedAt || "")) ||
        !Number.isInteger(item.durationMs) ||
        item.durationMs < 0 ||
        !Number.isInteger(item.exitCode))
    ) {
      errors.push(`stage:${item.name}:timing`);
    }
    if (!Array.isArray(item.artifactRefs)) {
      errors.push(`stage:${item.name}:artifactRefs`);
      continue;
    }
    for (const ref of item.artifactRefs) {
      const keys = Object.keys(ref || {}).sort().join(",");
      if (
        keys !== "exitCode,failureCategory,failureStage,seconds,status,test,timedOut" ||
        !/^[A-Za-z0-9_.-]+$/.test(String(ref.test || "")) ||
        !["PASS", "EXPECTED_FAIL", "UNEXPECTED_FAIL", "UNEXPECTED_PASS", "UNCLASSIFIED"].includes(ref.status) ||
        !(ref.exitCode === null || Number.isInteger(ref.exitCode)) ||
        typeof ref.timedOut !== "boolean" ||
        !(ref.seconds === null || (Number.isInteger(ref.seconds) && ref.seconds >= 0)) ||
        !(ref.failureCategory === null || FAILURE_CATEGORIES.has(ref.failureCategory)) ||
        !(ref.failureStage === null || /^[A-Z0-9_]{3,80}$/.test(ref.failureStage))
      ) {
        errors.push(`stage:${item.name}:artifactRef`);
      }
    }
  }
  if (!["PASS", "FAIL", "INCOMPLETE"].includes(evidence.overallResult)) errors.push("overallResult");
  if (!evidence.executionResult || !["PASS", "FAIL"].includes(evidence.executionResult.status)) errors.push("executionResult");
  if (!evidence.runner || evidence.runner.version !== "1" || !/^[0-9a-f]{64}$/i.test(String(evidence.runner.sha256 || ""))) errors.push("runner");
  if (!evidence.validationResult || evidence.validationResult.status !== "PASS") errors.push("validationResult");
  if (!evidence.secretScanResult || evidence.secretScanResult.status !== "PASS") errors.push("secretScanResult");
  return { ok: errors.length === 0, errors };
}

function buildEvidence({ startedAt, repo, postgresMajor, stages, roleAttributes, executionResult }) {
  const finishedAt = new Date().toISOString();
  const allPassed = [...stages.values()].every((item) => item.result === "PASS");
  return {
    schemaVersion: 1,
    runId: crypto.randomUUID(),
    startedAt,
    finishedAt,
    repo,
    runner: { version: "1", sha256: sha256File(__filename) },
    runnerSha256: sha256File(__filename),
    identityManifestSha256: sha256File(path.join(ROOT, "packages", "db", "identity", "identity-model.v1.json")),
    rehearsalConfigSha256: sha256File(path.join(ROOT, "scripts", "restricted-role-lane.v1.json")),
    postgres: { majorVersion: postgresMajor },
    roleAttributes,
    stages: STAGES.map((name) => stages.get(name)),
    executionResult: { status: executionResult ? "PASS" : "FAIL" },
    overallResult: executionResult && allPassed ? "PASS" : "FAIL",
    validationResult: { status: "PASS" },
    secretScanResult: { status: "PASS" },
  };
}

function writeValidatedEvidence(output, evidence) {
  const validation = validateEvidence(evidence);
  if (!validation.ok) return { ok: false, reason: "ARTIFACT_SCHEMA_INVALID" };
  if (!scanForSecrets(evidence)) return { ok: false, reason: "REDACTION_VALIDATION_FAILED" };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  return { ok: true };
}

function prismaClient(url) {
  const { PrismaClient } = require("@prisma/client");
  return new PrismaClient({ datasources: { db: { url } }, log: [] });
}

function urlFor(adminUrl, database, role, password) {
  const url = new URL(adminUrl.toString());
  url.pathname = `/${database}`;
  url.username = role;
  url.password = password;
  return url.toString();
}

async function proveMaintenanceSettingBlocked(adminUrl) {
  const admin = prismaClient(urlFor(adminUrl, FRESH_DATABASE, decodeURIComponent(adminUrl.username), decodeURIComponent(adminUrl.password)));
  const runtime = prismaClient(urlFor(adminUrl, FRESH_DATABASE, "vexa_runtime", "vexa_runtime_rehearsal_password"));
  try {
    for (const table of ["ai_provider_budget_policies", "ai_provider_budget_reservations", "ai_provider_budget_charges"]) {
      await admin.$executeRawUnsafe(`DROP POLICY IF EXISTS "ai_maintenance_read_${table}" ON public."${table}"`);
    }
    await admin.$executeRawUnsafe("INSERT INTO public.\"ai_provider_budget_policies\" (id, tenant_key, capability, policy_version, period_key, period_started_at, period_ends_at) VALUES ('v2-policy-a','v2-a','v2','v2','v2',now(),now() + interval '1 day'), ('v2-policy-b','v2-b','v2','v2','v2',now(),now() + interval '1 day')");
    const proof = await runtime.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT set_config('app.tenant_key', 'v2-a', true)");
      const scoped = await tx.$queryRawUnsafe("SELECT count(*)::int AS n FROM public.\"ai_provider_budget_policies\"");
      await tx.$executeRawUnsafe("SELECT set_config('app.ai_maintenance', 'on', true)");
      const marked = await tx.$queryRawUnsafe("SELECT count(*)::int AS n FROM public.\"ai_provider_budget_policies\"");
      const other = await tx.$queryRawUnsafe("SELECT count(*)::int AS n FROM public.\"ai_provider_budget_policies\" WHERE tenant_key = 'v2-b'");
      return { scoped: scoped[0].n, marked: marked[0].n, other: other[0].n };
    });
    return proof.scoped === 1 && proof.marked === 1 && proof.other === 0;
  } finally {
    await runtime.$disconnect().catch(() => undefined);
    await admin.$disconnect().catch(() => undefined);
  }
}

async function readRoleAttributes(adminUrl) {
  const admin = prismaClient(urlFor(adminUrl, FRESH_DATABASE, decodeURIComponent(adminUrl.username), decodeURIComponent(adminUrl.password)));
  try {
    return await admin.$queryRawUnsafe("SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS \"ownedObjects\" FROM pg_roles r WHERE r.rolname IN ('vexa_runtime','vexa_migrator','vexa_backup','vexa_reporter','vexa_ops') ORDER BY r.rolname");
  } finally {
    await admin.$disconnect().catch(() => undefined);
  }
}

async function cleanup(adminUrl) {
  const admin = prismaClient(urlFor(adminUrl, "postgres", decodeURIComponent(adminUrl.username), decodeURIComponent(adminUrl.password)));
  try {
    for (const database of REHEARSAL_DATABASES) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    }
  } finally {
    await admin.$disconnect().catch(() => undefined);
  }
}

function laneEnvironment(adminUrl, laneOutput, only, database = FRESH_DATABASE) {
  const adminDatabase = urlFor(adminUrl, database, decodeURIComponent(adminUrl.username), decodeURIComponent(adminUrl.password));
  return {
    ...process.env,
    DATABASE_URL: adminDatabase,
    DATABASE_URL_DIRECT: adminDatabase,
    DATABASE_URL_POOLED: adminDatabase,
    RESTRICTED_ROLE_NAME: "vexa_runtime",
    RESTRICTED_ROLE_PASSWORD: "vexa_runtime_rehearsal_password",
    LANE_RESULTS_OUT: laneOutput,
    LANE_ONLY: only,
    // The full lane includes API-process tests that choose a local listener.
    // Serial execution keeps this production-shaped proof deterministic.
    LANE_CONCURRENCY: "1",
    QUEUE_BACKEND: "memory",
    QUEUE_WORKER_ENABLED: "true",
    JWT_SECRET: "rehearsal-v2-jwt-secret-minimum-length-32",
    CREDENTIAL_ENCRYPTION_KEY_V1: "rehearsal-v2-encryption-key-minimum-32",
    CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: "1",
    AUTH_MODE: "local",
    APP_ENV: "development",
    REDIS_URL: "redis://localhost:6379",
    R2_ACCOUNT_ID: "local-ci",
    R2_ACCESS_KEY_ID: "local-ci",
    R2_SECRET_ACCESS_KEY: "local-ci",
    R2_BUCKET_NAME: "pim1-ci",
    R2_PUBLIC_URL: "https://example.com/pim1-ci",
  };
}

function laneIdentityProven(report, classifications) {
  return report?.sessionObserved === true || classifications.some(
    (item) => item.test === "credential-rotation-tenant-iteration.test.cjs" && item.status === "PASS",
  );
}

function runLane(adminUrl, only, database = FRESH_DATABASE) {
  const laneOutput = path.join(os.tmpdir(), `restricted-lane-v2-${process.pid}-${crypto.randomUUID()}.json`);
  try {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const result = runNode(path.join(ROOT, "scripts", "run-restricted-role-lane.cjs"), [], laneEnvironment(adminUrl, laneOutput, only, database));
    const finishedAt = new Date().toISOString();
    const report = fs.existsSync(laneOutput) ? JSON.parse(fs.readFileSync(laneOutput, "utf8")) : null;
    const tests = Array.isArray(report?.tests) ? report.tests : [];
    const classifications = tests
      .filter((item) => /^[A-Za-z0-9_.-]+$/.test(String(item.test || "")))
      .map((item) => ({
        test: item.test,
        status: ["PASS", "EXPECTED_FAIL", "UNEXPECTED_FAIL", "UNEXPECTED_PASS"].includes(item.status) ? item.status : "UNCLASSIFIED",
        exitCode: Number.isInteger(item.code) ? item.code : null,
        timedOut: item.timedOut === true,
        seconds: Number.isInteger(item.seconds) && item.seconds >= 0 ? item.seconds : null,
        failureCategory: item.failureCategory === null || FAILURE_CATEGORIES.has(item.failureCategory)
          ? item.failureCategory
          : "UNCLASSIFIED_FAILURE",
        failureStage: item.failureStage === null || /^[A-Z0-9_]{3,80}$/.test(item.failureStage)
          ? item.failureStage
          : null,
      }));
    const sessionObserved = laneIdentityProven(report, classifications);
    const unexpectedFailures = classifications.filter((item) => item.status === "UNEXPECTED_FAIL").length;
    const unexpectedPasses = classifications.filter((item) => item.status === "UNEXPECTED_PASS").length;
    const diagnostic = result.status === 0 && classifications.length > 0
      ? "RESTRICTED_LANE_PASSED"
      : unexpectedFailures > 0
          ? "RESTRICTED_LANE_UNEXPECTED_FAILURE"
          : unexpectedPasses > 0
            ? "RESTRICTED_LANE_UNEXPECTED_PASS"
            : !sessionObserved
              ? "RESTRICTED_SESSION_NOT_OBSERVED"
              : "RESTRICTED_LANE_EXITED_NONZERO";
    return {
      ok: result.status === 0 && classifications.length > 0,
      diagnostic,
      artifactRefs: classifications,
      timing: { startedAt, finishedAt, durationMs: Date.now() - startedMs, exitCode: Number.isInteger(result.status) ? result.status : -1 },
    };
  } finally {
    fs.rmSync(laneOutput, { force: true });
  }
}

function laneFailureSummary(stageName, lane) {
  return {
    stage: stageName,
    diagnostic: lane.diagnostic,
    failures: lane.artifactRefs
      .filter((item) => item.status === "UNEXPECTED_FAIL" || item.status === "UNEXPECTED_PASS")
      .map(({ test, status, exitCode, timedOut, failureCategory, failureStage }) => ({
        test,
        status,
        exitCode,
        timedOut,
        failureCategory,
        failureStage,
      })),
  };
}

async function main() {
  const output = parseOutput();
  const startedAt = new Date().toISOString();
  const stages = initialStages();
  let adminUrl;
  let repo = { headSha: "0000000000000000000000000000000000000000", ref: "unknown", dirty: true };
  let postgresMajor = 0;
  let roleAttributes = [];
  let executionOk = false;
  try {
    repo = repositoryMetadata();
    if (repo.dirty) throw new Error("DIRTY_WORKTREE");
    adminUrl = localAdminUrl(process.env.REHEARSAL_ADMIN_URL);
    const admin = prismaClient(urlFor(adminUrl, "postgres", decodeURIComponent(adminUrl.username), decodeURIComponent(adminUrl.password)));
    try {
      const [version] = await admin.$queryRawUnsafe("SHOW server_version_num");
      postgresMajor = Math.floor(Number(version.server_version_num) / 10000);
    } finally {
      await admin.$disconnect().catch(() => undefined);
    }
    setStage(stages, "SETUP", "PASS", "LOCAL_SETUP_PASSED");

    const baseOut = path.join(os.tmpdir(), `rehearsal-v2-base-${process.pid}-${crypto.randomUUID()}.json`);
    const baseStartedAt = new Date().toISOString();
    const baseStartedMs = Date.now();
    const base = runNode(path.join(__dirname, "rehearse.cjs"), ["--keep"], { ...process.env, REHEARSAL_RESULT_OUT: baseOut });
    const baseFinishedAt = new Date().toISOString();
    const baseResults = fs.existsSync(baseOut) ? JSON.parse(fs.readFileSync(baseOut, "utf8")) : { checks: [] };
    fs.rmSync(baseOut, { force: true });
    for (const [name, result] of baseStageResults(baseResults.checks || [], base.status)) {
      setStage(stages, name, result.result, result.diagnostic, [], {
        startedAt: baseStartedAt,
        finishedAt: baseFinishedAt,
        durationMs: Date.now() - baseStartedMs,
        exitCode: Number.isInteger(base.status) ? base.status : -1,
      });
    }
    if (base.status !== 0) throw new Error("BASE_REHEARSAL_FAILED");

    roleAttributes = await readRoleAttributes(adminUrl);
    if (!assertRuntimeAttributes(roleAttributes)) {
      setStage(stages, "RUNTIME_APPLICATION_TESTS", "FAIL", "RUNTIME_ATTRIBUTE_ASSERTION_FAILED");
      throw new Error("RUNTIME_ATTRIBUTE_ASSERTION_FAILED");
    }

    const d022 = await proveMaintenanceSettingBlocked(adminUrl);
    if (!d022) {
      setStage(stages, "NEGATIVE_SECURITY_TESTS", "FAIL", "D022_TARGET_STATE_FAILED");
      throw new Error("D022_TARGET_STATE_FAILED");
    }

    const worker = runLane(adminUrl, "marketplace-worker-failure-visibility.test.cjs,worker-backpressure.test.cjs,advisory-lock-mutual-exclusion.test.cjs,credential-rotation-tenant-iteration.test.cjs", PRODLIKE_DATABASE);
    setStage(stages, "WORKER_AND_SCHEDULER_TESTS", worker.ok ? "PASS" : "FAIL", worker.ok ? "WORKER_LANE_PASSED" : worker.diagnostic, worker.artifactRefs, worker.timing);
    if (!worker.ok) console.log(JSON.stringify(laneFailureSummary("WORKER_AND_SCHEDULER_TESTS", worker)));
    if (!worker.ok) throw new Error("WORKER_LANE_FAILED");

    const lane = runLane(adminUrl, "");
    setStage(stages, "RESTRICTED_ROLE_LANE", lane.ok ? "PASS" : "FAIL", lane.ok ? "RESTRICTED_LANE_PASSED" : lane.diagnostic, lane.artifactRefs, lane.timing);
    if (!lane.ok) console.log(JSON.stringify(laneFailureSummary("RESTRICTED_ROLE_LANE", lane)));
    if (!lane.ok) throw new Error("RESTRICTED_LANE_FAILED");
    executionOk = true;
  } catch (error) {
    if (stages.get("SETUP").result === "NOT_RUN") setStage(stages, "SETUP", "FAIL", "SETUP_FAILED");
  } finally {
    if (adminUrl) await cleanup(adminUrl).catch(() => undefined);
  }

  setStage(stages, "EVIDENCE_WRITE", "PASS", "EVIDENCE_VALIDATED");
  const evidence = buildEvidence({ startedAt, repo, postgresMajor, stages, roleAttributes, executionResult: executionOk });
  const written = writeValidatedEvidence(output, evidence);
  if (!written.ok) {
    console.error(written.reason === "REDACTION_VALIDATION_FAILED" ? "redaction validation failed" : "evidence validation failed");
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ overallResult: evidence.overallResult, artifact: path.basename(output) }));
  if (evidence.overallResult !== "PASS") process.exitCode = 1;
}

if (require.main === module) {
  main().catch(() => {
    console.error("rehearsal v2 failed before safe evidence could be written");
    process.exit(1);
  });
}

module.exports = { STAGES, assertRuntimeAttributes, baseStageResults, laneEnvironment, laneFailureSummary, laneIdentityProven, localAdminUrl, parseOutput, scanForSecrets, validateEvidence, writeValidatedEvidence };
