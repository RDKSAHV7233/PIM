#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const SERVICE = path.resolve(__dirname, "..", "apps", "api", "src", "intelligence", "intelligence.service.ts");
const TYPES = path.resolve(__dirname, "..", "apps", "api", "src", "intelligence", "intelligence.types.ts");
const CONTROLLER = path.resolve(__dirname, "..", "apps", "api", "src", "intelligence", "intelligence.controller.ts");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function fail(errors, pathLabel, message) {
  errors.push(`${pathLabel}: ${message}`);
}

function validateProviderOutputValidation() {
  const errors = [];
  const service = read(SERVICE);
  const types = read(TYPES);
  const controller = read(CONTROLLER);

  if (!/async\s+validateStructuredOutputForSuggestions\(/.test(service)) {
    fail(errors, "service.validateStructuredOutputForSuggestions", "must expose an internal output validation method");
  }
  if (!/providerOutput\.suggestions/.test(service)) {
    fail(errors, "service.providerOutput", "must validate providerOutput.suggestions");
  }
  if (!/this\.assertEvidenceMatches\(/.test(service)) {
    fail(errors, "service.evidence", "must require suggestion evidence to match the source");
  }
  if (!/isInAi001Scope\(capability\)/.test(service) || !/isExplicitlyOutOfScope\(capability\)/.test(service)) {
    fail(errors, "service.scope", "must validate AI-001 capability scope");
  }
  if (!/entityType\s*!==\s*"product"/.test(service)) {
    fail(errors, "service.entityType", "must reject non-product provider output");
  }
  if (!/providerOutput\.suggestions must not be empty/.test(service)) {
    fail(errors, "service.emptySuggestions", "must reject empty suggestion arrays");
  }
  if (!/PROVIDER_OUTPUT_AUTHORITY_FIELDS/.test(service)) {
    fail(errors, "service.authority", "must reject provider-supplied server authority fields");
  }
  if (!/duplicate fieldPath is not allowed/.test(service)) {
    fail(errors, "service.idempotency", "must reject duplicate suggestion field paths");
  }
  if (!/providerCallAttempted:\s*false[\s\S]*canonicalProductMutationEnabled:\s*false/.test(service)) {
    fail(errors, "service.noRuntimeEffect", "must prove no provider call and no canonical mutation");
  }
  for (const contract of [
    "ValidateIntelligenceProviderOutputInput",
    "IntelligenceProviderOutputValidationResult",
    "IntelligenceProviderValidatedSuggestion",
  ]) {
    if (!types.includes(contract)) {
      fail(errors, "types", `must declare ${contract}`);
    }
  }
  if (/@(Post|Patch|Put|Delete)\s*\(/.test(controller)) {
    fail(errors, "controller", "provider output validation must not add public write routes");
  }
  if (/fetch\s*\(|axios\.|OpenAI|Anthropic|GoogleGenerativeAI|product\.(create|update|upsert|delete)/.test(service)) {
    fail(errors, "service.forbidden", "must not add provider execution or Product mutation");
  }

  return { ok: errors.length === 0, errors };
}

function runCli() {
  const result = validateProviderOutputValidation();
  if (!result.ok) {
    console.error("AI-PROV-002 provider output validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("AI-PROV-002 provider output validation passed: structured output only, no provider call, no mutation.");
}

if (require.main === module) {
  runCli();
}

module.exports = {
  validateProviderOutputValidation,
};
