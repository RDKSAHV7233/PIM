const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const WEB_PACKAGE_JSON = path.join(REPO_ROOT, "apps", "web", "package.json");
const START_SERVER_SCRIPT = path.join(REPO_ROOT, "apps", "web", "scripts", "start-server.cjs");
const HEALTH_ROUTE = path.join(REPO_ROOT, "apps", "web", "src", "app", "health", "route.ts");
const PREPARE_WEB_PACKAGE_SCRIPT = path.join(REPO_ROOT, "scripts", "prepare-railway-web-package.cjs");

function main() {
  const packageJson = JSON.parse(fs.readFileSync(WEB_PACKAGE_JSON, "utf8"));
  const startServerScript = fs.readFileSync(START_SERVER_SCRIPT, "utf8");
  const healthRouteSource = fs.readFileSync(HEALTH_ROUTE, "utf8");
  const result = spawnSync(process.execPath, [PREPARE_WEB_PACKAGE_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      STAGING_BASE_URL: "https://api-staging.up.railway.app",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || "prepare-railway-web-package failed");
  const outputDir = path.join(REPO_ROOT, ".tmp", "railway-web-service");
  const preparedPackageJson = JSON.parse(fs.readFileSync(path.join(outputDir, "package.json"), "utf8"));
  const preparedTsconfig = JSON.parse(fs.readFileSync(path.join(outputDir, "tsconfig.json"), "utf8"));
  const railwayToml = fs.readFileSync(path.join(outputDir, "railway.toml"), "utf8");
  const mirroredRailwayToml = fs.readFileSync(path.join(outputDir, "apps", "web", "railway.toml"), "utf8");
  const dockerfile = fs.readFileSync(path.join(outputDir, "Dockerfile"), "utf8");
  const envProduction = fs.readFileSync(path.join(outputDir, ".env.production"), "utf8");
  const nvmrc = fs.readFileSync(path.join(outputDir, ".nvmrc"), "utf8").trim();
  const runnerStage = dockerfile.split("FROM node:20-alpine AS runner")[1] ?? "";
  const sourceRefreshManifest = JSON.parse(
    fs.readFileSync(path.join(outputDir, ".source-refresh-manifest.json"), "utf8"),
  );
  const sourceRefreshFile = sourceRefreshManifest.files.find(
    (entry) => entry.path === "src/components/nav/global-search.tsx",
  );
  const postcssConfigRefreshFile = sourceRefreshManifest.files.find(
    (entry) => entry.path === "postcss.config.js",
  );

  assert.equal(
    packageJson.scripts.start,
    "node ./scripts/start-server.cjs",
    "Web start script must run through the PORT-aware launcher so Railway can assign the runtime port.",
  );
  assert(
    startServerScript.includes('process.env.PORT ?? "3000"') &&
      startServerScript.includes('[nextCli, "start", "-p", port]'),
    "PORT-aware launcher must prefer Railway's PORT and fall back to 3000 locally.",
  );
  assert(
    healthRouteSource.includes('status: "ok"') &&
      healthRouteSource.includes('service: "web"') &&
      healthRouteSource.includes("cache-control"),
    "Web health route must return a no-store 200 OK payload for deploy healthchecks.",
  );
  assert(
    railwayToml.includes('healthcheckPath = "/health"') &&
      mirroredRailwayToml === railwayToml,
    "Prepared Railway web package must target the dedicated /health endpoint and mirror railway.toml at both the flat package root and apps/web.",
  );
  assert(
    railwayToml.includes('installCommand = "npm ci --include=dev"') &&
      railwayToml.includes('buildCommand = "npm run build"') &&
      dockerfile.includes("COPY package.json package-lock.json .npmrc ./") &&
      dockerfile.includes("RUN npm ci --include=dev") &&
      dockerfile.includes("Buffer.from(file.data,'base64')") &&
      dockerfile.includes("fs.rmSync('.source-refresh-manifest.json')"),
    "Prepared Railway web package must use npm ci, include the lockfile, and restore a clean base64 source manifest before the Docker build runs.",
  );
  assert(
    dockerfile.includes("FROM node:20-alpine AS deps") &&
      dockerfile.includes("RUN npm ci --omit=dev") &&
      dockerfile.includes("ENV NODE_OPTIONS=--max-old-space-size=3072") &&
      dockerfile.includes("COPY --from=deps /app/node_modules ./node_modules") &&
      !runnerStage.includes("COPY --from=build /app ./"),
    "Runner stage must use production-only deps from deps stage and not copy full devDependency node_modules.",
  );
  assert(
    dockerfile.includes("ARG PIM_API_BASE_URL") &&
      dockerfile.includes("ENV PIM_API_BASE_URL=${PIM_API_BASE_URL}") &&
      dockerfile.includes("ARG NEXT_PUBLIC_API_URL") &&
      dockerfile.includes("ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}") &&
      dockerfile.includes("ARG PIM_API_BASE_URL_FALLBACK") &&
      dockerfile.includes("ENV PIM_API_BASE_URL_FALLBACK=${PIM_API_BASE_URL_FALLBACK}") &&
      runnerStage.includes("ENV PIM_API_BASE_URL=${PIM_API_BASE_URL}") &&
      runnerStage.includes("ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}") &&
      runnerStage.includes("ENV PIM_API_BASE_URL_FALLBACK=${PIM_API_BASE_URL_FALLBACK}"),
    "Prepared Railway web package Dockerfile must preserve canonical API upstream env vars in both build and runner stages.",
  );
  assert(
    envProduction.includes("PIM_API_BASE_URL=https://api-staging.up.railway.app/api/v1") &&
      envProduction.includes("NEXT_PUBLIC_API_URL=https://api-staging.up.railway.app/api/v1") &&
      envProduction.includes("PIM_API_BASE_URL_FALLBACK=https://api-staging.up.railway.app/api/v1"),
    "Prepared Railway web package must emit a normalized .env.production with canonical and fallback API upstream URLs.",
  );
  assert(
    fs.existsSync(path.join(outputDir, "package-lock.json")),
    "Prepared Railway web package must include package-lock.json for reproducible installs.",
  );
  assert(
    preparedPackageJson.name === "@pim1/web" &&
      preparedPackageJson.version === packageJson.version &&
      typeof preparedPackageJson.railwaySnapshotNonce === "string" &&
      preparedPackageJson.railwaySnapshotNonce.length > 0 &&
      nvmrc === "20",
    "Prepared Railway web package must pin Node 20 and include a watched-file nonce so Railway cannot skip corrupted file-upload refresh deploys.",
  );
  assert.equal(
    preparedPackageJson.dependencies.dotenv,
    "^17.4.1",
    "Prepared Railway web package must include dotenv because the build-time env loader requires it inside the Docker image.",
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(preparedTsconfig, "extends"),
    false,
    "Prepared Railway web package must inline base tsconfig options so Railway builds do not depend on a secondary config hop.",
  );
  assert(
    typeof sourceRefreshManifest.generatedAt === "string" &&
      Boolean(sourceRefreshFile?.data) &&
      Boolean(postcssConfigRefreshFile?.data) &&
      Buffer.from(sourceRefreshFile.data, "base64").length > 0,
    "Prepared Railway web package must include a base64 package manifest so Railway builds can reconstruct clean source and config files even if snapshot uploads corrupt raw entries.",
  );

  console.log("railway web runtime contract OK");
}

try {
  main();
} catch (error) {
  console.error("Railway web runtime contract test failed:");
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
