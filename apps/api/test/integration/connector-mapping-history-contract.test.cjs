#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const FILE = path.join(REPO_ROOT, "apps", "api", "src", "marketplace", "connector-mapping.service.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(FILE, "utf8");
  assert(
    source.includes("connectorMappingEvent.findMany") &&
      source.includes("historyByVersion") &&
      source.includes("history.validated = entry") &&
      source.includes("history.published = entry") &&
      source.includes("history.archived = entry") &&
      source.includes("history.rollback = entry"),
    "Connector mapping service must hydrate version history from lifecycle events for validation, publish, archive, and rollback metadata.",
  );
  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: ["connector_mapping_service_hydrates_lifecycle_history_from_events"],
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Connector mapping history contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
