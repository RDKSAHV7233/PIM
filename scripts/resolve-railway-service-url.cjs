#!/usr/bin/env node
/* eslint-disable no-console */

const childProcess = require("node:child_process");

function optionalEnv(name, env = process.env) {
  return String(env[name] ?? "").trim();
}

function requireEnv(name, env = process.env) {
  const value = optionalEnv(name, env);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildRailwayEnv(env = process.env) {
  const preferredToken = optionalEnv("RAILWAY_API_TOKEN", env) || optionalEnv("RAILWAY_TOKEN", env);
  return preferredToken
    ? {
        ...env,
        RAILWAY_TOKEN: preferredToken,
      }
    : { ...env };
}

function runCommand(command, args, env = process.env) {
  const result = childProcess.spawnSync(command, args, {
    encoding: "utf8",
    env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    throw new Error(combined || `${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return String(result.stdout ?? "").trim();
}

function normalizeUrl(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    return "";
  }
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(withProtocol);
    if (!parsed.hostname || parsed.hostname.endsWith(".railway.internal") || parsed.hostname === "localhost") {
      return "";
    }
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function collectUrlCandidates(value, keyPath = "", candidates = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrlCandidates(item, keyPath, candidates);
    }
    return candidates;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const nextPath = keyPath ? `${keyPath}.${key}` : key;
      collectUrlCandidates(nested, nextPath, candidates);
    }
    return candidates;
  }
  if (typeof value !== "string") {
    return candidates;
  }

  const normalizedKeyPath = keyPath.toLowerCase();
  const shouldInspect =
    normalizedKeyPath.includes("domain") ||
    normalizedKeyPath.includes("url") ||
    normalizedKeyPath.includes("host") ||
    value.includes(".railway.app");
  if (!shouldInspect) {
    return candidates;
  }

  const extracted = value.match(/https?:\/\/[^\s",]+|[a-z0-9-]+\.up\.railway\.app|[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  for (const match of extracted) {
    const normalized = normalizeUrl(match);
    if (normalized) {
      candidates.push(normalized);
    }
  }
  return candidates;
}

function dedupe(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function chooseBestUrl(urls) {
  const scored = urls
    .map((url) => {
      let score = 0;
      if (url.includes(".up.railway.app")) {
        score += 4;
      }
      if (url.startsWith("https://")) {
        score += 2;
      }
      return { url, score };
    })
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
  return scored[0]?.url ?? "";
}

function resolveServiceTarget(env = process.env) {
  return (
    optionalEnv("RAILWAY_SERVICE_ID", env) ||
    optionalEnv("RAILWAY_SERVICE", env) ||
    optionalEnv("RAILWAY_WEB_SERVICE_ID", env) ||
    requireEnv("RAILWAY_WEB_SERVICE", env)
  );
}

function main(env = process.env) {
  const railwayBin = optionalEnv("RAILWAY_CLI_BIN", env) || "railway";
  const railwayEnv = buildRailwayEnv(env);
  const projectId = requireEnv("RAILWAY_PROJECT_ID", env);
  const environmentName = optionalEnv("RAILWAY_ENVIRONMENT_NAME", env) || "staging";
  const serviceTarget = resolveServiceTarget(env);

  runCommand(railwayBin, ["link", "--project", projectId, "--environment", environmentName, "--service", serviceTarget, "--json"], railwayEnv);

  const rawStatus = runCommand(
    railwayBin,
    ["service", "status", "--service", serviceTarget, "--environment", environmentName, "--json"],
    railwayEnv,
  );
  const parsedStatus = JSON.parse(rawStatus);
  const directCandidates = dedupe(collectUrlCandidates(parsedStatus));
  const directUrl = chooseBestUrl(directCandidates);
  if (directUrl) {
    process.stdout.write(directUrl);
    return;
  }

  const rawProjectStatus = runCommand(railwayBin, ["status", "--json"], railwayEnv);
  const parsedProjectStatus = JSON.parse(rawProjectStatus);
  const projectCandidates = dedupe(collectUrlCandidates(parsedProjectStatus));
  const projectUrl = chooseBestUrl(projectCandidates);
  if (projectUrl) {
    process.stdout.write(projectUrl);
    return;
  }

  throw new Error("Could not resolve a public Railway service URL from CLI status output.");
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
  buildRailwayEnv,
  chooseBestUrl,
  collectUrlCandidates,
  dedupe,
  main,
  normalizeUrl,
  optionalEnv,
  resolveServiceTarget,
  requireEnv,
  runCommand,
};
