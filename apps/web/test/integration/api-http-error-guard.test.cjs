#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_FILE = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(API_FILE, "utf8");

  assert(
    source.includes("static [Symbol.hasInstance](value: unknown): boolean"),
    "ApiHttpError must provide a structural instanceof guard for production server-render catches.",
  );
  assert(
    source.includes('candidate.name === "ApiHttpError"') &&
      source.includes('typeof candidate.status === "number"') &&
      source.includes('"body" in candidate'),
    "ApiHttpError instanceof guard must recognize serialized ApiHttpError shape.",
  );
  assert(
    source.includes("Object.setPrototypeOf(this, new.target.prototype);"),
    "ApiHttpError constructor must repair the prototype chain for instanceof checks.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "api_http_error_has_structural_instanceof_guard",
          "api_http_error_repairs_prototype_chain",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("ApiHttpError guard regression test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
