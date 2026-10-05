#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCHEMA_PATH = path.join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma");
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  "packages",
  "db",
  "prisma",
  "migrations",
  "20261005001000_ai_tenant_policy",
  "migration.sql",
);
const TENANT_SCOPE_PATH = path.join(REPO_ROOT, "apps", "api", "src", "prisma", "extensions", "tenant-scope.ts");
const SERVICE_PATH = path.join(REPO_ROOT, "apps", "api", "src", "intelligence", "intelligence.service.ts");
const TYPES_PATH = path.join(REPO_ROOT, "apps", "api", "src", "intelligence", "intelligence.types.ts");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function fail(errors, pathLabel, message) {
  errors.push(`${pathLabel}: ${message}`);
}

function requireMatch(errors, text, pattern, pathLabel, message) {
  if (!pattern.test(text)) {
    fail(errors, pathLabel, message);
  }
}

function validateTenantPolicyRuntime(files = {}) {
  const schema = files.schema ?? read(SCHEMA_PATH);
  const migration = files.migration ?? read(MIGRATION_PATH);
  const tenantScope = files.tenantScope ?? read(TENANT_SCOPE_PATH);
  const service = files.service ?? read(SERVICE_PATH);
  const types = files.types ?? read(TYPES_PATH);
  const errors = [];

  requireMatch(errors, schema, /enum\s+AiDataClassification\s*{[\s\S]*AI_ALLOWED[\s\S]*AI_ALLOWED_WITH_REDACTION[\s\S]*AI_BLOCKED[\s\S]*}/, "schema.AiDataClassification", "must declare data classifications");
  requireMatch(errors, schema, /enum\s+AiTenantPolicyStatus\s*{[\s\S]*draft[\s\S]*active[\s\S]*disabled[\s\S]*}/, "schema.AiTenantPolicyStatus", "must declare policy statuses");
  requireMatch(errors, schema, /model\s+AiTenantPolicy\s*{[\s\S]*tenantKey\s+String\s+@default\("default"\)\s+@map\("tenant_key"\)[\s\S]*killSwitchEnabled\s+Boolean[\s\S]*defaultClassification\s+AiDataClassification[\s\S]*}/, "schema.AiTenantPolicy", "must be tenant-scoped, fail-closed, and kill-switchable");
  requireMatch(errors, schema, /@@unique\(\[tenantKey,\s*capability,\s*providerKey,\s*policyVersion\]/, "schema.AiTenantPolicy", "must be unique by tenant/capability/provider/version");
  requireMatch(errors, schema, /@@index\(\[tenantKey,\s*killSwitchEnabled\]/, "schema.AiTenantPolicy", "must index tenant kill switch lookups");

  requireMatch(errors, migration, /CREATE TABLE "ai_tenant_policies"/, "migration", "must create ai_tenant_policies table");
  requireMatch(errors, migration, /"provider_execution_enabled" BOOLEAN NOT NULL DEFAULT false/, "migration", "provider execution must default disabled");
  requireMatch(errors, migration, /"kill_switch_enabled" BOOLEAN NOT NULL DEFAULT true/, "migration", "kill switch must default enabled");
  requireMatch(errors, migration, /"tenant_opt_out" BOOLEAN NOT NULL DEFAULT true/, "migration", "tenant opt-out must default true");
  requireMatch(errors, migration, /"allow_model_training" BOOLEAN NOT NULL DEFAULT false/, "migration", "model training must default false");
  requireMatch(errors, migration, /"allow_raw_payload_storage" BOOLEAN NOT NULL DEFAULT false/, "migration", "raw payload storage must default false");
  requireMatch(errors, migration, /"default_classification" "AiDataClassification" NOT NULL DEFAULT 'AI_BLOCKED'/, "migration", "unknown fields must default blocked");
  requireMatch(errors, migration, /ALTER TABLE "ai_tenant_policies" ENABLE ROW LEVEL SECURITY;/, "migration", "must enable RLS");
  requireMatch(errors, migration, /ALTER TABLE "ai_tenant_policies" FORCE ROW LEVEL SECURITY;/, "migration", "must force RLS");
  requireMatch(errors, migration, /CREATE POLICY tenant_isolation_ai_tenant_policies/, "migration", "must create tenant isolation policy");

  requireMatch(errors, tenantScope, /"AiTenantPolicy"/, "tenant-scope", "must include AiTenantPolicy in TENANT_SCOPED_MODELS");
  requireMatch(errors, service, /async\s+upsertTenantPolicy\(/, "service", "must persist tenant policy");
  requireMatch(errors, service, /async\s+classifyPayloadForIntelligence\(/, "service", "must classify payload before external use");
  requireMatch(errors, service, /async\s+recordPolicyBlockedExecution\(/, "service", "must record blocked executions");
  requireMatch(errors, service, /this\.prisma\.tenant\(tenantKey\)\.aiTenantPolicy\.upsert/, "service", "must use tenant-scoped policy upsert");
  requireMatch(errors, service, /this\.prisma\.tenant\(tenantKey\)\.aiTenantPolicy\.findFirst/, "service", "must use tenant-scoped policy lookup");
  requireMatch(errors, service, /status:\s*"blocked"[\s\S]*providerCallAttempted:\s*false[\s\S]*estimatedCostMicros:\s*0/, "service", "blocked execution must be zero-cost/no-call");
  requireMatch(errors, service, /requestPayloadHash:\s*null/, "service", "blocked payloads must not persist raw request payload hash");
  requireMatch(errors, service, /unknownFields\.push/, "service", "unknown fields must be tracked");
  requireMatch(errors, service, /classification === "AI_BLOCKED"/, "service", "AI_BLOCKED fields must block");
  requireMatch(errors, service, /classification === "AI_ALLOWED_WITH_REDACTION"/, "service", "redactable fields must require evidence");

  if (/fetch\s*\(|axios\.|OpenAI|(?<!Intelligence)ProviderAdapter|CatalogService|AutoSuggestionsService/.test(service)) {
    fail(errors, "service.forbidden", "must not introduce provider, Product, Catalog, or AutoSuggestions runtime paths");
  }
  requireMatch(errors, types, /UpsertAiTenantPolicyInput/, "types", "must declare tenant policy input");
  requireMatch(errors, types, /ClassifyIntelligencePayloadInput/, "types", "must declare classification input");
  requireMatch(errors, types, /RecordPolicyBlockedExecutionInput/, "types", "must declare blocked execution input");

  return { ok: errors.length === 0, errors };
}

function runCli() {
  const result = validateTenantPolicyRuntime();
  if (!result.ok) {
    console.error("AI-POL-001 tenant policy runtime validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log("AI-POL-001 tenant policy runtime validation passed.");
}

if (require.main === module) {
  runCli();
}

module.exports = {
  validateTenantPolicyRuntime,
};
