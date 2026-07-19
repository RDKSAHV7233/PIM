/* eslint-disable no-console */
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env");
const webRoot = path.join(root, "apps", "web");
const nextDir = path.join(root, "apps", "web", ".next");
const nextServerDir = path.join(nextDir, "server");
const nextCli = require.resolve("next/dist/bin/next", {
  paths: [webRoot],
});

function loadEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) {
    return values;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const hash = value.indexOf(" #");
    if (hash >= 0) {
      value = value.slice(0, hash).trim();
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const fileEnv = loadEnvFile(envFile);
const skipWebBuild = String(process.env.PLAYWRIGHT_SKIP_WEB_BUILD || "").trim() === "1";
const forceWebBuild = String(process.env.PLAYWRIGHT_FORCE_WEB_BUILD || "").trim() === "1";
const webServerMode = String(process.env.PLAYWRIGHT_WEB_SERVER_MODE || "start").trim().toLowerCase();
const useDevServer = webServerMode === "dev";
const phaseStartedAt = Date.now();
const webBuildTimeoutMs = Number.parseInt(process.env.PLAYWRIGHT_WEB_BUILD_TIMEOUT_MS || "240000", 10);
const requiredAppPaths = [
  "/api/auth/login/route",
  "/api/auth/logout/route",
  "/dashboard/page",
  "/login/page",
];
const authMode =
  String(process.env.PLAYWRIGHT_AUTH_MODE || process.env.AUTH_MODE || fileEnv.AUTH_MODE || "local")
    .trim()
    .toLowerCase() || "local";
const playwrightTenantKey =
  process.env.PLAYWRIGHT_TENANT_KEY || process.env.PIM_DEFAULT_TENANT_KEY || fileEnv.PIM_DEFAULT_TENANT_KEY || "default";
const playwrightWorkspaceSlug =
  process.env.PLAYWRIGHT_WORKSPACE || process.env.PIM_DEFAULT_WORKSPACE_SLUG || fileEnv.PIM_DEFAULT_WORKSPACE_SLUG || "default";

function logPhase(message, extra = {}) {
  const elapsedMs = Date.now() - phaseStartedAt;
  console.log(
    `[playwright-web] ${message} ${JSON.stringify({
      elapsedMs,
      workspace: playwrightWorkspaceSlug,
      tenant: playwrightTenantKey,
      ...extra,
    })}`,
  );
}

const identityDirectory =
  process.env.PLAYWRIGHT_AUTH_IDENTITIES_JSON !== undefined
    ? process.env.PLAYWRIGHT_AUTH_IDENTITIES_JSON
    : authMode === "db"
      ? ""
      : JSON.stringify({
          "admin@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "admin", assignedRoles: ["admin", "product_admin", "system_admin"] },
          "editor@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "editor" },
          "publisher@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "publisher" },
          "approver@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "approver" },
          "channel_manager@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "channel_manager" },
          "connector_admin@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "connector_admin" },
          "reviewer@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "reviewer" },
          "viewer@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "viewer" },
        });
const workspaceDirectory =
  process.env.PLAYWRIGHT_AUTH_WORKSPACES_JSON !== undefined
    ? process.env.PLAYWRIGHT_AUTH_WORKSPACES_JSON
    : authMode === "db"
      ? ""
      : process.env.PIM_AUTH_WORKSPACES_JSON ||
        fileEnv.PIM_AUTH_WORKSPACES_JSON ||
        JSON.stringify({
          [playwrightWorkspaceSlug]: { tenantId: playwrightTenantKey, displayName: playwrightWorkspaceSlug === "default" ? "Default" : "Media QA" },
        });

function clearNextBuild() {
  try {
    fs.rmSync(nextDir, { recursive: true, force: true });
  } catch (error) {
    console.error("Failed to clear apps/web/.next before Playwright build:", error);
    process.exit(1);
  }
}

function runWebBuild() {
  logPhase("build:start", { timeoutMs: Number.isFinite(webBuildTimeoutMs) ? webBuildTimeoutMs : 240000 });
  return spawnSync("npm", ["run", "build", "--workspace", "@pim1/web"], {
    cwd: root,
    shell: true,
    stdio: "inherit",
    timeout: Number.isFinite(webBuildTimeoutMs) ? webBuildTimeoutMs : 240_000,
    env: {
      ...fileEnv,
      ...process.env,
      PLAYWRIGHT_E2E_BUILD: "1",
      PIM_API_BASE_URL: process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1",
    },
  });
}

function nextBuildIsUsable() {
  const appPathsManifestPath = path.join(nextServerDir, "app-paths-manifest.json");
  if (
    !fs.existsSync(path.join(nextDir, "BUILD_ID")) ||
    !fs.existsSync(appPathsManifestPath)
  ) {
    return false;
  }

  try {
    const appPathsManifest = JSON.parse(fs.readFileSync(appPathsManifestPath, "utf8"));
    const missingRequiredPaths = requiredAppPaths.filter((route) => !appPathsManifest[route]);
    if (missingRequiredPaths.length > 0) {
      logPhase("build:unusable-manifest", { missingRequiredPaths });
      return false;
    }
  } catch (error) {
    logPhase("build:unusable-manifest", { error: String(error) });
    return false;
  }

  const runtimePath = path.join(nextServerDir, "webpack-runtime.js");
  const chunksDir = path.join(nextServerDir, "chunks");
  if (!fs.existsSync(runtimePath) || !fs.existsSync(chunksDir)) {
    return true;
  }

  const runtime = fs.readFileSync(runtimePath, "utf8");
  const expectsRootChunks = runtime.includes('return "" + chunkId + ".js"');
  if (!expectsRootChunks) {
    return true;
  }

  const chunkFiles = fs.readdirSync(chunksDir).filter((entry) => /^\d+\.js$/.test(entry));
  return chunkFiles.slice(0, 25).every((entry) => fs.existsSync(path.join(nextServerDir, entry)));
}

function repairRootChunkLayout() {
  const runtimePath = path.join(nextServerDir, "webpack-runtime.js");
  const chunksDir = path.join(nextServerDir, "chunks");
  if (!fs.existsSync(runtimePath) || !fs.existsSync(chunksDir)) {
    return 0;
  }
  const runtime = fs.readFileSync(runtimePath, "utf8");
  if (!runtime.includes('return "" + chunkId + ".js"')) {
    return 0;
  }
  let copied = 0;
  for (const entry of fs.readdirSync(chunksDir)) {
    if (!/^\d+\.js$/.test(entry)) {
      continue;
    }
    const source = path.join(chunksDir, entry);
    const destination = path.join(nextServerDir, entry);
    if (fs.existsSync(destination)) {
      continue;
    }
    fs.copyFileSync(source, destination);
    copied += 1;
  }
  if (copied > 0) {
    logPhase("build:repair-root-chunks", { copied });
  }
  return copied;
}

const hasUsableNextBuild = useDevServer ? false : nextBuildIsUsable();

if (useDevServer) {
  logPhase("build:skipped", { reason: "dev_server_mode" });
} else if (!skipWebBuild && (forceWebBuild || !hasUsableNextBuild)) {
  logPhase("cache:clear", { reason: forceWebBuild ? "forced" : "missing_or_unusable_build" });
  clearNextBuild();

  let build = runWebBuild();

  if ((build.status !== 0 || !nextBuildIsUsable()) && !forceWebBuild) {
    console.warn("[playwright-web] Web build did not produce a usable .next build; retrying once with a clean cache.");
    clearNextBuild();
    build = runWebBuild();
  }

  if (build.status !== 0 || !nextBuildIsUsable()) {
    logPhase("build:failed", { status: build.status, signal: build.signal, error: build.error ? String(build.error) : null });
    process.exit(build.status ?? 1);
  }
  repairRootChunkLayout();
  logPhase("build:ready");
} else if (hasUsableNextBuild) {
  repairRootChunkLayout();
  logPhase("build:reuse");
}

if (!useDevServer) {
  repairRootChunkLayout();
}

const env = {
  ...fileEnv,
  ...process.env,
  PORT: process.env.PLAYWRIGHT_WEB_PORT || "3001",
  APP_ENV: "development",
  AUTH_MODE: authMode,
  PIM_API_BASE_URL: process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1",
  JWT_SECRET: process.env.JWT_SECRET || fileEnv.JWT_SECRET || "vexa-pim-local-dev-jwt-secret-minimum-length-32",
  PIM_DEFAULT_TENANT_KEY: playwrightTenantKey,
  PIM_DEFAULT_WORKSPACE_SLUG: playwrightWorkspaceSlug,
  PIM_AUTH_IDENTITIES_JSON: identityDirectory,
  JWT_EXPIRY: process.env.JWT_EXPIRY || fileEnv.JWT_EXPIRY || "4h",
  CREDENTIAL_ENCRYPTION_KEY_V1:
    process.env.CREDENTIAL_ENCRYPTION_KEY_V1 ||
    fileEnv.CREDENTIAL_ENCRYPTION_KEY_V1 ||
    "vexa-pim-local-encryption-key-v1-minimum-32",
  CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION:
    process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION ||
    fileEnv.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION ||
    "1",
};

if (workspaceDirectory !== undefined) {
  env.PIM_AUTH_WORKSPACES_JSON = workspaceDirectory;
}

const child = useDevServer
  ? spawn(process.execPath, [nextCli, "dev", "-p", env.PORT], {
      cwd: webRoot,
      shell: false,
      stdio: "inherit",
      env,
    })
  : spawn("npm", ["run", "start", "--workspace", "@pim1/web", "--", "-p", env.PORT], {
      cwd: root,
      shell: true,
      stdio: "inherit",
      env,
    });

logPhase("server:start", { port: env.PORT, authMode, mode: useDevServer ? "dev" : "start" });

function shutdown(signal) {
  if (!child.killed) {
    child.kill(signal);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
