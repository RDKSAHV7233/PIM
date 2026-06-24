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
  const railwayToml = fs.readFileSync(path.join(outputDir, "railway.toml"), "utf8");
  const mirroredRailwayToml = fs.readFileSync(path.join(outputDir, "apps", "web", "railway.toml"), "utf8");
  const dockerfile = fs.readFileSync(path.join(outputDir, "Dockerfile"), "utf8");
  const envProduction = fs.readFileSync(path.join(outputDir, ".env.production"), "utf8");
  const nvmrc = fs.readFileSync(path.join(outputDir, ".nvmrc"), "utf8").trim();
  const runnerStage = dockerfile.split("FROM node:20-alpine AS runner")[1] ?? "";

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
    "Prepared Railway web package must target the dedicated /health endpoint and keep the package-root railway.toml mirrored under apps/web for compatibility.",
  );
  assert(
    railwayToml.includes('installCommand = "npm ci --include=dev"') &&
      railwayToml.includes('buildCommand = "npm run build"') &&
      dockerfile.includes("COPY package.json package-lock.json .npmrc ./") &&
      dockerfile.includes("RUN npm ci --include=dev"),
    "Prepared Railway web package must use npm ci and include the lockfile in the deterministic Docker build path.",
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
      nvmrc === "20",
    "Prepared Railway web package must pin Node 20 for the Railway flat package runtime.",
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
