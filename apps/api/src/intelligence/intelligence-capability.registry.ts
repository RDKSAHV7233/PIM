import { Injectable } from "@nestjs/common";
import type { IntelligenceCapabilityId, IntelligenceCapabilitySummary } from "./intelligence.types";

const AI_001_CAPABILITIES: readonly IntelligenceCapabilitySummary[] = [
  {
    id: "product_attribute_extraction",
    status: "planned",
    gateStatus: "blocked_until_gate_b",
    ai001Scope: "in_scope",
    canonicalMutation: false,
    providerExecution: false,
    humanReviewRequired: true,
    evidenceRequired: true,
    allowedEntityTypes: ["product"],
    promptContractVersion: "ai-prompt-product-attribute-v1",
    schemaContractVersion: "ai-schema-product-attribute-v1",
    outputContractVersion: "ai-output-suggestion-v1",
  },
  {
    id: "product_specification_extraction",
    status: "planned",
    gateStatus: "blocked_until_gate_b",
    ai001Scope: "in_scope",
    canonicalMutation: false,
    providerExecution: false,
    humanReviewRequired: true,
    evidenceRequired: true,
    allowedEntityTypes: ["product"],
    promptContractVersion: "ai-prompt-product-specification-v1",
    schemaContractVersion: "ai-schema-product-specification-v1",
    outputContractVersion: "ai-output-suggestion-v1",
  },
  {
    id: "evidence_backed_suggestions",
    status: "planned",
    gateStatus: "blocked_until_gate_b",
    ai001Scope: "in_scope",
    canonicalMutation: false,
    providerExecution: false,
    humanReviewRequired: true,
    evidenceRequired: true,
    allowedEntityTypes: ["product"],
    promptContractVersion: "ai-prompt-evidence-suggestion-v1",
    schemaContractVersion: "ai-schema-evidence-suggestion-v1",
    outputContractVersion: "ai-output-suggestion-v1",
  },
] as const;

const OUT_OF_SCOPE_CAPABILITIES = new Set([
  "supplier_intelligence",
  "semantic_quality_intelligence",
  "channel_intelligence",
  "copilot",
  "agents",
  "vector_search",
  "fine_tuning",
  "multi_provider_routing",
  "standalone_ai_service",
  "autonomous_publishing",
]);

@Injectable()
export class IntelligenceCapabilityRegistry {
  listCapabilities(): IntelligenceCapabilitySummary[] {
    return AI_001_CAPABILITIES.map((capability) => ({ ...capability, allowedEntityTypes: [...capability.allowedEntityTypes] as ["product"] }));
  }

  getCapability(id: IntelligenceCapabilityId): IntelligenceCapabilitySummary {
    const capability = AI_001_CAPABILITIES.find((entry) => entry.id === id);
    if (!capability) {
      throw new Error(`Unknown AI-001 capability: ${id}`);
    }
    return { ...capability, allowedEntityTypes: [...capability.allowedEntityTypes] as ["product"] };
  }

  isInAi001Scope(id: string): id is IntelligenceCapabilityId {
    return AI_001_CAPABILITIES.some((capability) => capability.id === id);
  }

  isExplicitlyOutOfScope(id: string): boolean {
    return OUT_OF_SCOPE_CAPABILITIES.has(id);
  }
}
