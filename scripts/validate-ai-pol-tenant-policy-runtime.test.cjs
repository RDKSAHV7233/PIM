#!/usr/bin/env node

const assert = require("node:assert/strict");
const { validateTenantPolicyRuntime } = require("./validate-ai-pol-tenant-policy-runtime.cjs");

const valid = {
  schema: `
enum AiDataClassification { AI_ALLOWED AI_ALLOWED_WITH_REDACTION AI_BLOCKED }
enum AiTenantPolicyStatus { draft active disabled }
model AiTenantPolicy {
  tenantKey String @default("default") @map("tenant_key")
  killSwitchEnabled Boolean
  defaultClassification AiDataClassification
  @@unique([tenantKey, capability, providerKey, policyVersion])
  @@index([tenantKey, killSwitchEnabled])
}
`,
  migration: `
CREATE TABLE "ai_tenant_policies" (
"provider_execution_enabled" BOOLEAN NOT NULL DEFAULT false,
"kill_switch_enabled" BOOLEAN NOT NULL DEFAULT true,
"tenant_opt_out" BOOLEAN NOT NULL DEFAULT true,
"allow_model_training" BOOLEAN NOT NULL DEFAULT false,
"allow_raw_payload_storage" BOOLEAN NOT NULL DEFAULT false,
"default_classification" "AiDataClassification" NOT NULL DEFAULT 'AI_BLOCKED'
);
ALTER TABLE "ai_tenant_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_tenant_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_ai_tenant_policies ON "ai_tenant_policies" USING (true);
`,
  tenantScope: `export const TENANT_SCOPED_MODELS = new Set(["AiTenantPolicy"]);`,
  service: `
class IntelligenceService {
  async upsertTenantPolicy() { this.prisma.tenant(tenantKey).aiTenantPolicy.upsert({}); }
  async classifyPayloadForIntelligence() {
    this.prisma.tenant(tenantKey).aiTenantPolicy.findFirst({});
    unknownFields.push("x");
    if (classification === "AI_BLOCKED") {}
    if (classification === "AI_ALLOWED_WITH_REDACTION") {}
  }
  async recordPolicyBlockedExecution() {
    return this.finalizeExecution(id, tenant, { status: "blocked", providerCallAttempted: false, estimatedCostMicros: 0, requestPayloadHash: null });
  }
}
`,
  types: `export interface UpsertAiTenantPolicyInput {} export interface ClassifyIntelligencePayloadInput {} export interface RecordPolicyBlockedExecutionInput {}`,
};

let result = validateTenantPolicyRuntime(valid);
assert.equal(result.ok, true, result.errors.join("\n"));

result = validateTenantPolicyRuntime({
  ...valid,
  migration: valid.migration.replace("DEFAULT 'AI_BLOCKED'", "DEFAULT 'AI_ALLOWED'"),
});
assert.equal(result.ok, false);
assert(result.errors.some((error) => error.includes("unknown fields")));

result = validateTenantPolicyRuntime({
  ...valid,
  service: `${valid.service}\nfetch("https://example.invalid");`,
});
assert.equal(result.ok, false);
assert(result.errors.some((error) => error.includes("forbidden")));

console.log("AI-POL-001 tenant policy runtime validator tests passed.");
