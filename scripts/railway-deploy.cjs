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

function optionalEnv(name, env = process.env) {
  return String(env[name] ?? "").trim();
}

function requireOneOfEnv(names, env = process.env) {
  for (const name of names) {
    const value = optionalEnv(name, env);
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing required environment variable: one of ${names.join(", ")}`);
}

function resolveConfig(env = process.env, repoRoot = path.resolve(__dirname, "..")) {
  const projectId = requireEnv("RAILWAY_PROJECT_ID", env);
  const apiServiceTarget = requireOneOfEnv(["RAILWAY_API_SERVICE", "RAILWAY_API_SERVICE_ID"], env);
  const webServiceTarget = requireOneOfEnv(["RAILWAY_WEB_SERVICE", "RAILWAY_WEB_SERVICE_ID"], env);
  const environmentName = String(env.RAILWAY_ENVIRONMENT_NAME ?? "staging").trim() || "staging";
  const apiSourcePath = path.resolve(repoRoot, String(env.RAILWAY_API_SOURCE_PATH ?? ".tmp/railway-api-service").trim());
  const webSourcePath = path.resolve(repoRoot, String(env.RAILWAY_WEB_SOURCE_PATH ?? ".tmp/railway-web-service").trim());
  const railwayBin = String(env.RAILWAY_CLI_BIN ?? "railway").trim() || "railway";
  const deployRetries = Number.parseInt(String(env.RAILWAY_DEPLOY_RETRIES ?? "3"), 10);
  const deployRetryDelayMs = Number.parseInt(String(env.RAILWAY_DEPLOY_RETRY_DELAY_MS ?? "5000"), 10);

  return {
    repoRoot,
    projectId,
    apiServiceTarget,
    webServiceTarget,
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
        config.apiServiceTarget,
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
        config.webServiceTarget,
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

function classifyDeployTargets(changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return { deployApi: true, deployWeb: true };
  }

  let deployApi = false;
  let deployWeb = false;

  for (const file of changedFiles) {
    const normalized = String(file ?? "").replace(/\\/g, "/").trim();
    if (!normalized) {
      continue;
    }
    if (
      normalized === "package.json" ||
      normalized === "package-lock.json" ||
      normalized === "tsconfig.base.json" ||
      normalized.startsWith("packages/") ||
      normalized.startsWith("scripts/") ||
      normalized.startsWith(".github/")
    ) {
      return { deployApi: true, deployWeb: true };
    }
    if (normalized.startsWith("apps/api/")) {
      deployApi = true;
    }
    if (normalized.startsWith("apps/web/")) {
      deployWeb = true;
    }
  }

  if (!deployApi && !deployWeb) {
    return { deployApi: true, deployWeb: true };
  }

  return { deployApi, deployWeb };
}

function getChangedFiles(env = process.env, repoRoot = path.resolve(__dirname, "..")) {
  const explicitTargets = optionalEnv("RAILWAY_DEPLOY_TARGETS", env)
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (explicitTargets.length > 0) {
    return explicitTargets;
  }

  const before = optionalEnv("GITHUB_EVENT_BEFORE", env);
  const sha = optionalEnv("GITHUB_SHA", env);
  if (!before || !sha) {
    return null;
  }

  const result = childProcess.spawnSync("git", ["diff", "--name-only", before, sha], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    return null;
  }

  return result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
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
  return (
    combined.includes("operation timed out") ||
    combined.includes("error sending request for url") ||
    combined.includes("build daemon returned an error") ||
    combined.includes("failed to solve: canceled: context canceled") ||
    combined.includes("context canceled")
  );
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
  const changedFiles = getChangedFiles(env, repoRoot);
  const deployPlan = Array.isArray(changedFiles) && changedFiles.length > 0
    ? classifyDeployTargets(changedFiles)
    : { deployApi: true, deployWeb: true };

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
    if (command.label === "API" && !deployPlan.deployApi) {
      console.log("[railway-deploy] Skipping API deploy because this push has no API-impacting changes.");
      continue;
    }
    if (command.label === "Web" && !deployPlan.deployWeb) {
      console.log("[railway-deploy] Skipping Web deploy because this push has no web-impacting changes.");
      continue;
    }
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
  classifyDeployTargets,
  getChangedFiles,
  isRetryableRailwayDeployError,
  main,
  resolveConfig,
  runDeployCommandWithRetry,
};
