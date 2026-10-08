#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { scanForSecrets, validateEvidence } = require("./rehearse-v2.cjs");

const index = process.argv.indexOf("--artifact");
const artifact = index >= 0 ? process.argv[index + 1] : "";
if (!artifact) {
  console.error("--artifact <path> is required.");
  process.exit(2);
}

try {
  const evidence = JSON.parse(fs.readFileSync(path.resolve(artifact), "utf8"));
  const validation = validateEvidence(evidence);
  if (!validation.ok || !scanForSecrets(evidence)) {
    console.error("redaction validation failed");
    process.exit(1);
  }
  console.log("rehearsal v2 evidence validated");
} catch {
  console.error("evidence validation failed");
  process.exit(1);
}
