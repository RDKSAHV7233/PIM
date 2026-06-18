#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "mapping-editor.tsx");

const PROP_LIMIT = 12;
const REQUIRED_GROUP_TYPES = [
  "MappingEditorConnector",
  "MappingEditorTaxonomy",
  "MappingEditorFieldMapping",
  "MappingEditorSampleProduct",
  "MappingEditorLabels",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractMappingEditorCardPropBlock(source) {
  // Find the MappingEditorCard function and extract the destructured param block
  const fnStart = source.indexOf("export function MappingEditorCard({");
  assert(fnStart !== -1, "Could not find export function MappingEditorCard");

  // Find the opening { and its matching }
  const openBrace = source.indexOf("{", fnStart);
  let depth = 0;
  let i = openBrace;
  while (i < source.length) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  return source.slice(openBrace + 1, i);
}

function countTopLevelProps(destructureBlock) {
  // Each top-level prop appears as a bare identifier (possibly followed by , or \n) at the start of a line
  // or after the opening brace. We count lines that have a leading identifier without nesting.
  const lines = destructureBlock.split("\n").map((l) => l.trim()).filter(Boolean);
  let props = 0;
  for (const line of lines) {
    // A top-level prop line starts with an identifier optionally followed by , or :
    if (/^[a-zA-Z_][a-zA-Z0-9_]*[\s,:]/.test(line) || /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(line)) {
      props++;
    }
  }
  return props;
}

function run() {
  const source = fs.readFileSync(FILE, "utf8");

  // Verify all required group types are exported
  for (const typeName of REQUIRED_GROUP_TYPES) {
    assert(
      source.includes(`export type ${typeName}`),
      `mapping-editor.tsx must export grouped prop type "${typeName}" — this type guards prop grouping from regression.`,
    );
  }

  // Count top-level props on MappingEditorCard
  const propBlock = extractMappingEditorCardPropBlock(source);
  const propCount = countTopLevelProps(propBlock);

  assert(
    propCount <= PROP_LIMIT,
    `MappingEditorCard has ${propCount} top-level props, exceeding the regression limit of ${PROP_LIMIT}. ` +
      `Group related props into typed objects (see MappingEditorConnector, MappingEditorTaxonomy, etc.) before adding new ones.`,
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          `mapping_editor_card_prop_count_within_limit (${propCount} <= ${PROP_LIMIT})`,
          ...REQUIRED_GROUP_TYPES.map((t) => `group_type_exported_${t}`),
        ],
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Mapping editor prop contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
