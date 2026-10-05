import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IntelligenceCapabilityRegistry } from "../../src/intelligence/intelligence-capability.registry";
import { IntelligenceService } from "../../src/intelligence/intelligence.service";
import type { PrismaService } from "../../src/prisma/prisma.service";
import type { CaseRunResult, GoldenCase, GoldenCatalog, ScorableSuggestion, SideEffectCounters } from "./evaluation.types";
import { ReplayEvaluationAdapter } from "./replay-evaluation.adapter";
import { EVAL_CORRELATION_PREFIX } from "./replay-evaluation.adapter";
import type { CandidateMutation } from "./reference-candidate";

const FIXTURE_ROOT = resolve(__dirname, "..", "..", "..", "..", "test-fixtures");
export const CATALOG_PATH = resolve(FIXTURE_ROOT, "ai-eval", "golden-catalog.v2.json");
export const POLICY_PATH = resolve(FIXTURE_ROOT, "ai-policy", "provider-payload-policy.v1.json");
const TENANT_KEY = "eval-tenant";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export const sha256 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export function loadCatalog(): GoldenCatalog {
  return JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as GoldenCatalog;
}

/** Tenant policy built from the committed AI-POL fixture, so evaluation exercises the real classification rules. */
function buildTenantPolicy() {
  const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8")) as { fields: Array<{ path: string; classification: string }> };
  const fieldClassifications: Record<string, { classification: string; redactionEvidenceRequired: boolean }> = {};
  for (const field of policy.fields) {
    fieldClassifications[field.path] = { classification: field.classification, redactionEvidenceRequired: field.classification === "AI_ALLOWED_WITH_REDACTION" };
  }
  return {
    id: "eval-policy",
    tenantKey: TENANT_KEY,
    providerKey: "default",
    policyVersion: "eval-policy-v1",
    status: "active",
    intelligenceEnabled: true,
    providerExecutionEnabled: true,
    killSwitchEnabled: false,
    tenantOptOut: false,
    maxPayloadBytes: 0,
    allowRawPayloadStorage: false,
    defaultClassification: "AI_BLOCKED",
    allowedCapabilities: ["product_attribute_extraction", "product_specification_extraction", "evidence_backed_suggestions"],
    allowedProviderKeys: ["default"],
    fieldClassifications,
  };
}

/** Faithful extraction payload: only fields that exist in the AI-POL policy, plus any blocked extras. */
export function buildPayload(testCase: GoldenCase): Record<string, unknown> {
  const { title, description, brand, categoryPath, attributes } = testCase.input as Record<string, unknown>;
  return { product: { title, description, brand, categoryPath, attributes }, ...(testCase.payloadExtras ?? {}) };
}

function buildMockPrisma(counters: SideEffectCounters) {
  const policy = buildTenantPolicy();
  const writes = (name: string) => () => {
    if (name.startsWith("aiSuggestion")) {
      counters.suggestionWrites += 1;
    }
    return Promise.resolve({});
  };
  const delegates: Record<string, Record<string, unknown>> = {
    aiTenantPolicy: { findFirst: () => Promise.resolve(policy), upsert: writes("aiTenantPolicy.upsert") },
    aiExecution: { upsert: writes("aiExecution.upsert"), update: writes("aiExecution.update") },
    aiSuggestion: { upsert: writes("aiSuggestion.upsert"), update: writes("aiSuggestion.update"), findUnique: () => Promise.resolve(null) },
  };
  // Any other delegate (product, catalog, ...) is a forbidden side effect: record it and fail loudly.
  const guarded = new Proxy(delegates, {
    get(target, property) {
      if (typeof property === "string" && property in target) {
        return target[property];
      }
      counters.forbiddenDelegateAccesses += 1;
      throw new Error(`Evaluation harness blocked access to ${String(property)}.`);
    },
  });
  return { tenant: () => guarded } as unknown as PrismaService;
}

export interface EvaluationRun {
  catalog: GoldenCatalog;
  catalogHash: string;
  runs: Map<string, CaseRunResult>;
  sideEffects: SideEffectCounters;
}

function toScorable(value: unknown): ScorableSuggestion[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { suggestions?: unknown }).suggestions)) {
    return [];
  }
  return ((value as { suggestions: Array<Record<string, unknown>> }).suggestions).map((entry) => ({
    fieldPath: String(entry.fieldPath ?? ""),
    suggestedValue: entry.suggestedValue,
    evidence: Array.isArray(entry.evidence) ? (entry.evidence as Array<{ sourceField?: unknown; citation?: unknown }>) : [],
  }));
}

export interface RunOptions {
  catalog?: GoldenCatalog;
  caseIds?: string[];
  mutations?: Record<string, CandidateMutation[]>;
}

export async function runEvaluation(options: RunOptions = {}): Promise<EvaluationRun> {
  const catalog = options.catalog ?? loadCatalog();
  const cases = options.caseIds ? catalog.cases.filter((testCase) => options.caseIds?.includes(testCase.caseId)) : catalog.cases;
  const sideEffects: SideEffectCounters = { suggestionWrites: 0, forbiddenDelegateAccesses: 0 };
  const adapter = new ReplayEvaluationAdapter(catalog.cases, options.mutations);
  const service = new IntelligenceService(buildMockPrisma(sideEffects), new IntelligenceCapabilityRegistry(), adapter);
  const runs = new Map<string, CaseRunResult>();

  for (const testCase of cases) {
    const payload = buildPayload(testCase);
    const result = await service.runFixtureAdapterContract({
      tenantKey: TENANT_KEY,
      executionId: `eval-exec-${testCase.caseId}`,
      capability: testCase.capability,
      entityType: "product",
      entityId: `eval-entity-${testCase.caseId}`,
      sourceRecordId: `eval-source-${testCase.caseId}`,
      sourceVersion: 1,
      sourceHash: sha256(stableStringify(testCase.input)),
      promptVersion: "eval-prompt-v1",
      schemaVersion: "eval-schema-v1",
      correlationId: `${EVAL_CORRELATION_PREFIX}${testCase.caseId}`,
      payload: payload as never,
    });

    const blockedReasons: CaseRunResult["blockedReasons"] = [];
    if (result.status === "payload_blocked") {
      const classification = await service.classifyPayloadForIntelligence({ tenantKey: TENANT_KEY, capability: testCase.capability, payload: payload as never });
      const policy = buildTenantPolicy().fieldClassifications;
      if (classification.unknownFields.length > 0) {
        blockedReasons.push("unknown_field_path");
      }
      if (classification.blockedFields.some((path) => policy[path]?.classification === "AI_BLOCKED" || policy[path]?.classification === "AI_ALLOWED_WITH_REDACTION")) {
        blockedReasons.push("blocked_field");
      }
      if (classification.blockedFields.some((path) => policy[path]?.classification === "AI_ALLOWED")) {
        blockedReasons.push("guard_word");
      }
    }

    runs.set(testCase.caseId, {
      caseId: testCase.caseId,
      status: result.status,
      schemaValid: result.outputValidation?.schemaValid === true,
      adapterInvoked: adapter.invocations.includes(testCase.caseId),
      providerCallAttempted: result.providerCallAttempted,
      proposed: toScorable(result.adapterResponse?.structuredOutput),
      accepted: (result.outputValidation?.validatedSuggestions ?? []).map((suggestion) => ({
        fieldPath: suggestion.fieldPath,
        suggestedValue: suggestion.suggestedValue,
        evidence: suggestion.evidence as Array<{ sourceField?: unknown; citation?: unknown }>,
      })),
      blockedReasons,
    });
  }

  return { catalog, catalogHash: sha256(stableStringify(catalog)), runs, sideEffects };
}
