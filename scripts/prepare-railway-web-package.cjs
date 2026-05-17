#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(repoRoot, "apps", "web");
const tsconfigBaseSource = path.join(repoRoot, "tsconfig.base.json");
const outputDir = path.join(repoRoot, ".tmp", "railway-web-service");
const appOutputDir = path.join(outputDir, "apps", "web");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function normalizeApiBaseUrl(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = !pathname || pathname === "/" ? "/api/v1" : pathname;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return normalized.replace(/\/+$/, "");
  }
}

function resolveApiBaseUrl(env = process.env) {
  return normalizeApiBaseUrl(env.PIM_API_BASE_URL || env.NEXT_PUBLIC_API_URL || env.STAGING_BASE_URL || "");
}

function copyDir(source, target) {
  const entries = fs.readdirSync(source, { withFileTypes: true });
  ensureDir(target);
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".next" || entry.name === "node_modules" || entry.name === "test") {
        continue;
      }
      copyDir(sourcePath, targetPath);
      continue;
    }
    if (entry.name === "tsconfig.tsbuildinfo") {
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function main() {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Web source directory not found: ${sourceDir}`);
  }
  if (!fs.existsSync(tsconfigBaseSource)) {
    throw new Error(`Root tsconfig.base.json not found: ${tsconfigBaseSource}`);
  }

  removeDir(outputDir);
  copyDir(sourceDir, appOutputDir);

  fs.copyFileSync(tsconfigBaseSource, path.join(outputDir, "tsconfig.base.json"));

  const rootPackageJsonPath = path.join(outputDir, "package.json");
  fs.writeFileSync(
    rootPackageJsonPath,
    `${JSON.stringify(
      {
        name: "pim1-railway-web-service",
        private: true,
        workspaces: ["apps/*"],
        scripts: {
          build: "npm run build --workspace @pim1/web",
          start: "npm run start --workspace @pim1/web",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const railwayTomlContents = [
    "[build]",
    'buildCommand = "npm install && npm run build"',
    "",
    "[deploy]",
    'startCommand = "npm run start"',
    'healthcheckPath = "/health"',
    "healthcheckTimeout = 300",
    'restartPolicyType = "ON_FAILURE"',
    "restartPolicyMaxRetries = 10",
    "",
  ].join("\n");

  const railwayTomlPath = path.join(outputDir, "railway.toml");
  fs.writeFileSync(railwayTomlPath, railwayTomlContents, "utf8");

  const appRailwayTomlPath = path.join(appOutputDir, "railway.toml");
  fs.writeFileSync(appRailwayTomlPath, railwayTomlContents, "utf8");

  const apiBaseUrl = resolveApiBaseUrl(process.env);
  let appEnvFile = null;
  if (apiBaseUrl) {
    const envContents = [`PIM_API_BASE_URL=${apiBaseUrl}`, `NEXT_PUBLIC_API_URL=${apiBaseUrl}`, ""].join("\n");
    appEnvFile = path.join(appOutputDir, ".env.production");
    fs.writeFileSync(appEnvFile, envContents, "utf8");
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outputDir: path.relative(repoRoot, outputDir),
        rootPackageJson: path.relative(repoRoot, rootPackageJsonPath),
        appPackageJson: path.relative(repoRoot, path.join(appOutputDir, "package.json")),
        tsconfigBase: path.relative(repoRoot, path.join(outputDir, "tsconfig.base.json")),
        railwayToml: path.relative(repoRoot, railwayTomlPath),
        appRailwayToml: path.relative(repoRoot, appRailwayTomlPath),
        ...(appEnvFile
          ? {
              appEnvFile: path.relative(repoRoot, appEnvFile),
              apiBaseUrl,
            }
          : {}),
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
