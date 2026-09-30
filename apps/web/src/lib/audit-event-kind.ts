// The API audit interceptor records every non-GET request by HTTP verb, including two POST endpoints that
// only evaluate (they change nothing): publish-readiness and mapping preflight. Every view of the mapping
// review step writes both, so the audit page's "Mutation events" count was inflated. What is recorded stays
// exactly as it is; only how this page counts and labels the rows changes. Import-free so tests can run it.

const EVALUATION_RESOURCE = /^(?:\/api\/v\d+)?\/marketplace\/connectors\/[^/]+\/(?:publish-readiness|mappings\/preflight)\/?$/i;
const MUTATING_ACTIONS = new Set(["POST", "PATCH", "DELETE"]);

export interface AuditEventLike {
  action: string;
  resource: string;
}

export function isEvaluationEvent(event: AuditEventLike): boolean {
  return event.action === "POST" && EVALUATION_RESOURCE.test(String(event.resource ?? "").split("?")[0] ?? "");
}

export function isMutationEvent(event: AuditEventLike): boolean {
  return MUTATING_ACTIONS.has(event.action) && !isEvaluationEvent(event);
}
