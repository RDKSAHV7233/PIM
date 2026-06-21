/* eslint-disable no-console */
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env");
const nextDir = path.join(root, "apps", "web", ".next");

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
const authMode =
  String(process.env.PLAYWRIGHT_AUTH_MODE || process.env.AUTH_MODE || fileEnv.AUTH_MODE || "local")
    .trim()
    .toLowerCase() || "local";
const identityDirectory =
  process.env.PLAYWRIGHT_AUTH_IDENTITIES_JSON !== undefined
    ? process.env.PLAYWRIGHT_AUTH_IDENTITIES_JSON
    : authMode === "db"
      ? ""
      : JSON.stringify({
          "admin@vexa-pim.local": { tenantId: "default", role: "admin", assignedRoles: ["admin", "product_admin", "system_admin"] },
          "editor@vexa-pim.local": { tenantId: "default", role: "editor" },
          "publisher@vexa-pim.local": { tenantId: "default", role: "publisher" },
          "approver@vexa-pim.local": { tenantId: "default", role: "approver" },
          "channel_manager@vexa-pim.local": { tenantId: "default", role: "channel_manager" },
          "connector_admin@vexa-pim.local": { tenantId: "default", role: "connector_admin" },
          "reviewer@vexa-pim.local": { tenantId: "default", role: "reviewer" },
          "viewer@vexa-pim.local": { tenantId: "default", role: "viewer" },
        });
const workspaceDirectory =
  process.env.PLAYWRIGHT_AUTH_WORKSPACES_JSON !== undefined
    ? process.env.PLAYWRIGHT_AUTH_WORKSPACES_JSON
    : authMode === "db"
      ? ""
      : process.env.PIM_AUTH_WORKSPACES_JSON ?? fileEnv.PIM_AUTH_WORKSPACES_JSON;

if (!skipWebBuild) {
  try {
    fs.rmSync(nextDir, { recursive: true, force: true });
  } catch (error) {
    console.error("Failed to clear apps/web/.next before Playwright build:", error);
    process.exit(1);
  }

  const build = spawnSync("npm", ["run", "build", "--workspace", "@pim1/web"], {
    cwd: root,
    shell: true,
    stdio: "inherit",
    env: {
      ...fileEnv,
      ...process.env,
      PIM_API_BASE_URL: process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1",
    },
  });

  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

const env = {
  ...fileEnv,
  ...process.env,
  PORT: process.env.PLAYWRIGHT_WEB_PORT || "3001",
  APP_ENV: "development",
  AUTH_MODE: authMode,
  PIM_API_BASE_URL: process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1",
  JWT_SECRET: process.env.JWT_SECRET || fileEnv.JWT_SECRET || "vexa-pim-local-dev-jwt-secret-minimum-length-32",
  PIM_DEFAULT_TENANT_KEY: process.env.PLAYWRIGHT_TENANT_KEY || process.env.PIM_DEFAULT_TENANT_KEY || fileEnv.PIM_DEFAULT_TENANT_KEY || "default",
  PIM_DEFAULT_WORKSPACE_SLUG:
    process.env.PLAYWRIGHT_WORKSPACE || process.env.PIM_DEFAULT_WORKSPACE_SLUG || fileEnv.PIM_DEFAULT_WORKSPACE_SLUG || "default",
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

const child = spawn("npm", ["run", "start", "--workspace", "@pim1/web", "--", "-p", env.PORT], {
  cwd: root,
  shell: true,
  stdio: "inherit",
  env,
});

function shutdown(signal) {
  if (!child.killed) {
    child.kill(signal);
  }
}

const child = spawn("npm", ["run", "start", "--workspace", "@pim1/web", "--", "-p", env.PORT], {
  cwd: root,
  shell: true,
  stdio: "inherit",
  env,
});

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
