#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Prepares a flat, self-contained Railway web service package.
 *
 * Copies apps/web into .tmp/railway-web-service as a flat project with no npm
 * workspaces so Railpack installs a single package and Next resolves
 * `.env.production` from the project root.
 */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(repoRoot, "apps", "web");
const tsconfigBaseSource = path.join(repoRoot, "tsconfig.base.json");
const rootPackageLockSource = path.join(repoRoot, "package-lock.json");
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
  if (!fs.existsSync(rootPackageLockSource)) {
    throw new Error(`Root package-lock.json not found: ${rootPackageLockSource}`);
  }

  const sourcePkgJson = JSON.parse(fs.readFileSync(path.join(sourceDir, "package.json"), "utf8"));

  removeDir(outputDir);
  copyDir(sourceDir, outputDir);
  fs.copyFileSync(tsconfigBaseSource, path.join(outputDir, "tsconfig.base.json"));
  fs.copyFileSync(rootPackageLockSource, path.join(outputDir, "package-lock.json"));

  const tsconfigPath = path.join(outputDir, "tsconfig.json");
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
  tsconfig.extends = "./tsconfig.base.json";
  fs.writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, "utf8");

  const runtimeDependencies = sourcePkgJson.dependencies ?? {};
  const devDependencies = sourcePkgJson.devDependencies ?? {};
  const allDeps = {
    ...devDependencies,
    ...runtimeDependencies,
  };
  const normalizedBuildScript = String(sourcePkgJson.scripts?.build ?? "")
    .replace(/NODE_OPTIONS='--max-old-space-size=1024'\s*/g, "")
    .trim();

  const packageJsonPath = path.join(outputDir, "package.json");
  fs.writeFileSync(
    packageJsonPath,
    `${JSON.stringify(
      {
        name: sourcePkgJson.name,
        private: true,
        version: sourcePkgJson.version,
        dependencies: runtimeDependencies,
        devDependencies,
        scripts: {
          ...(sourcePkgJson.scripts ?? {}),
          ...(normalizedBuildScript ? { build: normalizedBuildScript } : {}),
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  fs.writeFileSync(path.join(outputDir, ".npmrc"), "production=false\n", "utf8");
  fs.writeFileSync(path.join(outputDir, ".nvmrc"), "20\n", "utf8");

  const railwayTomlContents = [
    "[build]",
    'installCommand = "npm ci --include=dev"',
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
  const appRailwayTomlDir = path.join(outputDir, "apps", "web");
  ensureDir(appRailwayTomlDir);
  fs.writeFileSync(path.join(appRailwayTomlDir, "railway.toml"), railwayTomlContents, "utf8");
  const dockerfileContents = [
    "FROM node:20-alpine AS build",
    "WORKDIR /app",
    "",
    "COPY package.json package-lock.json .npmrc ./",
    "RUN npm ci --include=dev",
    "",
    "COPY . .",
    "ARG PIM_API_BASE_URL",
    "ENV PIM_API_BASE_URL=${PIM_API_BASE_URL}",
    "ARG NEXT_PUBLIC_API_URL",
    "ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}",
    "ARG PIM_API_BASE_URL_FALLBACK",
    "ENV PIM_API_BASE_URL_FALLBACK=${PIM_API_BASE_URL_FALLBACK}",
    "RUN npm run build",
    "",
    "FROM node:20-alpine AS runner",
    "WORKDIR /app",
    "",
    "ENV NODE_ENV=production",
    "ARG PIM_API_BASE_URL",
    "ENV PIM_API_BASE_URL=${PIM_API_BASE_URL}",
    "ARG NEXT_PUBLIC_API_URL",
    "ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}",
    "ARG PIM_API_BASE_URL_FALLBACK",
    "ENV PIM_API_BASE_URL_FALLBACK=${PIM_API_BASE_URL_FALLBACK}",
    "ENV PORT=3000",
    "",
    "COPY --from=build /app ./",
    "",
    "EXPOSE 3000",
    "",
    'CMD ["npm", "run", "start"]',
    "",
  ].join("\n");
  const dockerfilePath = path.join(outputDir, "Dockerfile");
  fs.writeFileSync(dockerfilePath, dockerfileContents, "utf8");
  const railwayJsonContents = `${JSON.stringify(
    {
      $schema: "https://railway.app/railway.schema.json",
      build: {
        dockerfilePath: "Dockerfile",
      },
      deploy: {
        healthcheckPath: "/health",
        healthcheckTimeout: 300,
        restartPolicyType: "ON_FAILURE",
        restartPolicyMaxRetries: 10,
      },
    },
    null,
    2,
  )}\n`;
  const railwayJsonPath = path.join(outputDir, "railway.json");
  fs.writeFileSync(railwayJsonPath, railwayJsonContents, "utf8");

  const nextConfigTsPath = path.join(outputDir, "next.config.ts");
  if (fs.existsSync(nextConfigTsPath)) {
    const tsSource = fs.readFileSync(nextConfigTsPath, "utf8");
    const jsSource = tsSource
      .replace(/^import type \{[^}]+\} from ['"][^'"]+['"];\n?/m, "")
      .replace(/^import (\w+) from ['"](.+?)['"];/gm, 'const $1 = require("$2");')
      .replace(/^(const \w+): \w+ = \{/m, "$1 = {")
      .replace(/path\.join\(__dirname,\s*["']\.\.\/\.\.\/["']\)/, "__dirname")
      .replace(/^export default (\w+);/m, "module.exports = $1;");
    fs.writeFileSync(path.join(outputDir, "next.config.js"), jsSource, "utf8");
    fs.rmSync(nextConfigTsPath);
  }

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
    fs.writeFileSync(path.join(appRailwayTomlDir, ".env.production"), envContents, "utf8");
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outputDir: path.relative(repoRoot, outputDir),
        packageJson: path.relative(repoRoot, packageJsonPath),
        packageLock: path.relative(repoRoot, path.join(outputDir, "package-lock.json")),
        dockerfile: path.relative(repoRoot, dockerfilePath),
        railwayJson: path.relative(repoRoot, railwayJsonPath),
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
