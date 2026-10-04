#!/usr/bin/env node

const assert = require("node:assert/strict");
const { validateSuggestionPersistence } = require("./validate-ai-core-suggestion-persistence.cjs");

const valid = {
  schema: `
enum AiSuggestionStatus { generated pending_review accepted edited rejected blocked_stale blocked_tampered blocked_unauthorized applied }
enum AiSuggestionReviewDecision { accept edit reject }
model AiSuggestion {
  tenantKey String @default("default") @map("tenant_key")
  execution AiExecution @relation(fields: [executionId], references: [id])
  @@unique([tenantKey, idempotencyFingerprint])
  @@index([tenantKey, executionId])
  @@index([tenantKey, entityType, entityId, fieldPath])
}
`,
  migration: `
CREATE TABLE "ai_suggestions" ();
CREATE TRIGGER ai_suggestions_generated_fields_immutable BEFORE UPDATE ON "ai_suggestions" FOR EACH ROW EXECUTE FUNCTION ai_suggestions_reject_generated_field_update();
ALTER TABLE "ai_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_suggestions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_ai_suggestions ON "ai_suggestions" USING (true);
${[
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
].map((column) => `OLD.${column} IS DISTINCT FROM NEW.${column}`).join("\n")}
`,
  tenantScope: `export const TENANT_SCOPED_MODELS = new Set(["AiSuggestion"]);`,
  service: `
class IntelligenceService {
  async createSuggestion() {
    this.prisma.tenant(tenantKey).aiSuggestion.upsert({});
    this.hashJson({});
    this.assertEvidenceMatches({});
  }
  async reviewSuggestion() {
    this.prisma.tenant(tenantKey).aiSuggestion.findUnique({});
    this.prisma.tenant(tenantKey).aiSuggestion.update({ data: { status: "blocked_stale" } });
    this.prisma.tenant(tenantKey).aiSuggestion.update({ data: { status: "blocked_tampered" } });
  }
}
`,
  types: `export interface CreateAiSuggestionInput {} export interface ReviewAiSuggestionInput {}`,
};

let result = validateSuggestionPersistence(valid);
assert.equal(result.ok, true, result.errors.join("\n"));

result = validateSuggestionPersistence({
  ...valid,
  tenantScope: `export const TENANT_SCOPED_MODELS = new Set([]);`,
});
assert.equal(result.ok, false);
assert(result.errors.some((error) => error.includes("AiSuggestion")));

result = validateSuggestionPersistence({
  ...valid,
  service: `${valid.service}\nimport { CatalogService } from "../catalog/catalog.service";`,
});
assert.equal(result.ok, false);
assert(result.errors.some((error) => error.includes("forbidden import")));

console.log("AI-CORE-003 suggestion persistence validator tests passed.");
