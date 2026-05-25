---
title: Data Model Reference
audience: internal-eng
status: active
last_updated: 2026-05-25
owner: Engineering
---

Use this document to understand Vexa PIM's core database schema, relationships, and indexing strategy.

Source of truth: [`packages/db/prisma/schema.prisma`](../../packages/db/prisma/schema.prisma)

All tables use PostgreSQL via Neon. Row-level security is enforced in the API via `PrismaService.tenant(tenantKey)` — see [`apps/api/src/prisma/prisma.service.ts`](../../apps/api/src/prisma/prisma.service.ts).

---

## Domain Map

```
WORKSPACE / IDENTITY
  WorkspaceDirectory          — workspace slug ↔ tenantKey mapping
  AuthIdentity                — user credentials, role, lock state
  ApiAccessKey                — API keys with scopes and expiry
  TenantAuthPolicy            — MFA, session timeout, allowed auth methods
  UserMfaEnrollment           — per-user TOTP enrollment
  OidcConfig                  — OIDC provider configuration per workspace

CATALOG
  Category                    — hierarchical product taxonomy
  Product                     — catalog SKUs with status lifecycle
  Variant                     — product variants (size, color, etc.)
  MediaAsset                  — images and documents linked to products
  AttributeDefinition         — custom attribute schema per category
  ValidationIssue             — quality rule violations per product/variant
  ComplianceRule              — rules that produce ValidationIssues

WORKFLOW
  ChangeRequest               — approval workflow requests
  ApprovalComment             — comments on change requests
  WorkflowSla                 — SLA deadlines per workflow stage

CHANNELS
  ConnectorDefinition         — registered connector types (flipkart, amazon-in, shopify, meesho)
  ConnectorInstallation       — installed connector per workspace
  ConnectorCredential         — encrypted credentials per installation
  ConnectorMappingVersion     — versioned category → channel field mapping
  ConnectorMappingEvent       — audit trail for mapping lifecycle changes
  ConnectorPermission         — permission grants for connector access
  ConnectorProductLink        — tracks which products are linked to a connector
  ConnectorProductSyncState   — per-product sync state per connector
  ConnectorSyncSchedule       — scheduled sync jobs per connector
  ConnectorSubmission         — channel submission record per product/export
  ConnectorWebhookEvent       — inbound webhook events from channels
  AccessScopeAssignment       — connector scope grants

EXPORT / IMPORT
  MarketplaceExportJob        — export/publish job per product+connector
  BulkImportJob               — CSV import job metadata
  BulkImportRun               — a processing pass within an import job
  BulkImportRow               — individual row within an import run
  BulkImportTemplate          — column mapping templates
  BulkEditOperation           — bulk attribute edit jobs
  BulkEditOperationItem       — per-product item within a bulk edit

BILLING
  TenantPlanProfile           — plan tier, billing status, Stripe IDs
  PlanLimits                  — plan tier limits (SKU count, API rate, etc.)
  PlanUsage                   — current usage counters per tenant
  TenantCommercialRequest     — upgrade/change requests from tenant admins

OBSERVABILITY
  AuditLog                    — immutable audit trail for all state changes
  DashboardSnapshot           — hourly catalog health snapshot
  KpiMetricEvent              — time-series KPI events

NOTIFICATIONS
  UserNotification            — in-app notification records
  OutboundWebhookEndpoint     — registered outbound webhook endpoints
  OutboundWebhookDelivery     — delivery attempt records per webhook

AUTH / PRIVACY
  AccountConsentEvent         — TOS/privacy consent records
  AccountExportRequest        — DPDP data export request tracking
  AccountDeletionRequest      — DPDP deletion request tracking
  AuthRecoveryToken           — password reset and unlock tokens
  PublicSignupRequest         — pending self-serve signups before verification

INTERNATIONALISATION
  Market, Currency, PriceList, ProductPrice  — multi-market pricing
  ProductTranslation, CategoryTranslation    — localised content

QUALITY
  RejectionIntelligence       — inferred rejection risk from past submissions
```

---

## Key Tables

### Product

The central catalog entity.

| Column | Type | Notes |
|--------|------|-------|
| `id` | cuid | Primary key |
| `tenantKey` | String | RLS boundary — all queries must filter by this |
| `title` | String | Required |
| `status` | RecordStatus | `draft \| in_review \| approved \| rejected \| active \| archived` |
| `categoryId` | FK → Category | Required; restricts delete of categories with products |
| `hsnCode` | String? | Required for marketplace submission |
| `gstRate` | Float? | Required for marketplace submission (0/5/12/18/28) |
| `attributes` | Json | Dynamic attributes defined by `AttributeDefinition` |
| `deletedAt` | DateTime? | Soft delete; `null` = active |
| `purgedById` | String? | Set when hard-purged by ops |

Key indexes:
- `(tenantKey, status)` — catalog list queries
- `(tenantKey, deletedAt, updatedAt DESC, id DESC)` — delta sync cursor pagination
- `(tenantKey, status, deletedAt, id)` — SP-API delta sync candidate scan

### TenantPlanProfile

Billing and access state per workspace. One row per tenant. Updated only through `PlanUsageService.updateCommercialStateForTenant()`.

| Column | Type | Notes |
|--------|------|-------|
| `tenantKey` | String (unique) | FK to WorkspaceDirectory |
| `planTier` | String | `STARTER \| GROWTH \| ENTERPRISE` |
| `billingStatus` | String | `trial \| active_paid \| past_due \| cancelled` |
| `accessStatus` | String | `active \| suspended` |
| `trialEndsAt` | DateTime? | When trial expires |
| `paidThroughAt` | DateTime? | Last paid period end (from Stripe invoice) |
| `graceEndsAt` | DateTime? | Grace period end after payment failure |
| `externalCustomerId` | String? | Stripe customer ID |
| `externalSubscriptionId` | String? | Stripe subscription ID |

### WorkspaceDirectory + AuthIdentity

`WorkspaceDirectory` maps `workspaceSlug → tenantKey`. Login resolves the workspace first, then looks up `AuthIdentity` by `userId` (email address).

| Column | Table | Notes |
|--------|-------|-------|
| `tenantKey` | WorkspaceDirectory (unique) | Also the RLS key for all tenant tables |
| `workspaceSlug` | WorkspaceDirectory (unique) | URL-safe slug chosen at signup |
| `isActive` | WorkspaceDirectory | `false` = workspace not yet verified or suspended |
| `userId` | AuthIdentity (unique) | Email address used as login ID |
| `role` | AuthIdentity | Legacy single-role field (see `assignedRoles`) |
| `assignedRoles` | AuthIdentity | Multi-role array; wins over `role` if non-empty |
| `passwordHash` | AuthIdentity | bcrypt hash; null = SSO-only account |
| `lockedUntil` | AuthIdentity | Set by brute-force protection |

### ConnectorSubmission

Tracks one marketplace submission attempt per product per connector.

| Column | Type | Notes |
|--------|------|-------|
| `connectorSlug` | String | Which marketplace channel |
| `productId` | FK → Product | |
| `status` | ExportJobStatus | `queued \| processing \| completed \| failed \| dead_letter` |
| `externalId` | String? | Marketplace's reference ID after acceptance |
| `errorCode` | String? | Machine-readable failure code |
| `payloadSnapshot` | Json? | Request payload (redacted where sensitive) |

### AuditLog

Immutable audit trail. Never updated, never deleted (within retention window).

| Column | Notes |
|--------|-------|
| `actorId` | Who made the change (userId or system actor key like `stripe:webhook`) |
| `actorRole` | Role at time of action |
| `action` | Machine-readable action code (`PRODUCT_STATUS_CHANGED`, `BILLING_PLAN_TIER_SET`, etc.) |
| `resource` | Resource type |
| `resourceId` | Resource ID |
| `metadata` | JSON context (before/after values, request IDs) |

---

## RLS Implementation

The API enforces tenant isolation in the application layer via `PrismaService.tenant(tenantKey)`:

```typescript
// Every query inside a request is scoped to the request's tenantKey
const prisma = this.prisma.tenant(request.tenantKey);
await prisma.product.findMany({ where: { status: "approved" } });
```

`prisma.tenant(tenantKey)` returns a Prisma client with a global `where` filter applied to every query. Tables that lack a `tenantKey` column (e.g., `Category`) are shared across tenants by design.

---

## ERD (Key Relationships)

```
WorkspaceDirectory ──── AuthIdentity (one workspace, many users)
                    │
                    ├── TenantPlanProfile (one workspace, one profile)
                    │
                    └── ConnectorInstallation ──── ConnectorCredential
                              │
                              └── ConnectorMappingVersion

Product ──── Category
       ├──── Variant
       ├──── MediaAsset
       ├──── ValidationIssue ──── ComplianceRule
       ├──── MarketplaceExportJob ──── ConnectorInstallation
       └──── BulkImportRow ──── BulkImportJob
```

---

## Migration Management

Migrations live in `packages/db/prisma/migrations/`. Run via:

```bash
# Development — applies any pending migrations
npx prisma migrate dev --schema packages/db/prisma/schema.prisma

# Production — applied automatically via Railway preDeployCommand
node scripts/prisma-migrate-deploy.cjs
```

See [Production Deployment Runbook](../runbooks/production-deploy.md) for safe migration procedure.
