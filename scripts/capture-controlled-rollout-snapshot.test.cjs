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
  return new Promise((resolve) => {
    const child = childProcess.spawn(process.execPath, [SCRIPT_PATH, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code, signal) => {
      resolve({
        status: typeof code === "number" ? code : 1,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

async function startHealthServer(options = {}) {
  const state = {
    loginRequests: [],
    failedQueueRequests: [],
  };
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, "http://127.0.0.1");
    if (requestUrl.pathname === "/api/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          env: "staging",
          queueRuntime: {
            backend: "bullmq",
            workerEnabled: true,
          },
          queues: options.queues ?? {},
        }),
      );
      return;
    }

    if (requestUrl.pathname === "/api/v1/auth/login" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += String(chunk);
      });
      req.on("end", () => {
        const payload = JSON.parse(body || "{}");
        state.loginRequests.push(payload);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ accessToken: options.accessToken || "staging-admin-token" }));
      });
      return;
    }

    if (requestUrl.pathname === "/api/v1/queue/account-export/lanes/default/failed" && req.method === "GET") {
      state.failedQueueRequests.push({
        authorization: req.headers.authorization || "",
        limit: requestUrl.searchParams.get("limit"),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ items: options.failedQueueItems || [] }));
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
    state,
  };
}

function seedWindow(gatesDir, rolloutDir, baseDate, gateDays, rolloutDays, options = {}) {
  const pilotOffsetDays = Number.isInteger(options.pilotOffsetDays) ? options.pilotOffsetDays : -13;
  const governanceOffsetDays = Number.isInteger(options.governanceOffsetDays) ? options.governanceOffsetDays : -13;
  const e10OffsetDays =
    Array.isArray(options.e10OffsetDays) && options.e10OffsetDays.length >= 2 ? options.e10OffsetDays : [-13, -12];

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
    date: isoAtDayOffset(baseDate, pilotOffsetDays, 19),
    gitTag: "sha-pilot",
    runUrl: "https://github.com/example/pim1/actions/runs/2001",
    suite: "PILOT_WORKFLOW_VALIDATION",
  });

  writeJson(path.join(gatesDir, "2026-03-03T19-53-20_PAYLOAD_GOVERNANCE_ENFORCE.json"), {
    environment: "staging",
    tenantId: "staging-smoke",
    date: isoAtDayOffset(baseDate, governanceOffsetDays, 20),
    gitTag: "sha-gov",
    runUrl: "https://github.com/example/pim1/actions/runs/2002",
    suite: "PAYLOAD_GOVERNANCE_ENFORCE",
  });

  writeJson(path.join(gatesDir, "2026-03-03T14-21-45.470Z_E10-ST-QA-001-RUN1.json"), {
    environment: "staging",
    tenantId: "staging-smoke",
    date: isoAtDayOffset(baseDate, e10OffsetDays[0], 14),
    gitTag: "sha-e10-1",
    runUrl: "https://github.com/example/pim1/actions/runs/3001",
    suite: "E10-ST-QA-001-RUN1",
  });

  writeJson(path.join(gatesDir, "2026-03-03T14-21-50.328Z_E10-ST-QA-001-RUN2.json"), {
    environment: "staging",
    tenantId: "staging-smoke",
    date: isoAtDayOffset(baseDate, e10OffsetDays[1], 14),
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
  const baseDate = new Date();
  const { server, apiBase } = await startHealthServer();

  try {
    seedWindow(gatesDir, rolloutDir, baseDate, [-13, -12, -11, -10, -9], [-13, -12, -11, -10, -9]);
    const insufficientRun = await runSnapshot(
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
    assert(
      Array.isArray(insufficientJson.summary.controlledPending) && insufficientJson.summary.controlledPending.length === 0,
      `Expected no controlled blockers when pilot/governance evidence exists, got ${insufficientRun.stdout}`,
    );

    fs.rmSync(gatesDir, { recursive: true, force: true });
    fs.rmSync(rolloutDir, { recursive: true, force: true });

    seedWindow(gatesDir, rolloutDir, baseDate, [-13, -12, -11, -10, -9], [-13, -12, -11, -10, -9], {
      pilotOffsetDays: -20,
      governanceOffsetDays: -20,
    });
    const historicalEvidenceRun = await runSnapshot(
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
      historicalEvidenceRun.status === 0,
      `Expected historical-evidence snapshot to succeed, got status=${historicalEvidenceRun.status} stderr=${historicalEvidenceRun.stderr}`,
    );
    const historicalEvidenceJson = JSON.parse(historicalEvidenceRun.stdout);
    assert(
      Array.isArray(historicalEvidenceJson.summary.controlledPending) && historicalEvidenceJson.summary.controlledPending.length === 0,
      `Expected pilot/governance evidence to remain valid outside the broad window, got ${historicalEvidenceRun.stdout}`,
    );
    assert(
      historicalEvidenceJson.summary.broadPending.includes("Controlled rollout observation window covers 5 of 14 required days."),
      `Expected broad coverage warning to remain time-bound, got ${historicalEvidenceRun.stdout}`,
    );

    fs.rmSync(gatesDir, { recursive: true, force: true });
    fs.rmSync(rolloutDir, { recursive: true, force: true });

    seedWindow(gatesDir, rolloutDir, baseDate, [-13, -12, -11, -10, -9], [-13, -12, -11, -10, -9], {
      pilotOffsetDays: -20,
      governanceOffsetDays: -20,
      e10OffsetDays: [-21, -20],
    });
    const evergreenE10Run = await runSnapshot(
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
      evergreenE10Run.status === 0,
      `Expected evergreen-E10 snapshot to succeed, got status=${evergreenE10Run.status} stderr=${evergreenE10Run.stderr}`,
    );
    const evergreenE10Json = JSON.parse(evergreenE10Run.stdout);
    assert(
      evergreenE10Json.summary.consecutiveE10SignoffRuns === 2,
      `Expected historical E10 continuity to remain satisfied once recorded, got ${evergreenE10Run.stdout}`,
    );
    assert(
      Array.isArray(evergreenE10Json.summary.controlledPending) && evergreenE10Json.summary.controlledPending.length === 0,
      `Expected no controlled blockers when only broad-window evidence is pending, got ${evergreenE10Run.stdout}`,
    );

    fs.rmSync(gatesDir, { recursive: true, force: true });
    fs.rmSync(rolloutDir, { recursive: true, force: true });

    const fullGateDays = Array.from({ length: 14 }, (_, index) => index - 13);
    const fullRolloutDays = Array.from({ length: 13 }, (_, index) => index - 13);
    seedWindow(gatesDir, rolloutDir, baseDate, fullGateDays, fullRolloutDays);
    const completeRun = await runSnapshot(
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

    const failedQueueHealth = await startHealthServer({
      queues: {
        "account-export": {
          waiting: 0,
          active: 0,
          failed: 4,
          lanes: {
            default: {
              waiting: 0,
              active: 0,
              failed: 4,
              pausedUntil: null,
            },
          },
        },
      },
      failedQueueItems: [
        {
          id: "job-1",
          name: "account-export:default",
          failedReason: "Cloudflare R2 bucket not found.",
          attemptsMade: 3,
          timestamp: "2026-05-22T21:00:00.000Z",
          processedOn: "2026-05-22T21:00:03.000Z",
          finishedOn: "2026-05-22T21:00:04.000Z",
        },
      ],
    });
    try {
      const diagnosticsOutputPath = path.join(tempRoot, ".run-logs", "queue-failure-diagnostics.json");
      const failedQueueRun = await runSnapshot(
        [
          "--environment",
          "staging",
          "--tenantId",
          "staging-smoke",
          "--apiBase",
          failedQueueHealth.apiBase,
          "--windowDays",
          "14",
          "--gatesDir",
          gatesDir,
          "--rolloutDir",
          rolloutDir,
          "--workspaceSlug",
          "default",
          "--smokeUser",
          "admin@vexa-pim.local",
          "--smokePassword",
          "super-secret-password",
          "--diagnosticOutputPath",
          diagnosticsOutputPath,
        ],
        tempRoot,
      );
      assert(
        failedQueueRun.status === 0,
        `Expected failed-queue snapshot to succeed with pending evidence, got status=${failedQueueRun.status} stderr=${failedQueueRun.stderr}`,
      );
      const failedQueueJson = JSON.parse(failedQueueRun.stdout);
      assert(
        failedQueueJson.summary.controlledPending.includes("Queue failures remain in health snapshot: account-export=4."),
        `Expected queue failure to block controlled rollout evidence, got ${failedQueueRun.stdout}`,
      );
      assert(
        failedQueueJson.summary.queueFailureDiagnostics &&
          failedQueueJson.summary.queueFailureDiagnostics.captured === true &&
          failedQueueJson.summary.queueFailureDiagnostics.authenticated === true,
        `Expected queue failure diagnostics capture summary, got ${failedQueueRun.stdout}`,
      );
      assert(fs.existsSync(diagnosticsOutputPath), "Expected queue failure diagnostics artifact to be written");
      const diagnosticsArtifact = JSON.parse(fs.readFileSync(diagnosticsOutputPath, "utf8"));
      assert(
        Array.isArray(diagnosticsArtifact.queues) &&
          diagnosticsArtifact.queues[0]?.lanes?.[0]?.items?.[0]?.failedReason === "Cloudflare R2 bucket not found.",
        `Expected failed job summaries in diagnostics artifact, got ${JSON.stringify(diagnosticsArtifact)}`,
      );
      assert(
        failedQueueHealth.state.loginRequests.length === 1 &&
          failedQueueHealth.state.loginRequests[0].workspaceSlug === "default",
        `Expected diagnostics capture to authenticate with the smoke workspace, got ${JSON.stringify(failedQueueHealth.state.loginRequests)}`,
      );
      assert(
        failedQueueHealth.state.failedQueueRequests.length === 1 &&
          failedQueueHealth.state.failedQueueRequests[0].authorization === "Bearer staging-admin-token",
        `Expected diagnostics capture to call failed-queue route with bearer auth, got ${JSON.stringify(failedQueueHealth.state.failedQueueRequests)}`,
      );
    } finally {
      failedQueueHealth.server.close();
    }

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
