#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const SCRIPT_PATH = path.resolve(__dirname, "validate-live-staging-evidence.cjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runValidator(args, cwd) {
  return childProcess.spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pim1-live-evidence-"));
  const artifactDir = path.join(tempRoot, "artifact");
  const gatesDir = path.join(artifactDir, "gates");
  const rolloutDir = path.join(artifactDir, "rollout");

  writeJson(path.join(gatesDir, "2026-03-13T12-00-00.000Z_STAGING_DEPLOY_POSTCHECK.json"), {
    environment: "staging",
    tenantId: "SMOKE_TENANT",
    date: "2026-03-13T12:00:00.000Z",
    gitTag: "sha-abcdef1",
    runUrl: "https://github.com/example/pim1/actions/runs/123456789",
    suite: "STAGING_DEPLOY_POSTCHECK",
  });

  writeJson(path.join(rolloutDir, "2026-03-13T12-05-00.000Z_CONTROLLED_ROLLOUT_SNAPSHOT.json"), {
    capturedAt: "2026-03-13T12:05:00.000Z",
    environment: "staging",
    tenantId: "SMOKE_TENANT",
    apiBase: "https://staging.example.com/api/v1",
    health: {
      ok: true,
      status: "ok",
      body: { status: "ok", env: "staging" },
      error: null,
    },
    controlledRollout: {
      pending: [],
    },
    broadRollout: {
      pending: [
        "14-day controlled rollout observation window not complete.",
      ],
    },
  });

  const passRun = runValidator(["--artifactDir", artifactDir, "--tenantId", "SMOKE_TENANT"], tempRoot);
  assert(passRun.status === 0, `Expected validator pass, got status=${passRun.status} stderr=${passRun.stderr}`);
  const passJson = JSON.parse(passRun.stdout);
  assert(passJson.status === "ok", "Expected ok status from validator");
  assert(passJson.mode === "controlled_ready_evidence", "Expected controlled-ready mode by default");
  assert(Array.isArray(passJson.broadPending) && passJson.broadPending.length === 1, "Expected broad pending note to be preserved");

  writeJson(path.join(gatesDir, "2026-03-13T12-06-00.000Z_STAGING_DEPLOY_POSTCHECK_NUMERIC.json"), {
    environment: "staging",
    tenantId: "SMOKE_TENANT",
    date: "2026-03-13T12:06:00.000Z",
    gitTag: "sha-abcdef9",
    runUrl: "https://github.com/example/pim1/actions/runs/123456790",
    suite: "STAGING_DEPLOY_POSTCHECK",
  });

  writeJson(path.join(rolloutDir, "2026-03-13T12-06-30.000Z_CONTROLLED_ROLLOUT_SNAPSHOT_NUMERIC.json"), {
    capturedAt: "2026-03-13T12:06:30.000Z",
    environment: "staging",
    tenantId: "SMOKE_TENANT",
    apiBase: "https://staging.example.com/api/v1",
    health: {
      ok: true,
      status: 200,
      body: { status: "ok", env: "staging" },
      error: null,
    },
    controlledRollout: {
      pending: [],
    },
    broadRollout: {
      pending: [
        "14-day controlled rollout observation window not complete.",
      ],
    },
  });

  const numericRun = runValidator(["--artifactDir", artifactDir, "--tenantId", "SMOKE_TENANT"], tempRoot);
  assert(
    numericRun.status === 0,
    `Expected validator pass with numeric health.status, got status=${numericRun.status} stderr=${numericRun.stderr}`,
  );
  const numericJson = JSON.parse(numericRun.stdout);
  assert(numericJson.rolloutSnapshot.health.status === 200, "Expected numeric health.status to be preserved");

  writeJson(path.join(gatesDir, "2026-03-13T12-10-00.000Z_STAGING_DEPLOY_POSTCHECK_BAD.json"), {
    environment: "staging",
    tenantId: "SMOKE_TENANT",
    date: "2026-03-13T12:10:00.000Z",
    gitTag: "sha-abcdef2",
    runUrl: "local://not-a-live-run",
    suite: "STAGING_DEPLOY_POSTCHECK",
  });

  const failRun = runValidator(["--artifactDir", artifactDir, "--tenantId", "SMOKE_TENANT"], tempRoot);
  assert(failRun.status !== 0, "Expected validator to fail when latest runUrl is not a live GitHub Actions URL");
  assert(
    /Gate artifact runUrl is not a live GitHub Actions URL/.test(failRun.stderr),
    `Unexpected failure output: ${failRun.stderr}`,
  );

  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log("validate-live-staging-evidence.test.cjs: PASS");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
