#!/usr/bin/env node
/* eslint-disable no-console */

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildRailwayEnv,
  optionalEnv,
  requireEnv,
} = require("./resolve-railway-service-url.cjs");
const {
  readRailwayVariablesAcrossServiceTargets,
  resolveConfig,
} = require("./railway-deploy.cjs");

function redact(value) {
  return String(value ?? "").replace(/\S{16,}/g, "[REDACTED]");
}

function output(name, value) {
  const outputPath = optionalEnv("GITHUB_OUTPUT");
  if (outputPath) {
    fs.appendFileSync(outputPath, `${name}=${value}\n`);
  } else {
    console.log(`${name}=${value}`);
  }
}

function mask(value) {
  if (value) {
    console.log(`::add-mask::${value}`);
  }
}

function resolveFromRailway(env) {
  const config = resolveConfig(env, path.resolve(__dirname, ".."));
  const railwayEnv = buildRailwayEnv(env);
  const variables = readRailwayVariablesAcrossServiceTargets(config, railwayEnv, config.apiServiceTargets, "API observability env vars");
  return String(variables.OBSERVABILITY_DATABASE_URL ?? "").trim();
}

function main(env = process.env) {
  let value = optionalEnv("OBSERVABILITY_DATABASE_URL", env);
  let source = "github";
  if (!value) {
    value = resolveFromRailway(env);
    source = "railway_api_service";
  }
  if (!value) {
    throw new Error("OBSERVABILITY_DATABASE_URL was not available from GitHub secrets or API Railway service variables.");
  }
  mask(value);
  output("observability_database_url", value);
  output("source", source);
  console.log(`Resolved OBSERVABILITY_DATABASE_URL from ${source}.`);
}

if (require.main === module) {
  try {
    main(process.env);
  } catch (error) {
    console.error(redact(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

module.exports = {
  main,
  resolveFromRailway,
};
