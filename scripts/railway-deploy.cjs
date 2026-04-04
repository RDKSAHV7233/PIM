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
  const webSourcePath = path.resolve(repoRoot, String(env.RAILWAY_WEB_SOURCE_PATH ?? ".tmp/railway-web-service").trim());
  const railwayBin = String(env.RAILWAY_CLI_BIN ?? "railway").trim() || "railway";
  const deployRetries = Number.parseInt(String(env.RAILWAY_DEPLOY_RETRIES ?? "3"), 10);
  const deployRetryDelayMs = Number.parseInt(String(env.RAILWAY_DEPLOY_RETRY_DELAY_MS ?? "5000"), 10);

  return {
    repoRoot,
    projectId,
    apiServiceId,
    webServiceId,
    environmentName,
    apiSourcePath,
    webSourcePath,
    railwayBin,
    deployRetries: Number.isFinite(deployRetries) ? Math.max(1, deployRetries) : 3,
    deployRetryDelayMs: Number.isFinite(deployRetryDelayMs) ? Math.max(0, deployRetryDelayMs) : 5000,
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
    encoding: "utf8",
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const error = new Error(`${options.label} failed with exit code ${result.status}`);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    throw error;
  }
}

function isRetryableRailwayDeployError(error) {
  const combined = [
    error instanceof Error ? error.message : String(error),
    error && typeof error === "object" ? String(error.stdout ?? "") : "",
    error && typeof error === "object" ? String(error.stderr ?? "") : "",
    error && typeof error === "object" ? String(error.combinedOutput ?? "") : "",
  ]
    .join("\n")
    .toLowerCase();
  return combined.includes("operation timed out") || combined.includes("error sending request for url");
}

function sleep(ms) {
  if (ms <= 0) {
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runDeployCommandWithRetry(command, options) {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      runCommand(command.binary, command.args, {
        cwd: options.cwd,
        env: options.env,
        label: command.label,
      });
      return;
    } catch (error) {
      if (!isRetryableRailwayDeployError(error) || attempt === options.maxAttempts) {
        throw error;
      }
      console.warn(
        `[railway-deploy] ${command.label} timed out on attempt ${attempt}/${options.maxAttempts}. Retrying in ${options.retryDelayMs}ms...`,
      );
      sleep(options.retryDelayMs);
    }
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
  runCommand(process.execPath, [path.join(repoRoot, "scripts", "prepare-railway-web-package.cjs")], {
    cwd: repoRoot,
    env,
    label: "Railway web packaging",
  });

  if (!fs.existsSync(config.apiSourcePath)) {
    throw new Error(`Prepared Railway API package not found: ${config.apiSourcePath}`);
  }
  if (!fs.existsSync(config.webSourcePath)) {
    throw new Error(`Railway web source path not found: ${config.webSourcePath}`);
  }

  for (const command of buildDeployCommands(config)) {
    console.log(`[railway-deploy] Deploying ${command.label} service...`);
    runDeployCommandWithRetry(
      {
        binary: config.railwayBin,
        args: command.args,
        label: `Railway ${command.label} deploy`,
      },
      {
        cwd: repoRoot,
        env,
        maxAttempts: config.deployRetries,
        retryDelayMs: config.deployRetryDelayMs,
      },
    );
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
  isRetryableRailwayDeployError,
  main,
  resolveConfig,
  runDeployCommandWithRetry,
};
