#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_LIB = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(API_LIB, "utf8");
  assert(
    source.includes('const hasBody = init?.body !== undefined && init?.body !== null;'),
    "fetchJson must detect whether a request body is present before setting default content type.",
  );
  assert(
    source.includes('...(hasBody ? { "Content-Type": "application/json" } : {}),'),
    "fetchJson must only set Content-Type for requests that actually send a body.",
  );
  assert(
    source.includes("const rawBody = await response.text();"),
    "fetchJson must read successful responses as text first so empty-body success responses do not crash.",
  );
  assert(
    source.includes("if (!rawBody.trim()) {"),
    "fetchJson must treat empty successful responses as undefined instead of attempting JSON.parse.",
  );
  assert(
    source.includes("export async function deleteJson(path: string, options?: ApiRequestOptions)"),
    "deleteJson helper must remain available for connector permission revoke flows.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "fetchJson_omits_json_content_type_for_empty_body_requests",
          "fetchJson_tolerates_empty_success_bodies",
          "deleteJson_helper_still_available_for_revoke_flows",
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
  console.error("Connector access delete helper regression test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
