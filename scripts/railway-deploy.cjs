#!/usr/bin/env node
/* eslint-disable no-console */

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function requireEnv(name, env = process.env) {
  const value = String(env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveConfig(env = process.env, repoRoot = path.resolve(__dirname, "..")) {
  const projectId = requireEnv("RAILWAY_PROJECT_ID", env);
  const apiServiceId = requireEnv("RAILWAY_API_SERVICE_ID", env);
  const webServiceId = requireEnv("RAILWAY_WEB_SERVICE_ID", env);
  const environmentName = String(env.RAILWAY_ENVIRONMENT_NAME ?? "staging").trim() || "staging";
  const apiSourcePath = path.resolve(repoRoot, String(env.RAILWAY_API_SOURCE_PATH ?? ".tmp/railway-api-service").trim());
  const webSourcePath = path.resolve(repoRoot, String(env.RAILWAY_WEB_SOURCE_PATH ?? ".").trim() || ".");
  const railwayBin = String(env.RAILWAY_CLI_BIN ?? "railway").trim() || "railway";

  return {
    repoRoot,
    projectId,
    apiServiceId,
    webServiceId,
    environmentName,
    apiSourcePath,
    webSourcePath,
    railwayBin,
  };
}

function buildDeployCommands(config) {
  const apiRelative = path.relative(config.repoRoot, config.apiSourcePath) || ".";
  const webRelative = path.relative(config.repoRoot, config.webSourcePath) || ".";
  return [
    {
      label: "API",
      args: [
        "up",
        apiRelative,
        "--service",
        config.apiServiceId,
        "--project",
        config.projectId,
        "--environment",
        config.environmentName,
        "--path-as-root",
        "--ci",
      ],
    },
    {
      label: "Web",
      args: [
        "up",
        webRelative,
        "--service",
        config.webServiceId,
        "--project",
        config.projectId,
        "--environment",
        config.environmentName,
        "--path-as-root",
        "--ci",
      ],
    },
  ];
}

function runCommand(command, args, options) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${options.label} failed with exit code ${result.status}`);
  }
}

function main(env = process.env) {
  const repoRoot = path.resolve(__dirname, "..");
  const config = resolveConfig(env, repoRoot);

  runCommand(config.railwayBin, ["--version"], {
    cwd: repoRoot,
    env,
    label: "Railway CLI availability check",
  });

  runCommand(process.execPath, [path.join(repoRoot, "scripts", "prepare-railway-api-package.cjs")], {
    cwd: repoRoot,
    env,
    label: "Railway API packaging",
  });

  if (!fs.existsSync(config.apiSourcePath)) {
    throw new Error(`Prepared Railway API package not found: ${config.apiSourcePath}`);
  }
  if (!fs.existsSync(config.webSourcePath)) {
    throw new Error(`Railway web source path not found: ${config.webSourcePath}`);
  }

  for (const command of buildDeployCommands(config)) {
    console.log(`[railway-deploy] Deploying ${command.label} service...`);
    runCommand(config.railwayBin, command.args, {
      cwd: repoRoot,
      env,
      label: `Railway ${command.label} deploy`,
    });
  }
}

if (require.main === module) {
  try {
    main(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  buildDeployCommands,
  main,
  resolveConfig,
};
