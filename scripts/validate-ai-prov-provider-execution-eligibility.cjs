#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SERVICE = path.join(REPO_ROOT, "apps", "api", "src", "intelligence", "intelligence.service.ts");
const TYPES = path.join(REPO_ROOT, "apps", "api", "src", "intelligence", "intelligence.types.ts");
const SCHEMA = path.join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma");
const MIGRATION = path.join(
  REPO_ROOT,
  "packages",
  "db",
  "prisma",
  "migrations",
  "20261005003000_ai_provider_budget_controls",
  "migration.sql",
);

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function fail(errors, label, message) {
  errors.push(`${label}: ${message}`);
}

function extractMethod(source, methodName) {
  const start = source.indexOf(`async ${methodName}(`);
  if (start < 0) {
    return "";
  }
  const nextMethod = source.slice(start + 1).search(/\n\s+(async\s+|private\s+)/);
  return nextMethod < 0 ? source.slice(start) : source.slice(start, start + 1 + nextMethod);
}

function listSourceFiles(rootDir) {
  const files = [];
  function visit(current) {
    if (!fs.existsSync(current)) {
      return;
    }
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(current)) {
        visit(path.join(current, child));
      }
      return;
    }
    if (/\.(ts|tsx|js|cjs|mjs)$/.test(current)) {
      files.push(current);
    }
  }
  visit(rootDir);
  return files;
}

function validateProviderExecutionEligibility() {
  const errors = [];
  const service = read(SERVICE);
  const types = read(TYPES);
  const schema = read(SCHEMA);
  const migration = read(MIGRATION);
  const eligibilityMethod = extractMethod(service, "evaluateExecutionEligibility");
  const governedSource = listSourceFiles(path.join(REPO_ROOT, "apps", "api", "src", "intelligence"))
    .map(read)
    .join("\n");

  for (const modelName of ["AiProviderBudgetPolicy", "AiProviderBudgetReservation"]) {
    if (!schema.includes(`model ${modelName}`)) {
      fail(errors, "schema", `must define ${modelName}`);
    }
  }
  for (const tableName of ["ai_provider_budget_policies", "ai_provider_budget_reservations"]) {
    if (!migration.includes(`CREATE TABLE "${tableName}"`)) {
      fail(errors, "migration", `must create ${tableName}`);
    }
    if (!migration.includes(`ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY`)) {
      fail(errors, "migration", `${tableName} must enable RLS`);
    }
    if (!migration.includes(`ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY`)) {
      fail(errors, "migration", `${tableName} must force RLS`);
    }
    if (!migration.includes(`tenant_isolation_${tableName}`)) {
      fail(errors, "migration", `${tableName} must have a tenant isolation policy`);
    }
  }
  if (!/"enabled" BOOLEAN NOT NULL DEFAULT false/.test(migration)) {
    fail(errors, "migration", "budget policy must default disabled");
  }
  if (!/"spend_limit_micros" INTEGER NOT NULL DEFAULT 0/.test(migration)) {
    fail(errors, "migration", "spend limit must use integer micros and default to zero");
  }
  if (!/requested_estimated_cost_micros/.test(migration) || !/reserved_cost_micros/.test(migration)) {
    fail(errors, "migration", "reservation must record requested and reserved integer costs");
  }
  if (!/non_negative/.test(migration)) {
    fail(errors, "migration", "budget controls must reject negative counters and costs");
  }
  if (!/tenant_key", "capability", "provider_key", "execution_mode", "period_key"/.test(migration)) {
    fail(errors, "migration", "budget indexes must include tenant/capability/provider/mode/period scope");
  }

  if (!/EvaluateProviderExecutionEligibilityInput/.test(types) || !/ProviderExecutionEligibilityResult/.test(types)) {
    fail(errors, "types", "must declare provider execution eligibility input/result contracts");
  }
  if (!/providerCallAttempted:\s*false/.test(types) || !/canonicalProductMutationEnabled:\s*false/.test(types)) {
    fail(errors, "types", "eligibility result must expose no-call and no-mutation invariants");
  }

  if (!eligibilityMethod) {
    fail(errors, "service", "must implement evaluateExecutionEligibility");
  }
  for (const required of [
    "platformProviderExecutionEnabled",
    "platformKillSwitchEnabled",
    "approvedBy",
    "approvedAt",
    "maxPayloadBytes",
    "allowedCapabilities",
    "allowedProviderKeys",
    "aiProviderBudgetReservation.findUnique",
    "aiProviderBudgetPolicy.findFirst",
    "$transaction",
    "UPDATE \"ai_provider_budget_policies\"",
    "\"tenant_key\" =",
    "\"request_count\" < \"request_limit\"",
    "\"reserved_spend_micros\" + \"spent_spend_micros\"",
    "aiProviderBudgetReservation.update",
  ]) {
    if (!eligibilityMethod.includes(required)) {
      fail(errors, "service.evaluateExecutionEligibility", `must include ${required}`);
    }
  }
  if (!/platformProviderExecutionEnabled\s*!==\s*true/.test(eligibilityMethod)) {
    fail(errors, "service.platformFlag", "platform feature flag must fail closed unless explicitly true");
  }
  if (!/reservedCostMicros:\s*0/.test(service)) {
    fail(errors, "service.deny", "denied execution must reserve zero cost");
  }
  if (!/providerCallAttempted:\s*false\s+as\s+const/.test(service)) {
    fail(errors, "service.invariant", "eligibility base must keep providerCallAttempted false");
  }

  if (/from\s+["'](openai|@openai\/openai|@anthropic-ai\/sdk|@google\/generative-ai|google-genai|langchain|@langchain\/[^"']+|cohere-ai|mistralai|groq-sdk|replicate|ollama|ai)["']/.test(governedSource)) {
    fail(errors, "source.sdk", "004a must not import provider/model SDKs");
  }
  if (/\b(fetch\s*\(|axios\.|new\s+OpenAI|new\s+Anthropic|GoogleGenerativeAI)\b/.test(governedSource)) {
    fail(errors, "source.network", "004a must not add provider/network execution");
  }
  if (/process\.env\.[A-Z0-9_]*(OPENAI|ANTHROPIC|MODEL|PROVIDER|API_KEY|SECRET|TOKEN)/.test(governedSource)) {
    fail(errors, "source.credentials", "004a must not read provider credentials or model config");
  }
  if (/product\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(governedSource)) {
    fail(errors, "source.productMutation", "004a must not mutate Product records");
  }
  if (/auto-suggestions|AutoSuggestions(Module|Service)/.test(governedSource)) {
    fail(errors, "source.autoSuggestions", "004a must not reuse AutoSuggestions");
  }

  return { ok: errors.length === 0, errors };
}

function runCli() {
  const result = validateProviderExecutionEligibility();
  if (!result.ok) {
    console.error("AI-PROV-004a provider execution eligibility validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("AI-PROV-004a provider execution eligibility validation passed: fail-closed controls only.");
}

if (require.main === module) {
  runCli();
}

module.exports = {
  validateProviderExecutionEligibility,
};
