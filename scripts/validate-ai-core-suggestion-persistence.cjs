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
  "20261004182000_ai_suggestion_provenance",
  "migration.sql",
);
const TENANT_SCOPE_PATH = path.join(REPO_ROOT, "apps", "api", "src", "prisma", "extensions", "tenant-scope.ts");
const SERVICE_PATH = path.join(REPO_ROOT, "apps", "api", "src", "intelligence", "intelligence.service.ts");
const TYPES_PATH = path.join(REPO_ROOT, "apps", "api", "src", "intelligence", "intelligence.types.ts");

const IMMUTABLE_COLUMNS = [
  "tenant_key",
  "execution_id",
  "capability",
  "entity_type",
  "entity_id",
  "field_path",
  "source_record_id",
  "source_version",
  "source_hash",
  "prompt_version",
  "schema_version",
  "generation_fingerprint",
  "idempotency_fingerprint",
  "generated_payload",
  "generated_payload_hash",
  "suggested_value",
  "suggested_value_hash",
  "confidence",
  "evidence",
  "requires_evidence",
  "evidence_hash",
];

const FORBIDDEN_SERVICE_IMPORTS = [
  /from\s+["'][^"']*auto-suggestions[^"']*["']/,
  /from\s+["'][^"']*catalog[^"']*["']/,
  /from\s+["'][^"']*products?[^"']*["']/,
  /from\s+["'][^"']*provider[^"']*["']/,
];

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

function validateSuggestionPersistence(files = {}) {
  const schema = files.schema ?? read(SCHEMA_PATH);
  const migration = files.migration ?? read(MIGRATION_PATH);
  const tenantScope = files.tenantScope ?? read(TENANT_SCOPE_PATH);
  const service = files.service ?? read(SERVICE_PATH);
  const types = files.types ?? read(TYPES_PATH);
  const errors = [];

  requireMatch(errors, schema, /enum\s+AiSuggestionStatus\s*{[\s\S]*pending_review[\s\S]*blocked_stale[\s\S]*blocked_tampered[\s\S]*blocked_unauthorized[\s\S]*}/, "schema.AiSuggestionStatus", "must declare governed lifecycle states");
  requireMatch(errors, schema, /enum\s+AiSuggestionReviewDecision\s*{[\s\S]*accept[\s\S]*edit[\s\S]*reject[\s\S]*}/, "schema.AiSuggestionReviewDecision", "must declare review decisions");
  requireMatch(errors, schema, /model\s+AiSuggestion\s*{[\s\S]*tenantKey\s+String\s+@default\("default"\)\s+@map\("tenant_key"\)[\s\S]*execution\s+AiExecution[\s\S]*}/, "schema.AiSuggestion", "must be tenant-scoped and related to AiExecution");
  requireMatch(errors, schema, /@@unique\(\[tenantKey,\s*idempotencyFingerprint\]/, "schema.AiSuggestion", "must be idempotent per tenant");
  requireMatch(errors, schema, /@@index\(\[tenantKey,\s*executionId\]/, "schema.AiSuggestion", "must index execution lookups per tenant");
  requireMatch(errors, schema, /@@index\(\[tenantKey,\s*entityType,\s*entityId,\s*fieldPath\]/, "schema.AiSuggestion", "must index entity field lookups per tenant");

  requireMatch(errors, migration, /CREATE TABLE "ai_suggestions"/, "migration", "must create ai_suggestions table");
  requireMatch(errors, migration, /ALTER TABLE "ai_suggestions" ENABLE ROW LEVEL SECURITY;/, "migration", "must enable RLS");
  requireMatch(errors, migration, /ALTER TABLE "ai_suggestions" FORCE ROW LEVEL SECURITY;/, "migration", "must force RLS");
  requireMatch(errors, migration, /CREATE POLICY tenant_isolation_ai_suggestions/, "migration", "must create tenant isolation policy");
  requireMatch(errors, migration, /CREATE TRIGGER ai_suggestions_generated_fields_immutable/, "migration", "must create generated-field immutability trigger");

  for (const column of IMMUTABLE_COLUMNS) {
    const pattern = new RegExp(`OLD\\.${column}\\s+IS DISTINCT FROM NEW\\.${column}`);
    requireMatch(errors, migration, pattern, `migration.immutable.${column}`, "must be protected by immutability trigger");
  }

  requireMatch(errors, tenantScope, /"AiSuggestion"/, "tenant-scope", "must include AiSuggestion in TENANT_SCOPED_MODELS");
  requireMatch(errors, service, /async\s+createSuggestion\(/, "service", "must expose createSuggestion");
  requireMatch(errors, service, /async\s+reviewSuggestion\(/, "service", "must expose reviewSuggestion");
  requireMatch(errors, service, /this\.prisma\.tenant\(tenantKey\)\.aiSuggestion\.upsert/, "service", "must use tenant-scoped aiSuggestion upsert");
  requireMatch(errors, service, /this\.prisma\.tenant\(tenantKey\)\.aiSuggestion\.findUnique/, "service", "must use tenant-scoped aiSuggestion lookup");
  requireMatch(errors, service, /this\.prisma\.tenant\(tenantKey\)\.aiSuggestion\.update/, "service", "must use tenant-scoped aiSuggestion updates");
  requireMatch(errors, service, /hashJson\(/, "service", "must compute server-side hashes");
  requireMatch(errors, service, /assertEvidenceMatches\(/, "service", "must validate factual evidence");
  requireMatch(errors, service, /blocked_stale/, "service", "must block stale suggestions");
  requireMatch(errors, service, /blocked_tampered/, "service", "must block tampered suggestions");

  for (const pattern of FORBIDDEN_SERVICE_IMPORTS) {
    if (pattern.test(service)) {
      fail(errors, "service.imports", `forbidden import matched ${pattern}`);
    }
  }
  if (/productServiceApplyTransactionId\s*:\s*this\./.test(service)) {
    fail(errors, "service.apply", "must not set Product Service apply transactions in AI-CORE-003 persistence slice");
  }
  requireMatch(errors, types, /CreateAiSuggestionInput/, "types", "must declare create input");
  requireMatch(errors, types, /ReviewAiSuggestionInput/, "types", "must declare review input");

  return { ok: errors.length === 0, errors };
}

function runCli() {
  const result = validateSuggestionPersistence();
  if (!result.ok) {
    console.error("AI-CORE-003 suggestion persistence validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log("AI-CORE-003 suggestion persistence validation passed.");
}

if (require.main === module) {
  runCli();
}

module.exports = {
  validateSuggestionPersistence,
};
