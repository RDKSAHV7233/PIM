#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { loadWebRuntimeEnv } = require("./load-env.cjs");

const webRoot = path.join(__dirname, "..");
const nextCli = require.resolve("next/dist/bin/next", {
  paths: [webRoot],
});
const env = loadWebRuntimeEnv();

for (const entry of fs.readdirSync(webRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith(".next.__stale__")) {
    continue;
  }
  try {
    fs.rmSync(path.join(webRoot, entry.name), { recursive: true, force: true });
  } catch {
    // Best-effort only; stale cleanup should never block a production build.
  }
}

const build = spawnSync(process.execPath, [nextCli, "build"], {
  cwd: webRoot,
  stdio: "inherit",
  env,
});

process.exit(build.status ?? 1);
