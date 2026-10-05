const assert = require("node:assert/strict");
const { validateAdapterContract } = require("./validate-ai-prov-adapter-contract.cjs");

const result = validateAdapterContract();

assert.equal(result.ok, true, result.errors.join("\n"));

console.log("AI-PROV-003 adapter contract tests passed.");
