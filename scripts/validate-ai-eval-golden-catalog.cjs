#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_FIXTURE = path.resolve(
  __dirname,
  "..",
  "test-fixtures",
  "ai-eval",
  "golden-catalog.v1.json",
);

const RUNTIME_PROVIDER_KEYS = new Set([
  "provider",
  "connectorSlug",
  "model",
  "endpoint",
  "route",
  "tenantKey",
  "installationId",
  "externalRef",
  "prismaModel",
  "database",
]);

function readJson(filePath = DEFAULT_FIXTURE) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(errors, pathLabel, message) {
  errors.push(`${pathLabel}: ${message}`);
}

function walkForForbiddenKeys(value, errors, pathLabel = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkForForbiddenKeys(entry, errors, `${pathLabel}[${index}]`));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${pathLabel}.${key}`;
    if (RUNTIME_PROVIDER_KEYS.has(key)) {
      fail(errors, childPath, "runtime/provider binding key is not allowed in Golden Catalog fixtures");
    }
    walkForForbiddenKeys(child, errors, childPath);
  }
}

function assertNonEmptyArray(errors, value, pathLabel) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(errors, pathLabel, "must be a non-empty array");
  }
}

function validateCatalog(catalog) {
  const errors = [];

  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    return { ok: false, errors: ["$: catalog must be an object"] };
  }

  if (catalog.catalogId !== "AI-EVAL-001-GOLDEN-CATALOG-V1") {
    fail(errors, "$.catalogId", "must be AI-EVAL-001-GOLDEN-CATALOG-V1");
  }

  if (catalog.version !== 1) {
    fail(errors, "$.version", "must be 1");
  }

  if (catalog.nonRuntime !== true) {
    fail(errors, "$.nonRuntime", "must be true");
  }

  if (catalog.owner !== "qa-ai-evaluation") {
    fail(errors, "$.owner", "must be qa-ai-evaluation");
  }

  assertNonEmptyArray(errors, catalog.items, "$.items");
  assertNonEmptyArray(errors, catalog.evaluationAxes, "$.evaluationAxes");
  walkForForbiddenKeys(catalog, errors);

  const itemIds = new Set();
  const skus = new Set();
  if (Array.isArray(catalog.items)) {
    catalog.items.forEach((item, index) => {
      const basePath = `$.items[${index}]`;

      if (!item || typeof item !== "object" || Array.isArray(item)) {
        fail(errors, basePath, "item must be an object");
        return;
      }

      if (!item.id || typeof item.id !== "string") {
        fail(errors, `${basePath}.id`, "must be a non-empty string");
      } else if (itemIds.has(item.id)) {
        fail(errors, `${basePath}.id`, `duplicate item id ${item.id}`);
      } else {
        itemIds.add(item.id);
      }

      if (!item.sku || typeof item.sku !== "string") {
        fail(errors, `${basePath}.sku`, "must be a non-empty string");
      } else if (skus.has(item.sku)) {
        fail(errors, `${basePath}.sku`, `duplicate sku ${item.sku}`);
      } else {
        skus.add(item.sku);
      }

      if (!item.scenario || typeof item.scenario !== "string") {
        fail(errors, `${basePath}.scenario`, "must be a non-empty string");
      }

      if (!item.input || typeof item.input !== "object" || Array.isArray(item.input)) {
        fail(errors, `${basePath}.input`, "must be an object");
      }

      if (!item.expected || typeof item.expected !== "object" || Array.isArray(item.expected)) {
        fail(errors, `${basePath}.expected`, "must be an object");
        return;
      }

      assertNonEmptyArray(errors, item.expected.requiredFacts, `${basePath}.expected.requiredFacts`);
      assertNonEmptyArray(errors, item.expected.allowedInferences, `${basePath}.expected.allowedInferences`);
      assertNonEmptyArray(errors, item.expected.disallowedClaims, `${basePath}.expected.disallowedClaims`);
      assertNonEmptyArray(errors, item.expected.qualitySignals, `${basePath}.expected.qualitySignals`);
    });
  }

  if (Array.isArray(catalog.evaluationAxes)) {
    let weightTotal = 0;
    const axisIds = new Set();
    catalog.evaluationAxes.forEach((axis, index) => {
      const basePath = `$.evaluationAxes[${index}]`;
      if (!axis || typeof axis !== "object" || Array.isArray(axis)) {
        fail(errors, basePath, "axis must be an object");
        return;
      }
      if (!axis.id || typeof axis.id !== "string") {
        fail(errors, `${basePath}.id`, "must be a non-empty string");
      } else if (axisIds.has(axis.id)) {
        fail(errors, `${basePath}.id`, `duplicate axis id ${axis.id}`);
      } else {
        axisIds.add(axis.id);
      }
      if (!Number.isInteger(axis.weight) || axis.weight <= 0) {
        fail(errors, `${basePath}.weight`, "must be a positive integer");
      } else {
        weightTotal += axis.weight;
      }
    });

    if (weightTotal !== 100) {
      fail(errors, "$.evaluationAxes", `weights must sum to 100, got ${weightTotal}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function runCli() {
  const catalog = readJson();
  const result = validateCatalog(catalog);
  if (!result.ok) {
    console.error("AI-EVAL-001 Golden Catalog validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `AI-EVAL-001 Golden Catalog validation passed: ${catalog.items.length} items, ${catalog.evaluationAxes.length} axes.`,
  );
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEFAULT_FIXTURE,
  RUNTIME_PROVIDER_KEYS,
  readJson,
  validateCatalog,
};
