#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const args = {
    artifactDir: "",
    gatesDir: "",
    rolloutDir: "",
    environment: "staging",
    tenantId: "",
    suite: "STAGING_DEPLOY_POSTCHECK",
    allowBroadPending: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    switch (token) {
      case "--artifactDir":
        args.artifactDir = next;
        index += 1;
        break;
      case "--gatesDir":
        args.gatesDir = next;
        index += 1;
        break;
      case "--rolloutDir":
        args.rolloutDir = next;
        index += 1;
        break;
      case "--environment":
        args.environment = next;
        index += 1;
        break;
      case "--tenantId":
        args.tenantId = next;
        index += 1;
        break;
      case "--suite":
        args.suite = next;
        index += 1;
        break;
      case "--strictBroad":
        args.allowBroadPending = false;
        break;
      default:
        break;
    }
  }

  return args;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function collectJsonFiles(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return [];
  }

  const results = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".json")) {
        results.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return results;
}

function parseJsonFiles(filePaths) {
  return filePaths.map((filePath) => ({
    filePath,
    name: path.basename(filePath),
    json: JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")),
  }));
}

function chooseLatest(entries, dateField) {
  return [...entries].sort((left, right) => {
    const leftValue = Date.parse(String(left.json?.[dateField] ?? ""));
    const rightValue = Date.parse(String(right.json?.[dateField] ?? ""));
    return rightValue - leftValue;
  })[0];
}

function isGithubRunUrl(value) {
  return /^https:\/\/github\.com\/.+\/actions\/runs\/\d+$/i.test(String(value ?? "").trim());
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "..");
  const artifactDir = args.artifactDir ? path.resolve(repoRoot, args.artifactDir) : "";
  const gatesDir = artifactDir
    ? artifactDir
    : path.resolve(repoRoot, args.gatesDir || "docs/execution/gates");
  const rolloutDir = artifactDir
    ? artifactDir
    : path.resolve(repoRoot, args.rolloutDir || "docs/execution/rollout");

  const allGateJson = parseJsonFiles(collectJsonFiles(gatesDir)).filter((entry) => {
    const json = entry.json;
    return json && typeof json === "object" && typeof json.suite === "string";
  });
  const allRolloutJson = parseJsonFiles(collectJsonFiles(rolloutDir)).filter((entry) => {
    const json = entry.json;
    return json && typeof json === "object" && typeof json.capturedAt === "string";
  });

  const gateCandidates = allGateJson.filter((entry) => {
    const json = entry.json;
    const matchesEnvironment = String(json.environment ?? "") === args.environment;
    const matchesTenant = !args.tenantId || String(json.tenantId ?? "") === args.tenantId;
    const matchesSuite = String(json.suite ?? "") === args.suite;
    return matchesEnvironment && matchesTenant && matchesSuite;
  });

  assert(
    gateCandidates.length > 0,
    `No gate artifact found for suite=${args.suite}, environment=${args.environment}${args.tenantId ? `, tenantId=${args.tenantId}` : ""}`,
  );

  const latestGate = chooseLatest(gateCandidates, "date");
  assert(latestGate, "Unable to select latest gate artifact");
  assert(isGithubRunUrl(latestGate.json.runUrl), `Gate artifact runUrl is not a live GitHub Actions URL: ${latestGate.json.runUrl}`);
  assert(String(latestGate.json.gitTag ?? "").startsWith("sha-"), `Gate artifact missing gitTag sha prefix: ${latestGate.json.gitTag}`);

  const rolloutCandidates = allRolloutJson.filter((entry) => {
    const json = entry.json;
    const matchesEnvironment = String(json.environment ?? "") === args.environment;
    const matchesTenant = !args.tenantId || String(json.tenantId ?? "") === args.tenantId;
    return matchesEnvironment && matchesTenant;
  });

  assert(
    rolloutCandidates.length > 0,
    `No rollout snapshot found for environment=${args.environment}${args.tenantId ? `, tenantId=${args.tenantId}` : ""}`,
  );

  const latestRollout = chooseLatest(rolloutCandidates, "capturedAt");
  assert(latestRollout, "Unable to select latest rollout snapshot");
  assert(latestRollout.json.health?.ok === true, "Rollout snapshot health.ok is not true");
  assert(String(latestRollout.json.health?.status ?? "").toLowerCase() === "ok", `Rollout snapshot health.status is not ok: ${latestRollout.json.health?.status}`);
  assert(
    Array.isArray(latestRollout.json.controlledRollout?.pending) && latestRollout.json.controlledRollout.pending.length === 0,
    `Controlled rollout still has pending blockers: ${(latestRollout.json.controlledRollout?.pending || []).join("; ")}`,
  );

  const broadPending = Array.isArray(latestRollout.json.broadRollout?.pending)
    ? latestRollout.json.broadRollout.pending
    : [];

  if (!args.allowBroadPending) {
    assert(broadPending.length === 0, `Broad rollout still has pending blockers: ${broadPending.join("; ")}`);
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        mode: args.allowBroadPending ? "controlled_ready_evidence" : "broad_ready_evidence",
        environment: args.environment,
        tenantId: args.tenantId || latestGate.json.tenantId,
        gateArtifact: {
          file: latestGate.name,
          suite: latestGate.json.suite,
          runUrl: latestGate.json.runUrl,
          date: latestGate.json.date,
          gitTag: latestGate.json.gitTag,
        },
        rolloutSnapshot: {
          file: latestRollout.name,
          capturedAt: latestRollout.json.capturedAt,
          apiBase: latestRollout.json.apiBase,
          health: latestRollout.json.health,
        },
        broadPending,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
