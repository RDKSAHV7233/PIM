#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

function applyEnvFile(targetEnv, filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  dotenv.config({
    path: filePath,
    processEnv: targetEnv,
    override: true,
    quiet: true,
  });
}

function loadWebRuntimeEnv() {
  const webRoot = path.join(__dirname, "..");
  const repoRoot = path.join(webRoot, "..", "..");
  const env = {};

  applyEnvFile(env, path.join(repoRoot, ".env"));
  applyEnvFile(env, path.join(webRoot, ".env.local"));

  return {
    ...env,
    ...process.env,
  };
}

module.exports = {
  applyEnvFile,
  loadWebRuntimeEnv,
};
