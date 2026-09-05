---
title: Auth Revocation Degraded Read Route Inventory
status: draft-for-security-review
owner: Security / CTO / SRE
last_updated: 2026-09-05
---

# Auth Revocation Degraded Read Route Inventory - 2026-09-05

This inventory supports P1-2 technical proof for revocation-authority outage
behavior. It records which authenticated read policies may continue in bounded
degraded mode if revocation authority is unavailable.

## Decision

Default behavior: **fail closed**.

Degraded read behavior is allowed only for explicitly named non-sensitive read
policies. Classification-wide degradation is not approved.

## Approved For Degraded Read

| Policy or classification | Reason | Scope |
| --- | --- | --- |
| `public_safe` classification | Authenticated route has explicitly declared public-safe read behavior | GET, HEAD, OPTIONS only |
| `taxonomy_safe_metadata` read policy | Safe taxonomy metadata used for bounded selector/list metadata; no tenant credential, auth, admin, audit, billing governance, catalog item, media asset, webhook, or account export payloads | GET, HEAD, OPTIONS only |

## Explicitly Not Approved

The following classifications and policies fail closed during revocation
authority outage unless a future Security review names the exact policy in the
degraded allowlist:

- `self_service`
- `admin_only`
- `admin_editor`
- `role_redacted`
- `scope_filtered`
- `human_only`
- `api_client_allowed`
- `deprecated_or_blocked`
- `account_privacy_self_service`
- `account_export_download_self_service`
- `catalog_stats_redacted`
- `catalog_products_redacted`
- `catalog_product_detail_redacted`
- `catalog_search_redacted`
- `catalog_variants_redacted`
- `dashboard_health_redacted`
- `workspace_users_governance_redacted`
- `workspace_access_scopes_governance_redacted`
- `api_keys_governance_redacted`
- `connector_permissions_governance_redacted`
- `billing_plan_profile_governance_redacted`
- `billing_plan_tier_self_service`
- `billing_upgrade_request_governance_redacted`
- `audit_events_governance_redacted`
- `audit_logs_governance_redacted`
- `outbound_webhooks_governance_redacted`
- `outbound_webhook_deliveries_governance_redacted`
- `oidc_config_governance_redacted`
- `issue_inbox_scoped`
- `media_assets_scoped`
- `notification_self_service`

## Guard Enforcement

`JwtAuthGuard` enforces this inventory by requiring all of the following before
degraded read is allowed:

1. HTTP method is `GET`, `HEAD`, or `OPTIONS`.
2. No step-up metadata is present.
3. No admin-boundary metadata is present.
4. No required `admin` role metadata is present.
5. Route is either classified `public_safe` or has a read policy explicitly
   listed in the approved degraded-read allowlist.

All mutating, admin, security-sensitive, unannotated read, and broad
classification-only routes fail closed while revocation authority is
unavailable.

## Remaining Runtime Proof

- Prove mutating requests deny during revocation-authority outage.
- Prove admin and step-up reads deny during revocation-authority outage.
- Prove refresh-token flow returns invalid token when JTI or credential
  revocation lookup fails.
- Prove unannotated reads deny.
- Prove `taxonomy_safe_metadata` is the only currently approved policy that can
  continue in degraded mode.
- Prove Error Authority/audit/alert signals fire for JTI and credential
  revocation read failures.
