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
  workspace_users_governance_redacted: {
    reasonCode: "READ_POLICY_WORKSPACE_USERS_GOVERNANCE_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  workspace_access_scopes_governance_redacted: {
    reasonCode: "READ_POLICY_WORKSPACE_ACCESS_SCOPES_GOVERNANCE_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  api_keys_governance_redacted: {
    reasonCode: "READ_POLICY_API_KEYS_GOVERNANCE_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  connector_permissions_governance_redacted: {
    reasonCode: "READ_POLICY_CONNECTOR_PERMISSIONS_GOVERNANCE_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  billing_plan_profile_governance_redacted: {
    reasonCode: "READ_POLICY_BILLING_PLAN_PROFILE_GOVERNANCE_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  billing_plan_tier_self_service: {
    reasonCode: "READ_POLICY_BILLING_PLAN_TIER_SELF_SERVICE",
    classification: "self_service",
    responseHandling: "none",
    apiClientPolicy: "denied_human_only",
  },
  billing_upgrade_request_governance_redacted: {
    reasonCode: "READ_POLICY_BILLING_UPGRADE_REQUEST_GOVERNANCE_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  audit_events_governance_redacted: {
    reasonCode: "READ_POLICY_AUDIT_EVENTS_GOVERNANCE_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  audit_logs_governance_redacted: {
    reasonCode: "READ_POLICY_AUDIT_LOGS_GOVERNANCE_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  outbound_webhooks_governance_redacted: {
    reasonCode: "READ_POLICY_OUTBOUND_WEBHOOKS_GOVERNANCE_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  outbound_webhook_deliveries_governance_redacted: {
    reasonCode: "READ_POLICY_OUTBOUND_WEBHOOK_DELIVERIES_GOVERNANCE_REDACTED",
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  oidc_config_governance_redacted: {
    reasonCode: "READ_POLICY_OIDC_CONFIG_GOVERNANCE_REDACTED",
    classification: "admin_only",
    responseHandling: "none",
    apiClientPolicy: "denied_human_only",
  },
  issue_inbox_scoped: {
    reasonCode: "READ_POLICY_ISSUE_INBOX_SCOPED",
    classification: "scope_filtered",
    responseHandling: "none",
    apiClientPolicy: "allowed_with_api_scope",
  },
  media_assets_scoped: {
    reasonCode: "READ_POLICY_MEDIA_ASSETS_SCOPED",
    classification: "scope_filtered",
    responseHandling: "none",
    apiClientPolicy: "allowed_with_api_scope",
  },
  notification_self_service: {
    reasonCode: "READ_POLICY_NOTIFICATION_SELF_SERVICE",
    classification: "self_service",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  taxonomy_safe_metadata: {
    reasonCode: "READ_POLICY_TAXONOMY_SAFE_METADATA",
    classification: "scope_filtered",
    responseHandling: "none",
    apiClientPolicy: "allowed_with_api_scope",
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
