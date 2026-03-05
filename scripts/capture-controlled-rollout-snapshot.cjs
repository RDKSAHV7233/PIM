#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const GATES_DIR = path.join(ROOT, "docs", "execution", "gates");
const OUTPUT_DIR = path.join(ROOT, "docs", "execution", "rollout");

function parseArgs(argv) {
  const args = [...argv];
  const parsed = {
    apiBase: process.env.PIM_API_BASE_URL || "http://127.0.0.1:4000/api/v1",
    environment: String(process.env.APP_ENV || "development").trim().toLowerCase(),
    tenantId: "SMOKE_TENANT_LOCAL",
    windowDays: 14,
    timeoutMs: 5000,
  };
  while (args.length > 0) {
    const token = args.shift();
    switch (token) {
      case "--apiBase":
        parsed.apiBase = String(args.shift() || parsed.apiBase).trim();
        break;
      case "--environment":
        parsed.environment = String(args.shift() || parsed.environment).trim().toLowerCase();
        break;
      case "--tenantId":
        parsed.tenantId = String(args.shift() || parsed.tenantId).trim();
        break;
      case "--windowDays":
        parsed.windowDays = Number.parseInt(String(args.shift() || parsed.windowDays), 10);
        break;
      case "--timeoutMs":
        parsed.timeoutMs = Number.parseInt(String(args.shift() || parsed.timeoutMs), 10);
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!parsed.apiBase) {
    throw new Error("Missing --apiBase.");
  }
  if (!Number.isFinite(parsed.windowDays) || parsed.windowDays <= 0) {
    throw new Error("windowDays must be a positive integer.");
  }
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive integer.");
  }
  return parsed;
}

function parseJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const sanitized = raw.replace(/^\uFEFF/, "").trim();
    return JSON.parse(sanitized);
  } catch {
    return null;
  }
}

function loadGateArtifacts(environment, sinceUtcMs) {
  if (!fs.existsSync(GATES_DIR)) {
    return [];
  }
  const entries = fs
    .readdirSync(GATES_DIR)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => {
      const fullPath = path.join(GATES_DIR, name);
      const parsed = parseJsonFile(fullPath);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      const dateText = String(parsed.date || "").trim();
      const dateMs = Date.parse(dateText);
      return {
        name,
        path: fullPath,
        artifact: parsed,
        dateText,
        dateMs: Number.isFinite(dateMs) ? dateMs : null,
      };
    })
    .filter((item) => item !== null)
    .filter((item) => {
      const artifactEnv = String(item.artifact.environment || "").trim().toLowerCase();
      if (!artifactEnv || artifactEnv !== environment) {
        return false;
      }
      if (item.dateMs === null) {
        return false;
      }
      return item.dateMs >= sinceUtcMs;
    })
    .sort((left, right) => (right.dateMs || 0) - (left.dateMs || 0));

  return entries;
}

function loadAllArtifactsInWindow(sinceUtcMs) {
  if (!fs.existsSync(GATES_DIR)) {
    return [];
  }
  return fs
    .readdirSync(GATES_DIR)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => {
      const fullPath = path.join(GATES_DIR, name);
      const parsed = parseJsonFile(fullPath);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      const primaryDate = String(parsed.date || parsed.checkedAt || "").trim();
      const dateMs = Date.parse(primaryDate);
      return {
        name,
        path: fullPath,
        artifact: parsed,
        dateText: primaryDate,
        dateMs: Number.isFinite(dateMs) ? dateMs : null,
      };
    })
    .filter((item) => item !== null)
    .filter((item) => item.dateMs !== null && item.dateMs >= sinceUtcMs)
    .sort((left, right) => (right.dateMs || 0) - (left.dateMs || 0));
}

function extractConsecutiveE10Runs(artifacts) {
  let count = 0;
  for (const entry of artifacts) {
    const suite = String(entry.artifact.suite || "");
    if (suite.startsWith("E10-ST-QA-001")) {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

function hasArtifact(artifacts, pattern) {
  const matcher = new RegExp(pattern, "i");
  return artifacts.some((entry) => matcher.test(entry.name) || matcher.test(String(entry.artifact.suite || "")));
}

async function fetchHealth(apiBase, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBase.replace(/\/$/, "")}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function toSummary(entry) {
  return {
    file: entry.name,
    suite: String(entry.artifact.suite || ""),
    tenantId: String(entry.artifact.tenantId || ""),
    date: String(entry.artifact.date || ""),
    runUrl: String(entry.artifact.runUrl || ""),
    gitTag: String(entry.artifact.gitTag || ""),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const since = new Date(now.getTime() - args.windowDays * 24 * 60 * 60 * 1000);
  const signoffArtifacts = loadGateArtifacts(args.environment, since.getTime());
  const allArtifacts = loadAllArtifactsInWindow(since.getTime());
  const consecutiveE10 = extractConsecutiveE10Runs(signoffArtifacts);
  const health = await fetchHealth(args.apiBase, args.timeoutMs);

  const snapshot = {
    capturedAt: now.toISOString(),
    environment: args.environment,
    tenantId: args.tenantId,
    apiBase: args.apiBase,
    windowDays: args.windowDays,
    health,
    gates: {
      artifactsInWindow: signoffArtifacts.length,
      allEvidenceArtifactsInWindow: allArtifacts.length,
      consecutiveE10SignoffRuns: consecutiveE10,
      recentArtifacts: signoffArtifacts.slice(0, 10).map(toSummary),
    },
    controlledRollout: {
      criteria: {
        twoConsecutiveGates: consecutiveE10 >= 2,
        pilotWorkflowEvidencePresent: hasArtifact(allArtifacts, "PILOT_WORKFLOW_VALIDATION"),
        governanceEvidencePresent: hasArtifact(allArtifacts, "PAYLOAD_GOVERNANCE_ENFORCE"),
      },
      pending: [],
    },
    broadRollout: {
      pending: [
        "14-day controlled rollout observation window not complete.",
        "Production SLO trend evidence window not complete.",
      ],
    },
  };

  if (!snapshot.controlledRollout.criteria.twoConsecutiveGates) {
    snapshot.controlledRollout.pending.push("Need at least 2 consecutive E10 gate signoff artifacts.");
  }
  if (!snapshot.controlledRollout.criteria.pilotWorkflowEvidencePresent) {
    snapshot.controlledRollout.pending.push("Pilot workflow validation artifact missing in current window.");
  }
  if (!snapshot.controlledRollout.criteria.governanceEvidencePresent) {
    snapshot.controlledRollout.pending.push("Payload governance enforcement artifact missing in current window.");
  }
  const reportedEnv = String(snapshot.health?.body?.env || "").trim().toLowerCase();
  if (reportedEnv && reportedEnv !== snapshot.environment) {
    snapshot.controlledRollout.pending.push(
      `Health endpoint env mismatch: expected '${snapshot.environment}', got '${reportedEnv}'.`,
    );
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = now.toISOString().replace(/[:]/g, "-");
  const outputPath = path.join(OUTPUT_DIR, `${stamp}_CONTROLLED_ROLLOUT_SNAPSHOT.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outputPath,
        summary: {
          environment: snapshot.environment,
          artifactsInWindow: snapshot.gates.artifactsInWindow,
          consecutiveE10SignoffRuns: snapshot.gates.consecutiveE10SignoffRuns,
          healthOk: Boolean(snapshot.health && snapshot.health.ok),
          controlledPending: snapshot.controlledRollout.pending,
          broadPending: snapshot.broadRollout.pending,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
