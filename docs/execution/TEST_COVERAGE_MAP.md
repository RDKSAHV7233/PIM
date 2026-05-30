---
title: Integration Test Coverage Map
audience: internal-eng
status: active
last_updated: 2026-05-28
owner: Engineering
---

Use this document to understand which integration tests cover which product features and to identify coverage gaps.

Test locations:
- API integration tests: `apps/api/test/integration/` (142 files)
- Web integration tests: `apps/web/test/integration/` (117 files)

All tests are static contract tests (source analysis) or in-process unit-style tests. Tests requiring a live database or live API are noted.

---

## Coverage Map

### Authentication & Session Management

| Test file | What it covers |
|-----------|---------------|
| `auth-login-lockout.test.cjs` | Brute-force protection, lockout on failed attempts |
| `auth-password-reset.test.cjs` | Password reset email flow, token expiry |
| `auth-per-user-password.test.cjs` | Per-user password isolation in DB auth mode |
| `auth-revocation.test.cjs` | JWT revocation via blocklist |
| `jwt-blocklist-contract.test.cjs` | JWT blocklist Redis integration contract |
| `auth-legacy-hash-migration.test.cjs` | bcrypt hash format upgrade path |
| `auth-login-upstream-unavailable.test.cjs` (web) | Login page graceful degradation |
| `auth-shell-ui.test.cjs` (web) | Login page component structure |
| `auth-cookie-csrf.test.cjs` (web) | CSRF token and cookie handling |

### Multi-Factor Authentication

| Test file | What it covers |
|-----------|---------------|
| `mfa-enrollment.test.cjs` | TOTP enrollment, backup codes |
| `auth-mfa-login-contract.test.cjs` | MFA-gated login flow |
| `mfa-login-db-proof.test.cjs` (web) | MFA login UI contract |
| `mfa-web-pages-contract.test.cjs` (web) | MFA enrollment web pages |

### RBAC & Access Control

| Test file | What it covers |
|-----------|---------------|
| `rls-isolation.test.cjs` | Tenant data isolation — no cross-tenant data leakage |
| `access-policy-foundation.test.cjs` | Role-based API access, 8-role hierarchy |
| `access-policy-remediation.test.cjs` | Role remediation after policy change |
| `auth-assigned-roles-read-path.test.cjs` | Multi-role assignment and resolution |
| `auth-assigned-roles-rollout-runbook.test.cjs` | Roles migration runbook contract |
| `delegated-access-scopes.test.cjs` | API key scope delegation |
| `connector-access-entitlements.test.cjs` | Connector access RBAC |
| `connector-access-principal-validation.test.cjs` | Connector principal verification |
| `auth-oidc-config-step-up.test.cjs` | OIDC config step-up protection |
| `connector-mapping-step-up.test.cjs` | Step-up re-auth for mapping actions |

### Catalog & Products

| Test file | What it covers |
|-----------|---------------|
| `product-workflow-transitions.test.cjs` | draft → in_review → approved → published lifecycle |
| `catalog-completeness.test.cjs` | Catalog health and completeness scores |
| `catalog-global-search.test.cjs` | Full-text search across catalog |
| `catalog-products-list-projections.test.cjs` | List API projections and filters |
| `product-relationships.test.cjs` | Product relationship types |
| `product-revision-history.test.cjs` | Product version history |
| `product-activity-timeline.test.cjs` | Activity feed per product |
| `create-product-pricing-normalization.test.cjs` | Price normalisation on create |
| `cursor-pagination.test.cjs` | Cursor-based pagination correctness |
| `enterprise-search.test.cjs` | Advanced search / filter combinations |
| `category-tenant-uniqueness.test.cjs` | Category slug uniqueness per tenant |
| `variant-tenant-uniqueness.test.cjs` | Variant SKU uniqueness per tenant |
| `tenant-scoped-uniqueness.test.cjs` | General tenant-scoped uniqueness constraints |

### Bulk Import

| Test file | What it covers |
|-----------|---------------|
| `bulk-import-validate.test.cjs` | CSV validation rules, error reporting |
| `bulk-import-preflight.test.cjs` | Pre-flight header and schema validation |
| `bulk-import-tenant-boundary.test.cjs` | Import isolation between tenants |
| `bulk-import-spreadsheet-disabled.test.cjs` | XLSX import correctly disabled |
| `import-preflight.test.cjs` | Pre-flight response shape |

### Meesho

| Test file | What it covers |
|-----------|---------------|
| `meesho-export-contract.test.cjs` | ExcelJS import, 18-column template, filename pattern, MIME type, no-PUBLISH contract |

### Connectors & Channels

| Test file | What it covers |
|-----------|---------------|
| `connector-definitions.test.cjs` | Registered connector registry (4 connectors) |
| `connector-capability-orchestration.test.cjs` | Capability-based routing |
| `connector-mapping-lifecycle.test.cjs` | draft → validated → published → archived |
| `connector-mapping-rollback.test.cjs` | Mapping rollback creates new published clone |
| `connector-mapping-precedence.test.cjs` | One published mapping per tenant+connector+scope |
| `connector-idempotency-semantics.test.cjs` | Idempotent install/update semantics |
| `connector-issue-contract.test.cjs` | Issue creation on connector validation failure |
| `connector-planned-install-gating.test.cjs` | Install blocked when connector not ready |
| `connector-payload-snapshot-cap.test.cjs` | Payload snapshot size limiting |
| `marketplace-capability-gating.test.cjs` | Capability checks before publish |
| `marketplace-readiness-batch.test.cjs` | Batch publish-readiness evaluation |
| `mapping-manager.test.cjs` | Mapping manager service contract |

### Amazon India

| Test file | What it covers |
|-----------|---------------|
| `amazon-install-credentials.test.cjs` | SP-API credential install flow |
| `amazon-authoritative-validation.test.cjs` | SP-API credential validation |
| `amazon-publish-job.test.cjs` | Amazon publish job creation and processing |
| `amazon-status-sync.test.cjs` | Status sync from Amazon |
| `amazon-webhook-ingestion.test.cjs` | Amazon webhook event ingestion |
| `amazon-webhook-parse.test.cjs` | Amazon webhook payload parsing |
| `amazon-webhook-backlog-resolution.test.cjs` | Webhook backlog processing |
| `amazon-webhook-relay-controller.test.cjs` | Webhook relay controller |
| `amazon-webhook-queue-processing.test.cjs` | Queue-based webhook processing |
| `amazon-runtime-foundation.test.cjs` | Amazon connector runtime foundation |

### Flipkart

| Test file | What it covers |
|-----------|---------------|
| `flipkart-install-credentials.test.cjs` | API key install flow |
| `flipkart-publish-job.test.cjs` | Flipkart publish job |
| `flipkart-status-sync.test.cjs` | Status sync |
| `flipkart-auto-status-sync.test.cjs` | Automated status sync polling |
| `flipkart-token-expiry-alerting.test.cjs` | Token expiry detection and alert |
| `flipkart-update-retry.test.cjs` | Failed submission retry logic |
| `flipkart-runtime-foundation.test.cjs` | Flipkart connector runtime |
| `flipkart-seller-surface-availability.test.cjs` | Seller-facing UI availability |

### Shopify

| Test file | What it covers |
|-----------|---------------|
| `shopify-runtime-foundation.test.cjs` | Shopify connector runtime |
| `shopify-product-set-payload.test.cjs` | Shopify ProductSet payload construction |
| `shopify-publication-targets-api.test.cjs` | Publication target selection API |
| `shopify-publication-webhook.test.cjs` | Shopify publication event webhooks |

### Billing & Commercial

| Test file | What it covers |
|-----------|---------------|
| `billing-commercial-control.test.cjs` | Plan tier and billing status state machine |
| `billing-commercial-governance-access.test.cjs` | Billing ops endpoint RBAC |
| `billing-commercial-suspension.test.cjs` | Suspension at login/JWT/API key |
| `billing-commercial-marketplace-suspension.test.cjs` | Suspension blocks marketplace operations |
| `billing-commercial-notifications.test.cjs` | Trial ending / payment failed email |
| `billing-commercial-audit-attribution.test.cjs` | Billing changes recorded in audit |
| `billing-commercial-side-effects.test.cjs` | PlanGuard side effects on limit breach |
| `billing-upgrade-request.test.cjs` | Upgrade request creation |
| `billing-usage-cache-read.test.cjs` | Plan usage cache read path |
| `stripe-webhook.test.cjs` | Stripe webhook controller contract (46 assertions) |

### Signup

| Test file | What it covers |
|-----------|---------------|
| `public-signup.test.cjs` | End-to-end signup + verification flow (requires DB) |
| `public-signup-ui.test.cjs` (web) | Signup page component structure and feature gating |
| `public-signup-web-flow.test.cjs` (web) | Signup API proxy routes (requires DB) |
| `platform-tenant-provisioning.test.cjs` | Platform-level workspace provisioning |

### Notifications & Webhooks

| Test file | What it covers |
|-----------|---------------|
| `notification-event-coverage.test.cjs` | All notification event types present |
| `notifications-center.test.cjs` | Notification list and mark-read |
| `notifications-tenant-boundary.test.cjs` | Notifications isolated per tenant |
| `outbound-webhooks.test.cjs` | Outbound webhook delivery contract |
| `webhook-dedupe-scope.test.cjs` | Webhook deduplication |

### Audit & Observability

| Test file | What it covers |
|-----------|---------------|
| `audit-explorer-api.test.cjs` | Audit log list and filter API |
| `audit-tenant-boundary.test.cjs` | Audit logs isolated per tenant |
| `audit-actor-context.test.cjs` | Actor context recorded on all mutations |
| `metrics-kpi-trends.test.cjs` | KPI metric time-series |
| `dashboard-aggregations.test.cjs` | Dashboard health snapshot aggregations |
| `dashboard-tenant-boundary.test.cjs` | Dashboard data isolated per tenant |

### Infrastructure & Security

| Test file | What it covers |
|-----------|---------------|
| `env-validation.test.cjs` | Environment variable validation and startup |
| `internal-token-hardening-static.test.cjs` | Ops token hardening |
| `media-ssrf-guard.test.cjs` | SSRF protection on media URL ingestion |
| `media-tenant-boundary.test.cjs` | Media assets isolated per tenant |
| `credential-rotation.test.cjs` | Connector credential rotation |
| `queue-durability.test.cjs` | BullMQ queue durability guarantees |
| `railway-api-package-contract.test.cjs` | Railway deployment contract |

---

## Coverage Gaps

| Area | Gap | Severity |
|------|-----|---------|
| Stripe webhooks — live | Contract test only; no live Stripe event replay test | Medium |
| Signup flow — login after verify | `public-signup.test.cjs` login step fails in CI (pre-existing; requires seeded DB) | Medium |
| Meesho export — live API | M-1 (ExcelJS export) shipped and contract-tested; M-2 live API blocked on `meesholink-integration@meesho.com` access | Low (awaiting vendor access) |
| ONDC | Feature-gated; no end-to-end test | Low (feature not shipped) |
| CommercialRemindersService | No test for interval-based reminder scheduling | Low |
| Phase 3 connection pooling | Not yet tested under concurrent load | Medium (Phase 3 item) |
