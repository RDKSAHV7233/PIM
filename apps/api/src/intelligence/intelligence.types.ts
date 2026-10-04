import type { AppRole } from "../common/rbac/roles";

export type IntelligenceCapabilityStatus = "planned" | "disabled";

export interface IntelligenceActor {
  actorId?: string;
  actorRole?: AppRole;
  tenantId?: string;
  effectiveRoles?: string[];
}

export interface IntelligenceCapabilitySummary {
  id: string;
  status: IntelligenceCapabilityStatus;
  canonicalMutation: false;
}

export interface IntelligenceBoundaryStatus {
  tenantId: string;
  module: "IntelligenceModule";
  status: "boundary_only";
  providerExecutionEnabled: false;
  canonicalProductMutationEnabled: false;
  capabilities: IntelligenceCapabilitySummary[];
}
