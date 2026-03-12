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

const env = {
  ...fileEnv,
  ...process.env,
  PORT: process.env.PLAYWRIGHT_WEB_PORT || "3001",
  PIM_API_BASE_URL: process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1",
};

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
