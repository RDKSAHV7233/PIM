#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env");
const apiBuildEntry = path.join(root, "apps", "api", "dist", "main.js");
const webBuildIdFile = path.join(root, "apps", "web", ".next", "BUILD_ID");

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

function runCommand(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env,
  });
  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
  if (result.error) {
    throw result.error;
  }
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

function shouldSkipTargetedPrebuild() {
  return String(process.env.PLAYWRIGHT_SKIP_TARGETED_PREBUILD || "").trim() === "1";
}

function assertBuildArtifactsExist() {
  const missingArtifacts = [];
  if (!fs.existsSync(apiBuildEntry)) {
    missingArtifacts.push(apiBuildEntry);
  }
  if (!fs.existsSync(webBuildIdFile)) {
    missingArtifacts.push(webBuildIdFile);
  }
  if (missingArtifacts.length > 0) {
    throw new Error(
      `PLAYWRIGHT_SKIP_TARGETED_PREBUILD=1 was set, but required build artifacts are missing: ${missingArtifacts.join(", ")}`,
    );
  }
}

async function main() {
  const fileEnv = loadEnvFile(envFile);
  const apiPort = 4500 + Math.floor(Math.random() * 100);
  const webPort = 3500 + Math.floor(Math.random() * 100);
  const databaseUrl = resolveDatabaseUrl(fileEnv);
  const shopifyHarness = {
    publicationName: "Online Store",
    shopName: "Demo Store",
    shopDomain: "demo-store.myshopify.com",
    shopId: "gid://shopify/Shop/9001",
  };

  const env = {
    ...process.env,
    ...fileEnv,
    PLAYWRIGHT_API_PORT: String(apiPort),
    PLAYWRIGHT_WEB_PORT: String(webPort),
    PLAYWRIGHT_API_URL: `http://127.0.0.1:${apiPort}/api/v1`,
    PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${webPort}`,
    PLAYWRIGHT_DATABASE_URL: databaseUrl,
    DATABASE_URL: databaseUrl,
    DATABASE_URL_POOLED: databaseUrl,
    DATABASE_URL_DIRECT: databaseUrl,
    PLAYWRIGHT_AUTH_MODE: "local",
    PLAYWRIGHT_PASSWORD: "vexa-pim-demo-password",
    PLAYWRIGHT_ENABLE_SHOPIFY_STUB: "1",
    PLAYWRIGHT_SKIP_PRISMA_GENERATE: "1",
    CORS_ORIGIN: `http://127.0.0.1:${webPort}`,
    PIM_SHOPIFY_CLIENT_ID: "shopify-client-id",
    PIM_SHOPIFY_CLIENT_SECRET: "shopify-client-secret",
    PIM_SHOPIFY_ADMIN_API_VERSION: "2026-04",
    PLAYWRIGHT_SHOPIFY_STORE_DOMAIN: shopifyHarness.shopDomain,
    PLAYWRIGHT_SHOPIFY_STORE_NAME: shopifyHarness.shopName,
    PLAYWRIGHT_SHOPIFY_STORE_ID: shopifyHarness.shopId,
    PLAYWRIGHT_SHOPIFY_PUBLICATION_NAME: shopifyHarness.publicationName,
    PLAYWRIGHT_SHOPIFY_PUBLICATION_COUNT_LABEL: "1 publication target",
  };

  runCommand("npm", ["run", "prisma:generate"], env);

  if (shouldSkipTargetedPrebuild()) {
    assertBuildArtifactsExist();
  } else {
    runCommand("npm", ["run", "build", "--workspace", "@pim1/api"], env);
    runCommand("npm", ["run", "build", "--workspace", "@pim1/web"], {
      ...env,
      PIM_API_BASE_URL: env.PLAYWRIGHT_API_URL,
    });
  }

  env.PLAYWRIGHT_SKIP_API_BUILD = "1";
  env.PLAYWRIGHT_SKIP_WEB_BUILD = "1";

  const invocation = playwrightInvocation("apps/web/test/e2e/shopify-connector-managed-install.spec.js");
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env,
  });

  if (typeof result.status === "number") {
    process.exit(result.status);
  }
  if (result.error) {
    throw result.error;
  }
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
