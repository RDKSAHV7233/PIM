const assert = require("node:assert/strict");
const { validateDryRun } = require("./validate-ai-core-provider-payload-dry-run.cjs");

const result = validateDryRun();

assert.equal(result.ok, true, result.errors.join("\n"));

console.log("AI-PROV-001 payload dry-run validator tests passed.");
