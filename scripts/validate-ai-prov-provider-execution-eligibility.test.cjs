#!/usr/bin/env node

const assert = require("node:assert/strict");
const { validateProviderExecutionEligibility } = require("./validate-ai-prov-provider-execution-eligibility.cjs");

const result = validateProviderExecutionEligibility();
assert.equal(result.ok, true, result.errors.join("\n"));
assert.deepEqual(result.errors, []);

// Every rule must actually fire: each mutation below breaks exactly one property and must be reported.
const replace = (from, to) => (text) => {
  assert.ok(text.includes(from) || from instanceof RegExp, `mutation target missing: ${String(from)}`);
  return typeof from === "string" ? text.split(from).join(to) : text.replace(from, to);
};
const append = (extra) => (text) => `${text}\n${extra}\n`;

const mutations = [
  ["flag parsed loosely", { gates: replace('raw.trim().toLowerCase() === "true"', 'raw.trim().toLowerCase() !== "false"') }, "gates.flag"],
  ["deploy flag renamed", { gates: replace('"FEATURE_INTELLIGENCE_PROVIDER_ENABLED"', '"FEATURE_SOMETHING_ELSE"') }, "gates"],
  ["settlement stops sorting by the lock order", { control: replace("CHARGE_ORDER.indexOf(", "[].indexOf(") }, "control.lockOrder"],
  ["lock order changed", { gates: replace('["platform_month", "platform_day", "tenant_month", "tenant_day"]', '["tenant_day", "platform_day", "tenant_month", "platform_month"]') }, "gates.order"],
  ["claim loses its compare-and-set", { control: replace('status: "reserved", expiresAt: { gt: now }', "expiresAt: { gt: now }") }, "control.claim"],
  ["settle loses its compare-and-set", { control: replace("status: { in: fromStatuses },", "") }, "control.settle"],
  ["settle stops requiring the claim token", { control: replace('{ claimToken: ref.claimToken ?? "" }', "{ claimToken: undefined }") }, "control.token"],
  ["budget predicate removed", { control: replace('AND ("reserved_spend_micros" + "spent_spend_micros" + ${estimate}) <= "spend_limit_micros"', "AND true") }, "control.reserve"],
  ["money converted to a number", { control: append("const bad = Number(estimate);") }, "control.money"],
  ["a route is exposed", { control: append('@Post("x") class Leak {}') }, "source.routes"],
  ["a credential is handled", { gates: append("const apiKey = 1;") }, "source.credentials"],
  ["money column becomes Int", { schema: replace("spendLimitMicros     BigInt  ", "spendLimitMicros     Int     ") }, "schema.money"],
  ["a non-zero default budget is seeded", { migration004b: append('INSERT INTO "ai_platform_budget_periods" ("id") VALUES (\'x\');') }, "migration004b"],
  ["platform control seeded enabled", { migration004b: replace('"kill_switch" BOOLEAN NOT NULL DEFAULT true', '"kill_switch" BOOLEAN NOT NULL DEFAULT false') }, "migration004b"],
  ["charges lose tenant scope", { tenantScope: replace('"AiProviderBudgetCharge",', "") }, "tenantScope"],
  ["result carries a number", { types: append("export interface X { requestedEstimatedCostMicros: number; }") }, "types.money"],
  ["maintenance writes directly", { maintenance: append('const q = "UPDATE ai_provider_budget_policies";') }, "maintenance.audit"],
  ["maintenance policy can write", { migration004b: replace("FOR SELECT USING (current_setting(''app.ai_maintenance''", "FOR ALL USING (current_setting(''app.ai_maintenance''") }, "migration004b.maintenance"],
  ["maintenance marker becomes session scoped", { maintenance: replace("'on', true)", "'on', false)") }, "maintenance.marker"],
  ["integration test stops using a restricted role", { integration: replace("NOSUPERUSER NOBYPASSRLS", "SUPERUSER") }, "integration.role"],
  ["CI stops running the real-PostgreSQL test", { ci: replace("npm run test:integration:ai-provider-budget-lifecycle", "echo skipped") }, "ci"],
];

for (const [name, transforms, expectedLabel] of mutations) {
  const mutated = validateProviderExecutionEligibility(transforms);
  assert.equal(mutated.ok, false, `mutation not detected: ${name}`);
  assert.ok(
    mutated.errors.some((error) => error.startsWith(expectedLabel) || error.includes(expectedLabel)),
    `mutation "${name}" was reported, but not under ${expectedLabel}:\n${mutated.errors.join("\n")}`,
  );
}

// Governed-source rules, proved with an extra synthetic source file.
const extras = [
  ["provider SDK import", 'import Anthropic from "@anthropic-ai/sdk";', "source.sdk"],
  ["network call", 'await fetch("https://example.invalid");', "source.network"],
  ["unlisted environment read", "const key = process.env.ANTHROPIC_KEY;", "source.env"],
  ["Product mutation", "await tx.product.update({});", "source.productMutation"],
  ["AutoSuggestions reuse", "import { AutoSuggestionsService } from '../auto-suggestions/x';", "source.autoSuggestions"],
  ["maintenance marker touched elsewhere", "await tx.$queryRaw`SELECT set_config('app.ai_maintenance', 'on', true)`;", "maintenance.marker"],
  ["BigInt serialisation patch", "BigInt.prototype.toJSON = function () { return this.toString(); };", "money.toJSON"],
];
for (const [name, extra, expectedLabel] of extras) {
  const mutated = validateProviderExecutionEligibility({}, extra);
  assert.equal(mutated.ok, false, `extra source not detected: ${name}`);
  assert.ok(mutated.errors.some((error) => error.includes(expectedLabel)), `"${name}" not reported under ${expectedLabel}:\n${mutated.errors.join("\n")}`);
}

console.log("validate-ai-prov-provider-execution-eligibility tests passed.");
