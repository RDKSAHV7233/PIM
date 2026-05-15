/* eslint-disable no-console */
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env");

function resolveDatabaseUrl(fileEnv) {
  const localDatabaseUrl =
    process.env.PLAYWRIGHT_DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/pim1?schema=playwright_e2e";
  const resolved = String(
    process.env.PLAYWRIGHT_DATABASE_URL ||
    process.env.DATABASE_URL_POOLED ||
      process.env.DATABASE_URL_DIRECT ||
      process.env.DATABASE_URL ||
      fileEnv.DATABASE_URL_POOLED ||
      fileEnv.DATABASE_URL_DIRECT ||
      fileEnv.DATABASE_URL ||
      "",
  ).trim();
  return !resolved || /HOST:5432/i.test(resolved) ? localDatabaseUrl : resolved;
}

function withConnectionLimit(databaseUrl, connectionLimit) {
  try {
    const parsed = new URL(databaseUrl);
    parsed.searchParams.set("connection_limit", String(connectionLimit));
    return parsed.toString();
  } catch {
    return databaseUrl;
  }
}

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
const databaseUrl = withConnectionLimit(resolveDatabaseUrl(fileEnv), 1);
const usingPlaywrightFallbackDatabase = /schema=playwright_e2e/i.test(databaseUrl);
const authMode = String(process.env.PLAYWRIGHT_AUTH_MODE || process.env.AUTH_MODE || "local").trim().toLowerCase() || "local";
const playwrightBaseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001";
const identityDirectory =
  process.env.PLAYWRIGHT_AUTH_IDENTITIES_JSON !== undefined
    ? process.env.PLAYWRIGHT_AUTH_IDENTITIES_JSON
    : authMode === "db"
      ? ""
      : JSON.stringify({
          "admin@vexa-pim.local": { tenantId: "default", role: "admin" },
          "editor@vexa-pim.local": { tenantId: "default", role: "editor" },
          "reviewer@vexa-pim.local": { tenantId: "default", role: "reviewer" },
          "viewer@vexa-pim.local": { tenantId: "default", role: "viewer" },
        });
const workspaceDirectory =
  process.env.PLAYWRIGHT_AUTH_WORKSPACES_JSON !== undefined
    ? process.env.PLAYWRIGHT_AUTH_WORKSPACES_JSON
    : authMode === "db"
      ? ""
      : process.env.PIM_AUTH_WORKSPACES_JSON;

const prismaGenerate = spawnSync("npm", ["run", "prisma:generate"], {
  cwd: root,
  shell: true,
  stdio: "inherit",
  env: {
    ...fileEnv,
    ...process.env,
  },
});

if (prismaGenerate.status !== 0) {
  process.exit(prismaGenerate.status ?? 1);
}

const build = spawnSync("npm", ["run", "build", "--workspace", "@pim1/api"], {
  cwd: root,
  shell: true,
  stdio: "inherit",
  env: {
    ...fileEnv,
    ...process.env,
  },
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const schemaSync = spawnSync(
  "npx",
  usingPlaywrightFallbackDatabase
    ? ["prisma", "db", "push", "--schema", "packages/db/prisma/schema.prisma", "--skip-generate", "--accept-data-loss"]
    : ["prisma", "migrate", "deploy", "--schema", "packages/db/prisma/schema.prisma"],
  {
    cwd: root,
    shell: true,
    stdio: "inherit",
    env: {
      ...fileEnv,
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_URL_POOLED: databaseUrl,
      DATABASE_URL_DIRECT: databaseUrl,
    },
  },
);

if (schemaSync.status !== 0) {
  process.exit(schemaSync.status ?? 1);
}

const env = {
  ...fileEnv,
  ...process.env,
  PORT: process.env.PLAYWRIGHT_API_PORT || "4001",
  APP_ENV: "development",
  DATABASE_URL: databaseUrl,
  DATABASE_URL_POOLED: databaseUrl,
  DATABASE_URL_DIRECT: databaseUrl,
  AUTH_MODE: authMode,
  PIM_AUTH_PASSWORD: process.env.PLAYWRIGHT_PASSWORD || "vexa-pim-demo-password",
  PIM_DEFAULT_TENANT_KEY: process.env.PLAYWRIGHT_TENANT_KEY || "default",
  PIM_DEFAULT_WORKSPACE_SLUG: process.env.PLAYWRIGHT_WORKSPACE || "default",
  PIM_AUTH_IP_ATTEMPT_LIMIT: process.env.PLAYWRIGHT_AUTH_IP_ATTEMPT_LIMIT || "100",
  PIM_AUTH_REDIS_DISABLED: "true",
  JWT_BLOCKLIST_REDIS_DISABLED: "true",
  DASHBOARD_CACHE_REDIS_DISABLED: "true",
  JWT_SECRET: process.env.JWT_SECRET || fileEnv.JWT_SECRET || "vexa-pim-local-dev-jwt-secret-minimum-length-32",
  CREDENTIAL_ENCRYPTION_KEY_V1:
    process.env.CREDENTIAL_ENCRYPTION_KEY_V1 ||
    fileEnv.CREDENTIAL_ENCRYPTION_KEY_V1 ||
    "vexa-pim-local-encryption-key-v1-minimum-32",
  CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION:
    process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION ||
    fileEnv.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION ||
    "1",
  REDIS_URL: process.env.REDIS_URL || fileEnv.REDIS_URL || "redis://localhost:6379",
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || fileEnv.R2_ACCOUNT_ID || "local-dev",
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || fileEnv.R2_ACCESS_KEY_ID || "local-dev",
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || fileEnv.R2_SECRET_ACCESS_KEY || "local-dev",
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || fileEnv.R2_BUCKET_NAME || "vexa-pim-local",
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL || fileEnv.R2_PUBLIC_URL || "https://example.com/vexa-pim-local",
  PIM_WEB_BASE_URL: process.env.PIM_WEB_BASE_URL || playwrightBaseUrl,
  PIM_AUTH_IDENTITIES_JSON: identityDirectory,
};

if (workspaceDirectory !== undefined) {
  env.PIM_AUTH_WORKSPACES_JSON = workspaceDirectory;
}

const child = spawn("npm", ["run", "start", "--workspace", "@pim1/api"], {
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
