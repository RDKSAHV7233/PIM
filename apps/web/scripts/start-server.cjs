#!/usr/bin/env node

const { spawn } = require("node:child_process");
const path = require("node:path");
const { loadWebRuntimeEnv } = require("./load-env.cjs");

const webRoot = path.join(__dirname, "..");
const env = loadWebRuntimeEnv();

const port = String(process.env.PORT ?? "3000").trim() || "3000";
env.PORT = port;
const nextCli = require.resolve("next/dist/bin/next", {
  paths: [webRoot],
});

const child = spawn(process.execPath, [nextCli, "start", "-p", port], {
  cwd: webRoot,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
