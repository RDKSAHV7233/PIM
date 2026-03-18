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
    gatesDir: GATES_DIR,
    rolloutDir: OUTPUT_DIR,
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
      case "--gatesDir":
        parsed.gatesDir = path.resolve(String(args.shift() || parsed.gatesDir).trim());
        break;
      case "--rolloutDir":
        parsed.rolloutDir = path.resolve(String(args.shift() || parsed.rolloutDir).trim());
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

function loadGateArtifacts(environment, sinceUtcMs, gatesDir = GATES_DIR) {
  if (!fs.existsSync(gatesDir)) {
    return [];
  }
  const entries = fs
    .readdirSync(gatesDir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => {
      const fullPath = path.join(gatesDir, name);
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

function loadArtifacts(gatesDir = GATES_DIR, sinceUtcMs = null) {
  if (!fs.existsSync(gatesDir)) {
    return [];
  }
  return fs
    .readdirSync(gatesDir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => {
      const fullPath = path.join(gatesDir, name);
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
    .filter((item) => item.dateMs !== null && (sinceUtcMs === null || item.dateMs >= sinceUtcMs))
    .sort((left, right) => (right.dateMs || 0) - (left.dateMs || 0));
}

function loadRolloutSnapshots(environment, sinceUtcMs, rolloutDir) {
  if (!fs.existsSync(rolloutDir)) {
    return [];
  }

  return fs
    .readdirSync(rolloutDir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => {
      const fullPath = path.join(rolloutDir, name);
      const parsed = parseJsonFile(fullPath);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      const environmentText = String(parsed.environment || "").trim().toLowerCase();
      if (!environmentText || environmentText !== environment) {
        return null;
      }
      const capturedAt = String(parsed.capturedAt || "").trim();
      const capturedAtMs = Date.parse(capturedAt);
      if (!Number.isFinite(capturedAtMs) || capturedAtMs < sinceUtcMs) {
        return null;
      }
      return {
        name,
        path: fullPath,
        snapshot: parsed,
        capturedAt,
        capturedAtMs,
      };
    })
    .filter((item) => item !== null)
    .sort((left, right) => (right.capturedAtMs || 0) - (left.capturedAtMs || 0));
}

function extractConsecutiveE10Runs(artifacts) {
  const e10Runs = artifacts.filter((entry) => {
    const suite = String(entry.artifact.suite || "");
    return suite.startsWith("E10-ST-QA-001");
  });
  return e10Runs.slice(0, 2).length;
}

function hasArtifact(artifacts, pattern) {
  const matcher = new RegExp(pattern, "i");
  return artifacts.some((entry) => matcher.test(entry.name) || matcher.test(String(entry.artifact.suite || "")));
}

function toUtcDayString(dateValue) {
  return new Date(dateValue).toISOString().slice(0, 10);
}

function countDistinctUtcDays(entries, getDateValue) {
  const days = new Set();
  for (const entry of entries) {
    const value = getDateValue(entry);
    if (value === null || value === undefined) {
      continue;
    }
    const dateMs = typeof value === "number" ? value : Date.parse(String(value));
    if (!Number.isFinite(dateMs)) {
      continue;
    }
    days.add(toUtcDayString(dateMs));
  }
  return days;
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
  const signoffArtifacts = loadGateArtifacts(args.environment, since.getTime(), args.gatesDir);
  const allArtifactsInWindow = loadArtifacts(args.gatesDir, since.getTime());
  const allRecordedArtifacts = loadArtifacts(args.gatesDir);
  const historicalRolloutSnapshots = loadRolloutSnapshots(args.environment, since.getTime(), args.rolloutDir);
  const consecutiveE10 = extractConsecutiveE10Runs(signoffArtifacts);
  const health = await fetchHealth(args.apiBase, args.timeoutMs);
  const reportedEnv = String(health?.body?.env || "").trim().toLowerCase();
  const healthEndpointHealthy = health.ok === true && reportedEnv === args.environment;
  const observationWindowDays = countDistinctUtcDays(signoffArtifacts, (entry) => entry.dateMs);
  const sloWindowDays = countDistinctUtcDays(historicalRolloutSnapshots, (entry) => entry.capturedAtMs);
  sloWindowDays.add(toUtcDayString(now.getTime()));

  const snapshot = {
    capturedAt: now.toISOString(),
    environment: args.environment,
    tenantId: args.tenantId,
    apiBase: args.apiBase,
    windowDays: args.windowDays,
    health,
    gates: {
      artifactsInWindow: signoffArtifacts.length,
      allEvidenceArtifactsInWindow: allArtifactsInWindow.length,
      consecutiveE10SignoffRuns: consecutiveE10,
      recentArtifacts: signoffArtifacts.slice(0, 10).map(toSummary),
    },
    controlledRollout: {
      criteria: {
        twoConsecutiveGates: consecutiveE10 >= 2,
        pilotWorkflowEvidencePresent: hasArtifact(allRecordedArtifacts, "PILOT_WORKFLOW_VALIDATION"),
        governanceEvidencePresent: hasArtifact(allRecordedArtifacts, "PAYLOAD_GOVERNANCE_ENFORCE"),
        healthEndpointHealthy,
      },
      pending: [],
    },
    broadRollout: {
      criteria: {
        observationWindowDaysCovered: observationWindowDays.size,
        observationWindowDaysRequired: args.windowDays,
        observationWindowComplete: observationWindowDays.size >= args.windowDays,
        sloTrendDaysCovered: sloWindowDays.size,
        sloTrendDaysRequired: args.windowDays,
        sloTrendWindowComplete: sloWindowDays.size >= args.windowDays,
      },
      pending: [],
    },
  };

  if (!snapshot.controlledRollout.criteria.twoConsecutiveGates) {
    snapshot.controlledRollout.pending.push("Need at least 2 consecutive E10 gate signoff artifacts.");
  }
  if (!snapshot.controlledRollout.criteria.pilotWorkflowEvidencePresent) {
    snapshot.controlledRollout.pending.push("Pilot workflow validation artifact missing from recorded evidence.");
  }
  if (!snapshot.controlledRollout.criteria.governanceEvidencePresent) {
    snapshot.controlledRollout.pending.push("Payload governance enforcement artifact missing from recorded evidence.");
  }
  if (!snapshot.controlledRollout.criteria.healthEndpointHealthy) {
    if (!health.ok) {
      snapshot.controlledRollout.pending.push(
        `Health endpoint unavailable or non-200 for '${snapshot.environment}' rollout snapshot.`,
      );
    } else if (reportedEnv !== snapshot.environment) {
      snapshot.controlledRollout.pending.push(
        `Health endpoint env mismatch: expected '${snapshot.environment}', got '${reportedEnv || "unset"}'.`,
      );
    } else {
      snapshot.controlledRollout.pending.push(
        `Health endpoint did not provide a valid '${snapshot.environment}' environment marker.`,
      );
    }
  }
  if (!snapshot.broadRollout.criteria.observationWindowComplete) {
    snapshot.broadRollout.pending.push(
      `Controlled rollout observation window covers ${snapshot.broadRollout.criteria.observationWindowDaysCovered} of ${snapshot.broadRollout.criteria.observationWindowDaysRequired} required days.`,
    );
  }
  if (!snapshot.broadRollout.criteria.sloTrendWindowComplete) {
    snapshot.broadRollout.pending.push(
      `Production SLO trend evidence covers ${snapshot.broadRollout.criteria.sloTrendDaysCovered} of ${snapshot.broadRollout.criteria.sloTrendDaysRequired} required days.`,
    );
  }

  fs.mkdirSync(args.rolloutDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:]/g, "-");
  const outputPath = path.join(args.rolloutDir, `${stamp}_CONTROLLED_ROLLOUT_SNAPSHOT.json`);
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
