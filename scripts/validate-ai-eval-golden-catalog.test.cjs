#!/usr/bin/env node

const assert = require("node:assert/strict");

const { readJson, validateCatalog } = require("./validate-ai-eval-golden-catalog.cjs");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertInvalid(catalog, expectedMessage) {
  const result = validateCatalog(catalog);
  assert.equal(result.ok, false, "catalog should be invalid");
  assert(
    result.errors.some((error) => error.includes(expectedMessage)),
    `expected error including "${expectedMessage}", got:\n${result.errors.join("\n")}`,
  );
}

const validCatalog = readJson();

{
  const result = validateCatalog(validCatalog);
  assert.equal(result.ok, true, result.errors.join("\n"));
}

{
  const catalog = clone(validCatalog);
  catalog.items[1].id = catalog.items[0].id;
  assertInvalid(catalog, "duplicate item id");
}

{
  const catalog = clone(validCatalog);
  catalog.items[1].sku = catalog.items[0].sku;
  assertInvalid(catalog, "duplicate sku");
}

{
  const catalog = clone(validCatalog);
  catalog.items[0].input.provider = "example-provider";
  assertInvalid(catalog, "runtime/provider binding key");
}

{
  const catalog = clone(validCatalog);
  delete catalog.items[0].expected.requiredFacts;
  assertInvalid(catalog, "expected.requiredFacts");
}

{
  const catalog = clone(validCatalog);
  catalog.evaluationAxes[0].weight = 34;
  assertInvalid(catalog, "weights must sum to 100");
}

{
  const catalog = clone(validCatalog);
  catalog.nonRuntime = false;
  assertInvalid(catalog, "nonRuntime");
}

console.log("AI-EVAL-001 Golden Catalog validator tests passed.");
