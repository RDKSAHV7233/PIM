#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "docs", "execution", "gates");

function parseArgs(argv) {
  const args = [...argv];
  const parsed = {
    suite: "",
    tenantId: "",
    runUrl: "",
    gitTag: "",
  };
  while (args.length > 0) {
    const token = args.shift();
    switch (token) {
      case "--suite":
        parsed.suite = String(args.shift() ?? "").trim();
        break;
      case "--tenantId":
        parsed.tenantId = String(args.shift() ?? "").trim();
        break;
      case "--runUrl":
        parsed.runUrl = String(args.shift() ?? "").trim();
        break;
      case "--gitTag":
        parsed.gitTag = String(args.shift() ?? "").trim();
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!parsed.suite) {
    throw new Error("Missing required argument: --suite");
  }
  if (!parsed.tenantId) {
    throw new Error("Missing required argument: --tenantId");
  }
  if (!parsed.runUrl) {
    throw new Error("Missing required argument: --runUrl");
  }
  return parsed;
}

function ensureStagingEnvironment() {
  const env = String(process.env.APP_ENV ?? "").trim().toLowerCase();
  if (env !== "staging") {
    throw new Error(`Gate sign-off must run with APP_ENV=staging. Received APP_ENV='${env || "unset"}'.`);
  }
}

function resolveGitTag(input) {
  if (input) {
    return input;
  }
  const shortSha = execSync("git rev-parse --short HEAD", {
    cwd: ROOT,
    encoding: "utf8",
  })
    .trim();
  return `sha-${shortSha}`;
}

function sanitizeFilePart(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function run() {
  ensureStagingEnvironment();
  const args = parseArgs(process.argv.slice(2));
  const gitTag = resolveGitTag(args.gitTag);
  const now = new Date();
  const stamp = now.toISOString().replace(/[:]/g, "-");
  const artifact = {
    environment: "staging",
    tenantId: args.tenantId,
    date: now.toISOString(),
    gitTag,
    runUrl: args.runUrl,
    suite: args.suite,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const fileName = `${stamp}_${sanitizeFilePart(args.suite)}.json`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outputPath,
        artifact,
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
