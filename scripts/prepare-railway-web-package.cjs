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
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
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

function collectFiles(rootDir, currentDir = rootDir) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(rootDir, entryPath));
      continue;
    }
    files.push(entryPath);
  }

  return files;
}

function writeSourceRefreshManifest(outputRoot) {
  const manifestPath = path.join(outputRoot, ".source-refresh-manifest.json");
  const files = collectFiles(outputRoot)
    .filter((filePath) => path.basename(filePath) !== ".source-refresh-manifest.json")
    .map((filePath) => ({
      path: path.relative(outputRoot, filePath).replace(/\\/g, "/"),
      data: fs.readFileSync(filePath).toString("base64"),
    }));

  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        files,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return manifestPath;
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
  const tsconfigBase = JSON.parse(fs.readFileSync(tsconfigBaseSource, "utf8"));
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
  tsconfig.compilerOptions = {
    ...(tsconfigBase.compilerOptions ?? {}),
    ...(tsconfig.compilerOptions ?? {}),
  };
  delete tsconfig.extends;
  fs.writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, "utf8");

  const runtimeDependencies = sourcePkgJson.dependencies ?? {};
  const devDependencies = sourcePkgJson.devDependencies ?? {};
  const railwaySnapshotNonce = Date.now().toString(36);
  const allDeps = {
    ...devDependencies,
    ...runtimeDependencies,
  };
  const dotenvVersion = runtimeDependencies.dotenv || devDependencies.dotenv || "^17.4.1";
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
        railwaySnapshotNonce,
        dependencies: {
          ...runtimeDependencies,
          dotenv: dotenvVersion,
        },
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
  const sourceRefreshRestoreCmd = `RUN node -e "const fs=require('node:fs');const path=require('node:path');const manifest=JSON.parse(fs.readFileSync('.source-refresh-manifest.json','utf8'));for(const file of manifest.files){const target=path.join(process.cwd(),file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.from(file.data,'base64'));}fs.rmSync('.source-refresh-manifest.json');"`;
  const dockerfileContents = [
    // Stage 1: production-only dependencies (~60 MB vs ~600 MB with devDependencies).
    // This stage is referenced by the runner so devDependencies never reach the image.
    "FROM node:20-alpine AS deps",
    "WORKDIR /app",
    "",
    "COPY package.json package-lock.json .npmrc ./",
    "RUN npm ci --omit=dev",
    "",
    // Stage 2: full build with devDependencies
    "FROM node:20-alpine AS build",
    "WORKDIR /app",
    "",
    "COPY package.json package-lock.json .npmrc ./",
    "RUN npm ci --include=dev",
    "",
    "COPY . .",
    sourceRefreshRestoreCmd,
    "ARG PIM_API_BASE_URL",
    "ENV PIM_API_BASE_URL=${PIM_API_BASE_URL}",
    "ARG NEXT_PUBLIC_API_URL",
    "ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}",
    "ARG PIM_API_BASE_URL_FALLBACK",
    "ENV PIM_API_BASE_URL_FALLBACK=${PIM_API_BASE_URL_FALLBACK}",
    // Cap build-time heap — prevents OOM on Railway build nodes under memory pressure
    "ENV NODE_OPTIONS=--max-old-space-size=3072",
    "RUN npm run build",
    "",
    // Stage 3: lean production runner — only artifacts needed at runtime
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
    // Production node_modules only — TypeScript, Tailwind, and other devDeps excluded
    "COPY --from=deps /app/node_modules ./node_modules",
    // Next.js compiled output and static assets
    "COPY --from=build /app/.next ./.next",
    "COPY --from=build /app/public ./public",
    // Package manifest and PORT-aware runtime launcher
    "COPY --from=build /app/package.json ./",
    "COPY --from=build /app/scripts ./scripts",
    // Next.js server config (converted from .ts by prepare script)
    "COPY --from=build /app/next.config.js ./",
    // Runtime environment variables (API upstream URL)
    "COPY --from=build /app/.env.production ./.env.production",
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
  const envContents = apiBaseUrl
    ? [
        `PIM_API_BASE_URL=${apiBaseUrl}`,
        `NEXT_PUBLIC_API_URL=${apiBaseUrl}`,
        `PIM_API_BASE_URL_FALLBACK=${apiBaseUrl}`,
        "",
      ].join("\n")
    : "";
  // Always write .env.production so the Dockerfile COPY is unconditional,
  // even when no API URL is configured (e.g. local dry-run without STAGING_BASE_URL).
  const envFile = path.join(outputDir, ".env.production");
  fs.writeFileSync(envFile, envContents, "utf8");
  fs.writeFileSync(path.join(appRailwayTomlDir, ".env.production"), envContents, "utf8");

  const sourceRefreshManifest = writeSourceRefreshManifest(outputDir);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outputDir: path.relative(repoRoot, outputDir),
        packageJson: path.relative(repoRoot, packageJsonPath),
        packageLock: path.relative(repoRoot, path.join(outputDir, "package-lock.json")),
        dockerfile: path.relative(repoRoot, dockerfilePath),
        railwayJson: path.relative(repoRoot, railwayJsonPath),
        sourceRefreshManifest: path.relative(repoRoot, sourceRefreshManifest),
        railwaySnapshotNonce,
        deps: Object.keys(allDeps),
        envFile: path.relative(repoRoot, envFile),
        ...(apiBaseUrl ? { apiBaseUrl } : {}),
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
