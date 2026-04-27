import { applyDecorators, SetMetadata } from "@nestjs/common";
import { API_CLIENT_ROUTE_POLICY_KEY, type ApiClientRoutePolicy } from "./api-client-policy.decorator";

export const READ_ACCESS_POLICY_KEY = "read_access_policy";
export const AUTHENTICATED_READ_ROUTE_KEY = "authenticated_read_route";

export type AuthenticatedReadClassification =
  | "public_safe"
  | "self_service"
  | "admin_only"
  | "admin_editor"
  | "role_redacted"
  | "scope_filtered"
  | "human_only"
  | "api_client_allowed"
  | "deprecated_or_blocked";

export type ReadResponseHandling = "none" | "redact";
export type AuthenticatedReadRouteConfig = {
  classification: AuthenticatedReadClassification;
  responseHandling: ReadResponseHandling;
  apiClientPolicy?: ApiClientRoutePolicy;
};

export const READ_ACCESS_POLICY_CONFIG = {
  account_privacy_self_service: {
    reasonCode: "READ_POLICY_ACCOUNT_PRIVACY_SELF_SERVICE",
    classification: "self_service",
    responseHandling: "none",
    apiClientPolicy: "denied_human_only",
  },
  account_export_download_self_service: {
    reasonCode: "READ_POLICY_ACCOUNT_EXPORT_DOWNLOAD_SELF_SERVICE",
    classification: "self_service",
    responseHandling: "none",
    apiClientPolicy: "denied_human_only",
  },
  catalog_stats_redacted: {
    reasonCode: "READ_POLICY_CATALOG_STATS_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "allowed_with_api_scope",
  },
  catalog_products_redacted: {
    reasonCode: "READ_POLICY_CATALOG_PRODUCTS_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "allowed_with_api_scope",
  },
  catalog_product_detail_redacted: {
    reasonCode: "READ_POLICY_CATALOG_PRODUCT_DETAIL_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "allowed_with_api_scope",
  },
  catalog_search_redacted: {
    reasonCode: "READ_POLICY_CATALOG_SEARCH_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "allowed_with_api_scope",
  },
  catalog_variants_redacted: {
    reasonCode: "READ_POLICY_CATALOG_VARIANTS_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "allowed_with_api_scope",
  },
  dashboard_health_redacted: {
    reasonCode: "READ_POLICY_DASHBOARD_HEALTH_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  issue_inbox_scoped: {
    reasonCode: "READ_POLICY_ISSUE_INBOX_SCOPED",
    classification: "scope_filtered",
    responseHandling: "none",
    apiClientPolicy: "denied_human_only",
  },
  media_assets_scoped: {
    reasonCode: "READ_POLICY_MEDIA_ASSETS_SCOPED",
    classification: "scope_filtered",
    responseHandling: "none",
    apiClientPolicy: "denied_human_only",
  },
  notification_self_service: {
    reasonCode: "READ_POLICY_NOTIFICATION_SELF_SERVICE",
    classification: "self_service",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  taxonomy_safe_metadata: {
    reasonCode: "READ_POLICY_TAXONOMY_SAFE_METADATA",
    classification: "human_only",
    responseHandling: "none",
    apiClientPolicy: "denied_human_only",
  },
} as const;

export const READ_ACCESS_POLICY_REASON_CODES = Object.fromEntries(
  Object.entries(READ_ACCESS_POLICY_CONFIG).map(([policy, config]) => [policy, config.reasonCode]),
) as Record<keyof typeof READ_ACCESS_POLICY_CONFIG, string>;

export type ReadAccessPolicyId = keyof typeof READ_ACCESS_POLICY_CONFIG;

export function readAccessPolicyReasonCode(policy: ReadAccessPolicyId): string {
  return READ_ACCESS_POLICY_CONFIG[policy].reasonCode;
}

export function resolveReadAccessPolicyConfig(policy: ReadAccessPolicyId) {
  return READ_ACCESS_POLICY_CONFIG[policy];
}

export const ReadAccessPolicy = (policy: ReadAccessPolicyId) =>
  applyDecorators(
    SetMetadata(READ_ACCESS_POLICY_KEY, policy),
    SetMetadata(AUTHENTICATED_READ_ROUTE_KEY, {
      classification: READ_ACCESS_POLICY_CONFIG[policy].classification,
      responseHandling: READ_ACCESS_POLICY_CONFIG[policy].responseHandling,
      apiClientPolicy: READ_ACCESS_POLICY_CONFIG[policy].apiClientPolicy,
    } satisfies AuthenticatedReadRouteConfig),
    SetMetadata(API_CLIENT_ROUTE_POLICY_KEY, READ_ACCESS_POLICY_CONFIG[policy].apiClientPolicy),
  );

export const AuthenticatedReadRoute = (config: AuthenticatedReadRouteConfig) =>
  applyDecorators(
    SetMetadata(AUTHENTICATED_READ_ROUTE_KEY, config),
    ...(config.apiClientPolicy
      ? [SetMetadata(API_CLIENT_ROUTE_POLICY_KEY, config.apiClientPolicy)]
      : []),
  );
