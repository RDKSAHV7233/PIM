const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const WEB_PACKAGE_JSON = path.join(REPO_ROOT, "apps", "web", "package.json");
const START_SERVER_SCRIPT = path.join(REPO_ROOT, "apps", "web", "scripts", "start-server.cjs");
const HEALTH_ROUTE = path.join(REPO_ROOT, "apps", "web", "src", "app", "health", "route.ts");
const PREPARE_WEB_PACKAGE_SCRIPT = path.join(REPO_ROOT, "scripts", "prepare-railway-web-package.cjs");

function main() {
  const packageJson = JSON.parse(fs.readFileSync(WEB_PACKAGE_JSON, "utf8"));
  const startServerScript = fs.readFileSync(START_SERVER_SCRIPT, "utf8");
  const healthRouteSource = fs.readFileSync(HEALTH_ROUTE, "utf8");
  const prepareWebPackageScript = fs.readFileSync(PREPARE_WEB_PACKAGE_SCRIPT, "utf8");

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
    prepareWebPackageScript.includes('healthcheckPath = "/health"') &&
      prepareWebPackageScript.includes('const appRailwayTomlPath = path.join(appOutputDir, "railway.toml");'),
    "Prepared Railway web package must target the dedicated /health endpoint and write railway.toml inside apps/web for Railway source-path deploys.",
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
