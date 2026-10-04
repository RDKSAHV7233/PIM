import { ForbiddenException, Injectable } from "@nestjs/common";
import type { IntelligenceActor, IntelligenceBoundaryStatus, IntelligenceCapabilitySummary } from "./intelligence.types";

const PRODUCT_INTELLIGENCE_CAPABILITIES: readonly IntelligenceCapabilitySummary[] = [
  {
    id: "product_attribute_extraction",
    status: "planned",
    canonicalMutation: false,
  },
  {
    id: "product_specification_extraction",
    status: "planned",
    canonicalMutation: false,
  },
  {
    id: "evidence_backed_suggestions",
    status: "planned",
    canonicalMutation: false,
  },
];

@Injectable()
export class IntelligenceService {
  getBoundaryStatus(actor: IntelligenceActor): IntelligenceBoundaryStatus {
    if (!actor.tenantId) {
      throw new ForbiddenException("Tenant context is required.");
    }

    return {
      tenantId: actor.tenantId,
      module: "IntelligenceModule",
      status: "boundary_only",
      providerExecutionEnabled: false,
      canonicalProductMutationEnabled: false,
      capabilities: PRODUCT_INTELLIGENCE_CAPABILITIES.map((capability) => ({ ...capability })),
    };
  }
}
