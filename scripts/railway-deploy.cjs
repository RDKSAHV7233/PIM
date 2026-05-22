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

function dedupe(values) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean)));
}

function normalizeServiceTarget(value) {
  return String(value ?? "").trim().toLowerCase();
}

function deriveRailwayHostSlug(urlValue) {
  const value = String(urlValue ?? "").trim();
  if (!value) {
    return "";
  }
  try {
    const hostname = new URL(value).hostname.trim().toLowerCase();
    if (!hostname.endsWith(".up.railway.app")) {
      return "";
    }
    return hostname.replace(/\.up\.railway\.app$/i, "");
  } catch {
    return "";
  }
}

function resolveServiceTargets(primaryNames, fallbackUrl, env = process.env) {
  return dedupe([
    ...primaryNames.map((name) => optionalEnv(name, env)),
    deriveRailwayHostSlug(fallbackUrl),
  ]);
}

function findOverlappingServiceTargets(apiServiceTargets, webServiceTargets) {
  const webTargetSet = new Set(webServiceTargets.map((value) => normalizeServiceTarget(value)).filter(Boolean));
  return apiServiceTargets.filter((value) => webTargetSet.has(normalizeServiceTarget(value)));
}

function resolveConfig(env = process.env, repoRoot = path.resolve(__dirname, "..")) {
  const projectId = requireEnv("RAILWAY_PROJECT_ID", env);
  const apiServiceTargets = resolveServiceTargets(
    ["RAILWAY_API_SERVICE", "RAILWAY_API_SERVICE_ID"],
    optionalEnv("STAGING_BASE_URL", env),
    env,
  );
  const webServiceTargets = resolveServiceTargets(
    ["RAILWAY_WEB_SERVICE", "RAILWAY_WEB_SERVICE_ID"],
    optionalEnv("STAGING_WEB_URL", env),
    env,
  );
  const environmentName = String(env.RAILWAY_ENVIRONMENT_NAME ?? "staging").trim() || "staging";
  const apiSourcePath = path.resolve(repoRoot, String(env.RAILWAY_API_SOURCE_PATH ?? ".tmp/railway-api-service").trim());
  const webSourcePath = path.resolve(repoRoot, String(env.RAILWAY_WEB_SOURCE_PATH ?? ".tmp/railway-web-service").trim());
  const railwayBin = String(env.RAILWAY_CLI_BIN ?? "railway").trim() || "railway";
  const deployRetries = Number.parseInt(String(env.RAILWAY_DEPLOY_RETRIES ?? "3"), 10);
  const deployRetryDelayMs = Number.parseInt(String(env.RAILWAY_DEPLOY_RETRY_DELAY_MS ?? "5000"), 10);
  const deployTimeoutMs = Number.parseInt(String(env.RAILWAY_DEPLOY_TIMEOUT_MS ?? "900000"), 10);
  const railwayToken = optionalEnv("RAILWAY_TOKEN", env);
  const railwayApiToken = optionalEnv("RAILWAY_API_TOKEN", env);

  if (!railwayToken && !railwayApiToken) {
    throw new Error("Missing Railway credentials: set RAILWAY_TOKEN (project token) or RAILWAY_API_TOKEN (account/workspace token).");
  }
  if (apiServiceTargets.length === 0) {
    throw new Error("Missing Railway API service target. Set RAILWAY_API_SERVICE_ID or RAILWAY_API_SERVICE.");
  }
  if (webServiceTargets.length === 0) {
    throw new Error("Missing Railway web service target. Set RAILWAY_WEB_SERVICE_ID or RAILWAY_WEB_SERVICE.");
  }
  const overlappingServiceTargets = findOverlappingServiceTargets(apiServiceTargets, webServiceTargets);
  if (overlappingServiceTargets.length > 0) {
    throw new Error(
      `Railway API and web service targets overlap (${overlappingServiceTargets.join(", ")}). Verify RAILWAY_API_SERVICE/RAILWAY_API_SERVICE_ID point to the API service and RAILWAY_WEB_SERVICE/RAILWAY_WEB_SERVICE_ID point to the web service.`,
    );
  }

  return {
    repoRoot,
    projectId,
    apiServiceTargets,
    webServiceTargets,
    environmentName,
    apiSourcePath,
    webSourcePath,
    railwayBin,
    deployRetries: Number.isFinite(deployRetries) ? Math.max(1, deployRetries) : 3,
    deployRetryDelayMs: Number.isFinite(deployRetryDelayMs) ? Math.max(0, deployRetryDelayMs) : 5000,
    deployTimeoutMs: Number.isFinite(deployTimeoutMs) ? Math.max(60_000, deployTimeoutMs) : 900_000,
  };
}

function buildRailwayExecutionEnv(env = process.env) {
  const preferredToken = optionalEnv("RAILWAY_API_TOKEN", env) || optionalEnv("RAILWAY_TOKEN", env);
  if (!preferredToken) {
    return { ...env };
  }
  return {
    ...env,
    RAILWAY_TOKEN: preferredToken,
  };
}

function buildDeployCommands(config) {
  const apiRelative = path.relative(config.repoRoot, config.apiSourcePath) || ".";
  const webRelative = path.relative(config.repoRoot, config.webSourcePath) || ".";
  return [
    {
      label: "API",
      pathArg: apiRelative,
      serviceTargets: config.apiServiceTargets,
    },
    {
      label: "Web",
      pathArg: webRelative,
      serviceTargets: config.webServiceTargets,
    },
  ];
}

function classifyDeployTargets(changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return { deployApi: true, deployWeb: true };
  }

  const normalizedTargets = changedFiles
    .map((value) => String(value ?? "").replace(/\\/g, "/").trim().toLowerCase())
    .filter(Boolean);
  const explicitDeployTargets = normalizedTargets.filter((value) => value === "api" || value === "web");
  if (explicitDeployTargets.length > 0) {
    return {
      deployApi: explicitDeployTargets.includes("api"),
      deployWeb: explicitDeployTargets.includes("web"),
    };
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
    timeout: options.timeoutMs,
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    result.error.stdout = result.stdout;
    result.error.stderr = result.stderr;
    result.error.combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
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

function runCommandCapture(command, args, options) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

function isRetryableRailwayDeployError(error) {
  const combined = [
    error instanceof Error ? error.message : String(error),
    error && typeof error === "object" ? String(error.code ?? "") : "",
    error && typeof error === "object" ? String(error.stdout ?? "") : "",
    error && typeof error === "object" ? String(error.stderr ?? "") : "",
    error && typeof error === "object" ? String(error.combinedOutput ?? "") : "",
  ]
    .join("\n")
    .toLowerCase();
  return (
    combined.includes("etimedout") ||
    combined.includes("timed out") ||
    combined.includes("operation timed out") ||
    combined.includes("error sending request for url") ||
    combined.includes("build daemon returned an error") ||
    combined.includes("failed to solve: canceled: context canceled") ||
    combined.includes("context canceled")
  );
}

function isServiceNotFoundRailwayError(error) {
  const combined = [
    error instanceof Error ? error.message : String(error),
    error && typeof error === "object" ? String(error.stdout ?? "") : "",
    error && typeof error === "object" ? String(error.stderr ?? "") : "",
    error && typeof error === "object" ? String(error.combinedOutput ?? "") : "",
  ]
    .join("\n")
    .toLowerCase();
  return combined.includes("service not found");
}

function isServiceConfigMissingRailwayError(error) {
  const combined = [
    error instanceof Error ? error.message : String(error),
    error && typeof error === "object" ? String(error.stdout ?? "") : "",
    error && typeof error === "object" ? String(error.stderr ?? "") : "",
    error && typeof error === "object" ? String(error.combinedOutput ?? "") : "",
  ]
    .join("\n")
    .toLowerCase();
  return combined.includes("service config at") && combined.includes("not found");
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
        timeoutMs: options.timeoutMs,
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

function emitRailwayServiceDiscoveryHint(config, env = process.env) {
  const linkResult = runCommandCapture(
    config.railwayBin,
    ["link", "--project", config.projectId, "--environment", config.environmentName, "--json"],
    { cwd: config.repoRoot, env },
  );

  if (linkResult.error || linkResult.status !== 0) {
    console.error("[railway-deploy] Railway service discovery could not link the project/environment.");
    if (linkResult.stdout) {
      process.stdout.write(linkResult.stdout);
    }
    if (linkResult.stderr) {
      process.stderr.write(linkResult.stderr);
    }
    return;
  }

  const statusResult = runCommandCapture(
    config.railwayBin,
    ["service", "status", "--all", "--environment", config.environmentName, "--json"],
    { cwd: config.repoRoot, env },
  );

  if (statusResult.stdout) {
    console.error("[railway-deploy] Railway service discovery output:");
    process.stdout.write(statusResult.stdout);
  }
  if (statusResult.stderr) {
    process.stderr.write(statusResult.stderr);
  }
}

function emitRecentRailwayDeployLogs(config, serviceTarget, env = process.env) {
  const linkResult = runCommandCapture(
    config.railwayBin,
    ["link", "--project", config.projectId, "--environment", config.environmentName, "--service", serviceTarget, "--json"],
    { cwd: config.repoRoot, env },
  );

  if (linkResult.error || linkResult.status !== 0) {
    console.error(`[railway-deploy] Could not link Railway project context to fetch logs for service '${serviceTarget}'.`);
    if (linkResult.stdout) {
      process.stdout.write(linkResult.stdout);
    }
    if (linkResult.stderr) {
      process.stderr.write(linkResult.stderr);
    }
    return;
  }

  const deploymentListResult = runCommandCapture(
    config.railwayBin,
    ["deployment", "list", "--service", serviceTarget, "--environment", config.environmentName, "--limit", "5", "--json"],
    { cwd: config.repoRoot, env },
  );
  if (deploymentListResult.stdout) {
    console.error(`[railway-deploy] Recent deployments for service '${serviceTarget}':`);
    process.stdout.write(deploymentListResult.stdout);
  }
  if (deploymentListResult.stderr) {
    process.stderr.write(deploymentListResult.stderr);
  }

  const logCommands = [
    {
      label: "build",
      args: ["logs", "--build", "--service", serviceTarget, "--environment", config.environmentName, "--latest", "--lines", "200"],
    },
    {
      label: "deployment",
      args: ["logs", "--deployment", "--service", serviceTarget, "--environment", config.environmentName, "--latest", "--lines", "200"],
    },
  ];

  for (const command of logCommands) {
    const result = runCommandCapture(config.railwayBin, command.args, {
      cwd: config.repoRoot,
      env,
    });
    if (result.stdout) {
      console.error(`[railway-deploy] Latest Railway ${command.label} logs for service '${serviceTarget}':`);
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
  }
}

function emitActionableDeployHint(error, config) {
  const combined = [
    error instanceof Error ? error.message : String(error),
    error && typeof error === "object" ? String(error.stdout ?? "") : "",
    error && typeof error === "object" ? String(error.stderr ?? "") : "",
    error && typeof error === "object" ? String(error.combinedOutput ?? "") : "",
  ]
    .join("\n")
    .toLowerCase();

  if (combined.includes("project not found")) {
    console.error(
      `[railway-deploy] Railway could not resolve project '${config.projectId}'. Verify that the active token has access to the project and matches the correct token type: use RAILWAY_TOKEN for a project token or RAILWAY_API_TOKEN for an account/workspace token.`,
    );
  } else if (combined.includes("unauthorized")) {
    console.error(
      "[railway-deploy] Railway authentication failed. Verify the token has not expired/revoked and is scoped to the target project or workspace.",
    );
  } else if (combined.includes("service not found")) {
    console.error(
      `[railway-deploy] Railway could resolve project '${config.projectId}' but none of the configured service targets matched. API candidates: ${config.apiServiceTargets.join(", ")}. Web candidates: ${config.webServiceTargets.join(", ")}.`,
    );
    emitRailwayServiceDiscoveryHint(config, process.env);
  } else if (combined.includes("service targets overlap")) {
    console.error(
      `[railway-deploy] Railway deploy targets are miswired. API candidates: ${config.apiServiceTargets.join(", ")}. Web candidates: ${config.webServiceTargets.join(", ")}.`,
    );
  }
}

function buildDeployArgs(config, pathArg, serviceTarget) {
  return [
    "up",
    pathArg,
    "--service",
    serviceTarget,
    "--project",
    config.projectId,
    "--environment",
    config.environmentName,
    "--path-as-root",
    "--ci",
  ];
}

function runDeployCommandAcrossServiceTargets(command, options) {
  let lastError = null;
  for (const serviceTarget of command.serviceTargets) {
    try {
      runDeployCommandWithRetry(
        {
          binary: options.railwayBin,
          args: buildDeployArgs(options.config, command.pathArg, serviceTarget),
          label: `Railway ${command.label} deploy`,
        },
        {
          cwd: options.cwd,
          env: options.env,
          maxAttempts: options.maxAttempts,
          retryDelayMs: options.retryDelayMs,
          timeoutMs: options.deployTimeoutMs,
        },
      );
      if (serviceTarget !== command.serviceTargets[0]) {
        console.log(`[railway-deploy] ${command.label} deploy succeeded using fallback service target '${serviceTarget}'.`);
      }
      return;
    } catch (error) {
      lastError = error;
      const canTryNextCandidate = serviceTarget !== command.serviceTargets[command.serviceTargets.length - 1];
      if (isServiceNotFoundRailwayError(error) && canTryNextCandidate) {
        console.warn(`[railway-deploy] ${command.label} service target '${serviceTarget}' was not found. Trying next candidate...`);
        continue;
      }
      if (isServiceConfigMissingRailwayError(error) && canTryNextCandidate) {
        console.warn(
          `[railway-deploy] ${command.label} service target '${serviceTarget}' resolved to a service with an unexpected source-path config. Trying next candidate...`,
        );
        continue;
      }
      if (!canTryNextCandidate || (!isServiceNotFoundRailwayError(error) && !isServiceConfigMissingRailwayError(error))) {
        emitRecentRailwayDeployLogs(options.config, serviceTarget, options.env);
        throw error;
      }
    }
  }
  throw lastError ?? new Error(`No Railway ${command.label} service targets were available.`);
}

/**
 * Parse a minimal subset of env-file syntax: KEY=VALUE (no export, no multi-line).
 * Used to read PIM_API_BASE_URL and friends out of the prepared .env.production.
 */
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const result = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    if (key) {
      result[key] = raw.replace(/^"|"$/g, "");
    }
  }
  return result;
}

/**
 * Set Railway service-level env vars for the web service so they are available
 * as Docker build-args (Railway passes service vars as build args automatically).
 * Without this, the Dockerfile ARG PIM_API_BASE_URL resolves to an empty string
 * and the runtime web container calls localhost:4000 instead of the staging API.
 */
function setWebServiceVariables(config, railwayEnv, webPackagePath) {
  const envFile = path.join(webPackagePath, ".env.production");
  const vars = parseEnvFile(envFile);
  const relevantKeys = ["PIM_API_BASE_URL", "NEXT_PUBLIC_API_URL", "PIM_API_BASE_URL_FALLBACK"];
  const pairs = relevantKeys
    .filter((k) => vars[k])
    .map((k) => `${k}=${vars[k]}`);

  if (pairs.length === 0) {
    console.warn("[railway-deploy] No API URL vars found in .env.production — skipping web service variable sync.");
    return;
  }

  // Use the primary web service target; if it fails, warn but don't block the deploy.
  const primaryTarget = config.webServiceTargets[0];
  const args = [
    "variables",
    "set",
    ...pairs,
    "--service",
    primaryTarget,
    "--environment",
    config.environmentName,
    "--project",
    config.projectId,
  ];

  console.log(`[railway-deploy] Setting web service env vars on '${primaryTarget}': ${pairs.join(" ")}`);
  const result = childProcess.spawnSync(config.railwayBin, args, {
    cwd: config.repoRoot,
    env: railwayEnv,
    encoding: "utf8",
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error || result.status !== 0) {
    console.warn(
      `[railway-deploy] Warning: could not set web service env vars (exit ${result.status}). ` +
        "The deploy will proceed, but PIM_API_BASE_URL may be unset on the running container. " +
        "Set it manually in the Railway dashboard if the service starts with AUTH_UPSTREAM_UNAVAILABLE.",
    );
  } else {
    console.log("[railway-deploy] Web service env vars synced successfully.");
  }
}

function main(env = process.env) {
  const repoRoot = path.resolve(__dirname, "..");
  const config = resolveConfig(env, repoRoot);
  const railwayEnv = buildRailwayExecutionEnv(env);
  const changedFiles = getChangedFiles(env, repoRoot);
  const deployPlan = Array.isArray(changedFiles) && changedFiles.length > 0
    ? classifyDeployTargets(changedFiles)
    : { deployApi: true, deployWeb: true };

  runCommand(config.railwayBin, ["--version"], {
    cwd: repoRoot,
    env: railwayEnv,
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

  // Sync API URL env vars to the Railway web service BEFORE deploying.
  // Railway passes service-level env vars as Docker build args — without this,
  // the Dockerfile ARG PIM_API_BASE_URL is empty and the container falls back to
  // localhost:4000, causing AUTH_UPSTREAM_UNAVAILABLE in the post-deploy check.
  if (deployPlan.deployWeb) {
    setWebServiceVariables(config, railwayEnv, config.webSourcePath);
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
    runDeployCommandAcrossServiceTargets(
      command,
      {
        cwd: repoRoot,
        env: railwayEnv,
        config,
        railwayBin: config.railwayBin,
        maxAttempts: config.deployRetries,
        retryDelayMs: config.deployRetryDelayMs,
        deployTimeoutMs: config.deployTimeoutMs,
      },
    );
  }
}

if (require.main === module) {
  try {
    main(process.env);
  } catch (error) {
    try {
      const config = resolveConfig(process.env);
      emitActionableDeployHint(error, config);
    } catch {
      // Ignore secondary config-resolution failures and print the primary error below.
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  buildDeployCommands,
  classifyDeployTargets,
  buildRailwayExecutionEnv,
  findOverlappingServiceTargets,
  getChangedFiles,
  isRetryableRailwayDeployError,
  isServiceNotFoundRailwayError,
  main,
  normalizeServiceTarget,
  resolveConfig,
  resolveServiceTargets,
  runDeployCommandWithRetry,
};
