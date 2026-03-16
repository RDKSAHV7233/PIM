#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const childProcess = require("node:child_process");

const SCRIPT_PATH = path.resolve(__dirname, "capture-controlled-rollout-snapshot.cjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isoAtDayOffset(baseDate, offsetDays, hour = 12) {
  const copy = new Date(baseDate.getTime());
  copy.setUTCDate(copy.getUTCDate() + offsetDays);
  copy.setUTCHours(hour, 0, 0, 0);
  return copy.toISOString();
}

function runSnapshot(args, cwd) {
  return childProcess.spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd,
    encoding: "utf8",
  });
}

async function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          env: "staging",
          queueRuntime: {
            backend: "bullmq",
            workerEnabled: true,
          },
        }),
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "not_found" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    apiBase: `http://127.0.0.1:${address.port}/api/v1`,
  };
}

function seedWindow(gatesDir, rolloutDir, baseDate, gateDays, rolloutDays) {
  for (let index = 0; index < gateDays.length; index += 1) {
    const offset = gateDays[index];
    const date = isoAtDayOffset(baseDate, offset, 9 + (index % 8));
    writeJson(path.join(gatesDir, `${date.replace(/[:]/g, "-")}_STAGING_DEPLOY_POSTCHECK_${index}.json`), {
      environment: "staging",
      tenantId: "staging-smoke",
      date,
      gitTag: `sha-gate${index}`,
      runUrl: `https://github.com/example/pim1/actions/runs/${1000 + index}`,
      suite: "STAGING_DEPLOY_POSTCHECK",
    });
  }

  writeJson(path.join(gatesDir, "2026-03-03T19-52-18_PILOT_WORKFLOW_VALIDATION.json"), {
    environment: "staging",
    tenantId: "staging-smoke",
    date: isoAtDayOffset(baseDate, -13, 19),
    gitTag: "sha-pilot",
    runUrl: "https://github.com/example/pim1/actions/runs/2001",
    suite: "PILOT_WORKFLOW_VALIDATION",
  });

  writeJson(path.join(gatesDir, "2026-03-03T19-53-20_PAYLOAD_GOVERNANCE_ENFORCE.json"), {
    environment: "staging",
    tenantId: "staging-smoke",
    date: isoAtDayOffset(baseDate, -13, 20),
    gitTag: "sha-gov",
    runUrl: "https://github.com/example/pim1/actions/runs/2002",
    suite: "PAYLOAD_GOVERNANCE_ENFORCE",
  });

  writeJson(path.join(gatesDir, "2026-03-03T14-21-45.470Z_E10-ST-QA-001-RUN1.json"), {
    environment: "staging",
    tenantId: "staging-smoke",
    date: isoAtDayOffset(baseDate, -13, 14),
    gitTag: "sha-e10-1",
    runUrl: "https://github.com/example/pim1/actions/runs/3001",
    suite: "E10-ST-QA-001-RUN1",
  });

  writeJson(path.join(gatesDir, "2026-03-03T14-21-50.328Z_E10-ST-QA-001-RUN2.json"), {
    environment: "staging",
    tenantId: "staging-smoke",
    date: isoAtDayOffset(baseDate, -12, 14),
    gitTag: "sha-e10-2",
    runUrl: "https://github.com/example/pim1/actions/runs/3002",
    suite: "E10-ST-QA-001-RUN2",
  });

  for (let index = 0; index < rolloutDays.length; index += 1) {
    const offset = rolloutDays[index];
    const capturedAt = isoAtDayOffset(baseDate, offset, 10 + (index % 8));
    writeJson(path.join(rolloutDir, `${capturedAt.replace(/[:]/g, "-")}_CONTROLLED_ROLLOUT_SNAPSHOT.json`), {
      capturedAt,
      environment: "staging",
      tenantId: "staging-smoke",
      apiBase: "https://staging.example.com/api/v1",
      windowDays: 14,
      health: {
        ok: true,
        status: 200,
        body: { status: "ok", env: "staging" },
      },
      gates: {
        artifactsInWindow: gateDays.length,
        allEvidenceArtifactsInWindow: gateDays.length + 4,
        consecutiveE10SignoffRuns: 2,
      },
      controlledRollout: {
        criteria: {
          twoConsecutiveGates: true,
          pilotWorkflowEvidencePresent: true,
          governanceEvidencePresent: true,
          healthEndpointHealthy: true,
        },
        pending: [],
      },
      broadRollout: {
        criteria: {},
        pending: [],
      },
    });
  }
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pim1-rollout-"));
  const gatesDir = path.join(tempRoot, "gates");
  const rolloutDir = path.join(tempRoot, "rollout");
  const baseDate = new Date("2026-03-16T04:31:32.714Z");
  const { server, apiBase } = await startHealthServer();

  try {
    seedWindow(gatesDir, rolloutDir, baseDate, [-13, -12, -11, -10, -9], [-13, -12, -11, -10, -9]);
    const insufficientRun = runSnapshot(
      [
        "--environment",
        "staging",
        "--tenantId",
        "staging-smoke",
        "--apiBase",
        apiBase,
        "--windowDays",
        "14",
        "--gatesDir",
        gatesDir,
        "--rolloutDir",
        rolloutDir,
      ],
      tempRoot,
    );
    assert(
      insufficientRun.status === 0,
      `Expected insufficient-window snapshot to succeed, got status=${insufficientRun.status} stderr=${insufficientRun.stderr}`,
    );
    const insufficientJson = JSON.parse(insufficientRun.stdout);
    assert(
      insufficientJson.summary.broadPending.includes("Controlled rollout observation window covers 5 of 14 required days."),
      `Expected computed observation-window message, got ${insufficientRun.stdout}`,
    );
    assert(
      insufficientJson.summary.broadPending.includes("Production SLO trend evidence covers 6 of 14 required days."),
      `Expected computed broad pending coverage message, got ${insufficientRun.stdout}`,
    );

    fs.rmSync(gatesDir, { recursive: true, force: true });
    fs.rmSync(rolloutDir, { recursive: true, force: true });

    const fullGateDays = Array.from({ length: 14 }, (_, index) => index - 13);
    const fullRolloutDays = Array.from({ length: 13 }, (_, index) => index - 13);
    seedWindow(gatesDir, rolloutDir, baseDate, fullGateDays, fullRolloutDays);
    const completeRun = runSnapshot(
      [
        "--environment",
        "staging",
        "--tenantId",
        "staging-smoke",
        "--apiBase",
        apiBase,
        "--windowDays",
        "14",
        "--gatesDir",
        gatesDir,
        "--rolloutDir",
        rolloutDir,
      ],
      tempRoot,
    );
    assert(
      completeRun.status === 0,
      `Expected complete-window snapshot to succeed, got status=${completeRun.status} stderr=${completeRun.stderr}`,
    );
    const completeJson = JSON.parse(completeRun.stdout);
    assert(
      Array.isArray(completeJson.summary.broadPending) && completeJson.summary.broadPending.length === 0,
      `Expected no broad pending blockers once coverage is complete, got ${completeRun.stdout}`,
    );

    console.log("capture-controlled-rollout-snapshot.test.cjs: PASS");
  } finally {
    server.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
