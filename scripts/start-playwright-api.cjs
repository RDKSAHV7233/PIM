/* eslint-disable no-console */
const { spawn, spawnSync } = require("node:child_process");
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

const fileEnv = loadEnvFile(envFile);

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

const env = {
  ...fileEnv,
  ...process.env,
  PORT: process.env.PLAYWRIGHT_API_PORT || "4001",
  APP_ENV: "development",
  AUTH_MODE: "local",
  PIM_AUTH_PASSWORD: process.env.PLAYWRIGHT_PASSWORD || "pim1-demo-password",
  PIM_DEFAULT_TENANT_KEY: process.env.PLAYWRIGHT_TENANT_KEY || "default",
  PIM_DEFAULT_WORKSPACE_SLUG: process.env.PLAYWRIGHT_WORKSPACE || "default",
  PIM_AUTH_IP_ATTEMPT_LIMIT: process.env.PLAYWRIGHT_AUTH_IP_ATTEMPT_LIMIT || "100",
  PIM_AUTH_REDIS_DISABLED: "true",
  JWT_BLOCKLIST_REDIS_DISABLED: "true",
  DASHBOARD_CACHE_REDIS_DISABLED: "true",
  PIM_AUTH_IDENTITIES_JSON:
    process.env.PLAYWRIGHT_AUTH_IDENTITIES_JSON ||
    JSON.stringify({
      "admin@pim1.local": { tenantId: "default", role: "admin" },
      "editor@pim1.local": { tenantId: "default", role: "editor" },
      "reviewer@pim1.local": { tenantId: "default", role: "reviewer" },
      "viewer@pim1.local": { tenantId: "default", role: "viewer" },
    }),
};

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
