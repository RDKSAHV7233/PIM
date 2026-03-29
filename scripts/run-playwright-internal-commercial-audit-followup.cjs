#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env");

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

function playwrightInvocation(specPath) {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", `npx playwright test ${specPath} --config=playwright.config.cjs`],
    };
  }
  return {
    command: "npx",
    args: ["playwright", "test", specPath, "--config=playwright.config.cjs"],
  };
}

function resolveDatabaseUrl(fileEnv) {
  const localDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/pim1?schema=public";
  const resolved = String(
    process.env.DATABASE_URL_POOLED ||
      process.env.DATABASE_URL ||
      fileEnv.DATABASE_URL_POOLED ||
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

function main() {
  const fileEnv = loadEnvFile(envFile);
  const databaseUrl = withConnectionLimit(resolveDatabaseUrl(fileEnv), 2);
  const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const apiPort = 4700 + Math.floor(Math.random() * 100);
  const webPort = 3700 + Math.floor(Math.random() * 100);
  const outboxDir = path.join(root, ".runlogs", `playwright-internal-commercial-audit-outbox-${runId}`);
  fs.rmSync(outboxDir, { recursive: true, force: true });
  fs.mkdirSync(outboxDir, { recursive: true });

  const env = {
    ...process.env,
    ...fileEnv,
    PLAYWRIGHT_API_PORT: String(apiPort),
    PLAYWRIGHT_WEB_PORT: String(webPort),
    PLAYWRIGHT_API_URL: `http://127.0.0.1:${apiPort}/api/v1`,
    PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${webPort}`,
    PLAYWRIGHT_AUTH_MODE: "db",
    PLAYWRIGHT_AUTH_IDENTITIES_JSON: "",
    PLAYWRIGHT_AUTH_WORKSPACES_JSON: "",
    PLAYWRIGHT_SIGNUP_OUTBOX_DIR: outboxDir,
    FEATURE_PUBLIC_SIGNUP_ENABLED: "true",
    NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED: "true",
    AUTH_EMAIL_PROVIDER: "file",
    AUTH_EMAIL_OUTBOX_DIR: outboxDir,
    PIM_COMMERCIAL_CONTACT_EMAIL: "commercial@tej.example",
    PIM_COMMERCIAL_OPS_TOKEN: "playwright-commercial-ops-token",
    APP_ENV: "development",
    DATABASE_URL: databaseUrl,
    DATABASE_URL_POOLED: databaseUrl,
    DATABASE_URL_DIRECT: databaseUrl,
  };

  const invocation = playwrightInvocation("apps/web/test/e2e/internal-commercial-audit-followup.spec.js");
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env,
  });

  fs.rmSync(outboxDir, { recursive: true, force: true });
  if (typeof result.status === "number") {
    process.exit(result.status);
  }
  if (result.error) {
    throw result.error;
  }
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
