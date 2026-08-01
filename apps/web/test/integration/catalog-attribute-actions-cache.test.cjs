#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractFunction(source, name) {
  const start = source.indexOf(`export async function ${name}`);
  assert(start >= 0, `${name} must exist.`);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next >= 0 ? next : undefined);
}

function run() {
  const source = fs.readFileSync(ACTIONS_FILE, "utf8");
  const actionSource = extractFunction(source, "createAttributeDefinitionAction");

  assert(
    actionSource.includes('revalidatePath("/catalog/attributes");') &&
      actionSource.includes('revalidatePath("/channels/mappings");'),
    "Creating attribute definitions must revalidate both catalog attributes and channel mappings so the mapping editor sees new source fields.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: ["attribute_definition_creation_revalidates_mapping_source_fields"],
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
  console.error("Catalog attribute actions cache test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
