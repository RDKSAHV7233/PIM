#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Prepares a flat, self-contained Railway web service package.
 *
 * Copies apps/web into .tmp/railway-web-service as a FLAT project (no npm workspaces).
 * A single package.json lists every dependency as a regular `dependency` so
 * Railpack's `npm install` step installs them all regardless of NODE_ENV.
 */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(repoRoot, "apps", "web");
const tsconfigBaseSource = path.join(repoRoot, "tsconfig.base.json");
const outputDir = path.join(repoRoot, ".tmp", "railway-web-service");

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
      if (entry.name === ".next" || entry.name === "node_modules" || entry.name === "test" || entry.name === "test-results") {
        continue;
      }
      copyDir(sourcePath, targetPath);
      continue;
    }
    if (entry.name === "tsconfig.tsbuildinfo" || entry.name === "tsconfig.lint.tsbuildinfo") {
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

  const sourcePkgJson = JSON.parse(fs.readFileSync(path.join(sourceDir, "package.json"), "utf8"));

  removeDir(outputDir);

  // Copy web app files directly into outputDir (flat — no apps/web subdirectory).
  copyDir(sourceDir, outputDir);

  // tsconfig.base.json at root so tsconfig.json can extend it.
  fs.copyFileSync(tsconfigBaseSource, path.join(outputDir, "tsconfig.base.json"));

  // Patch tsconfig.json: the monorepo uses ../../tsconfig.base.json, but the flat
  // layout puts it right next to tsconfig.json.
  const tsconfigPath = path.join(outputDir, "tsconfig.json");
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
  tsconfig.extends = "./tsconfig.base.json";
  fs.writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, "utf8");

  // ── package.json ──────────────────────────────────────────────────────
  // Single flat package.json with ALL deps (production + dev) listed as
  // regular `dependencies`. No workspaces, no devDependencies section.
  // This guarantees `npm install` installs everything regardless of NODE_ENV.
  const allDeps = {
    ...(sourcePkgJson.devDependencies ?? {}),
    ...(sourcePkgJson.dependencies ?? {}), // production deps win on collision
  };

  const origBuildScript = sourcePkgJson.scripts?.build ?? "";
  const buildScript =
    origBuildScript.includes("next build") && !origBuildScript.includes("NODE_OPTIONS")
      ? origBuildScript.replace("next build", "NODE_OPTIONS='--max-old-space-size=1024' next build")
      : origBuildScript;

  const packageJsonPath = path.join(outputDir, "package.json");
  fs.writeFileSync(
    packageJsonPath,
    `${JSON.stringify(
      {
        name: "pim1-railway-web-service",
        private: true,
        dependencies: allDeps,
        scripts: {
          ...sourcePkgJson.scripts,
          build: buildScript,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  // ── .npmrc ────────────────────────────────────────────────────────────
  // Force production=false so npm never skips any dependency.
  fs.writeFileSync(path.join(outputDir, ".npmrc"), "production=false\n", "utf8");

  // ── .nvmrc ────────────────────────────────────────────────────────────
  // Pin Node.js 20 LTS. Railway's cached Node 24 has SWC binary issues.
  fs.writeFileSync(path.join(outputDir, ".nvmrc"), "20\n", "utf8");

  // ── railway.toml ──────────────────────────────────────────────────────
  const railwayTomlContents = [
    "[build]",
    'installCommand = "npm install --production=false"',
    'buildCommand = "npm run build"',
    "",
    "[deploy]",
    'startCommand = "npm run start"',
    'healthcheckPath = "/health"',
    "healthcheckTimeout = 300",
    'restartPolicyType = "ON_FAILURE"',
    "restartPolicyMaxRetries = 10",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(outputDir, "railway.toml"), railwayTomlContents, "utf8");

  // ── next.config.ts → next.config.js ───────────────────────────────────
  const nextConfigTsPath = path.join(outputDir, "next.config.ts");
  if (fs.existsSync(nextConfigTsPath)) {
    const tsSource = fs.readFileSync(nextConfigTsPath, "utf8");
    const jsSource = tsSource
      .replace(/^import type \{[^}]+\} from ['"][^'"]+['"];\n?/m, "")
      .replace(/^import (\w+) from ['"](.+?)['"];/gm, "const $1 = require(\"$2\");")
      .replace(/^(const \w+): \w+ = \{/m, "$1 = {")
      // In the flat layout __dirname IS the project root, so ../../ → .
      .replace(/path\.join\(__dirname,\s*["']\.\.\/\.\.\/["']\)/, "__dirname")
      .replace(/^export default (\w+);/m, "module.exports = $1;");
    fs.writeFileSync(path.join(outputDir, "next.config.js"), jsSource, "utf8");
    fs.rmSync(nextConfigTsPath);
  }

  // ── .env.production ───────────────────────────────────────────────────
  const apiBaseUrl = resolveApiBaseUrl(process.env);
  let envFile = null;
  if (apiBaseUrl) {
    const envContents = [
      `PIM_API_BASE_URL=${apiBaseUrl}`,
      `NEXT_PUBLIC_API_URL=${apiBaseUrl}`,
      `PIM_API_BASE_URL_FALLBACK=${apiBaseUrl}`,
      "",
    ].join("\n");
    envFile = path.join(outputDir, ".env.production");
    fs.writeFileSync(envFile, envContents, "utf8");
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outputDir: path.relative(repoRoot, outputDir),
        packageJson: path.relative(repoRoot, packageJsonPath),
        deps: Object.keys(allDeps),
        ...(envFile
          ? {
              envFile: path.relative(repoRoot, envFile),
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
