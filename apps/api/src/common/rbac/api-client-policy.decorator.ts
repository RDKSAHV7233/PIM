import { applyDecorators, SetMetadata } from "@nestjs/common";

export type ApiClientRoutePolicy =
  | "denied_human_only"
  | "allowed_with_api_scope"
  | "allowed_service_internal"
  | "not_applicable";

export const API_CLIENT_SCOPE_VALUES = [
  "catalog.read",
  "catalog.write",
  "bulk_import.read",
  "media.read",
  "compliance.read",
  "issues.read",
  "rejection_intelligence.read",
  "auto_suggestions.read",
  "taxonomy.read",
] as const;
export type ApiClientScope = (typeof API_CLIENT_SCOPE_VALUES)[number];

export const API_CLIENT_ROUTE_POLICY_KEY = "api_client_route_policy";
export const DISALLOW_API_CLIENT_KEY = "disallow_api_client";
export const API_CLIENT_REQUIRED_SCOPES_KEY = "api_client_required_scopes";

export const ApiClientPolicy = (policy: ApiClientRoutePolicy) =>
  SetMetadata(API_CLIENT_ROUTE_POLICY_KEY, policy);

export const ApiClientScopes = (...scopes: ApiClientScope[]) =>
  SetMetadata(API_CLIENT_REQUIRED_SCOPES_KEY, scopes);

export function normalizeApiClientScope(value: string | null | undefined): ApiClientScope | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (API_CLIENT_SCOPE_VALUES as readonly string[]).includes(normalized)
    ? (normalized as ApiClientScope)
    : null;
}

export function normalizeApiClientScopes(values: readonly string[] | null | undefined): ApiClientScope[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set<ApiClientScope>();
  for (const value of values) {
    const normalized = normalizeApiClientScope(value);
    if (normalized) {
      seen.add(normalized);
    }
  }
  return [...seen];
}

export const DisallowApiClient = () =>
  applyDecorators(
    SetMetadata(DISALLOW_API_CLIENT_KEY, true),
    SetMetadata(API_CLIENT_ROUTE_POLICY_KEY, "denied_human_only" satisfies ApiClientRoutePolicy),
  );
