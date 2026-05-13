# Vexa PIM Enterprise Documentation Suite (Validated from Repository)

> Scope note (2026-03-06): This document is an enterprise architecture suite and includes broader Vexa PIM surface references.
> For connector-runtime and connector API contract truth in this repository, use:
> docs/connectors/PIM1_CONNECTOR_DEVELOPER_GUIDE_CTO_VALIDATED.md.
> In any conflict, the connector guide and current src/auth/protected-routes.ts route surface are authoritative for this repo.

## Validation Basis (Source of Truth Used)
- `docs/product/PRD.md`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260304130000_connector_framework_tables/migration.sql`
- `packages/db/prisma/migrations/20260304152000_runtime_ddl_backfill/migration.sql`
- `packages/db/prisma/migrations/20260305001000_connector_access_entitlements/migration.sql`
- `docs/openapi.yaml`
- `apps/api/src/main.ts`, `apps/api/src/app.module.ts`
- API controllers/services in `apps/api/src/**`
- `apps/web/src/components/nav/app-sidebar.tsx`
- `apps/web/src/app/**/page.tsx`
- `.github/workflows/ci.yml`, `.github/workflows/deploy-staging.yml`
- `README.md`, `.env.example`
- `docs/product/FIRST_SELLER_ONBOARDING_PLAYBOOK.md`
- `docs/runbooks/*.md`

---

## SECTION 1 — PRODUCT OVERVIEW

### 1. Product Overview
- Product name: **Vexa PIM**
- One-line description: India-first, multi-tenant PIM with connector-first marketplace architecture.
- Source: `docs/product/PRD.md`

### 2. Business Problem Definition
- Fragmented spreadsheet/channel data operations.
- High marketplace rejections from missing/invalid fields.
- Slow, error-prone bulk operations.
- Low readiness/risk visibility.
- Source: `docs/product/PRD.md`

### 3. Product Scope
- In-scope: catalog, taxonomy, compliance, issue inbox, bulk import/edit, marketplace simulation/export, connector install/permissions, plan usage, media, dashboard.
- Out-of-scope in current cycle: OMS replacement, full DAM intelligence automation, AI-led optimization dependency.
- Source: `docs/product/PRD.md`, controllers/modules in `apps/api/src`

### 4. Target Users
- Documented in PRD:
  - Admin
  - Editor
  - Viewer
  - Marketplace Ops
- Source: `docs/product/PRD.md`
- Additional roles beyond these: **Information not available in Vexa PIM project.**

### 5. Implemented Feature List (from modules/routes)
| Area | Implemented in Vexa PIM |
|---|---|
| Auth & Access | JWT login/logout, jti revocation blocklist, role guard, tenant middleware |
| Catalog | Products/variants CRUD, soft delete + purge, completeness score |
| Taxonomy | Categories + category attributes CRUD |
| Compliance | Rules CRUD, product validation, issue generation |
| Quality | Issue inbox listing + warning resolve |
| Bulk Ops | Bulk import templates/jobs/row repair/DLQ requeue; bulk edit preview/apply/history |
| Marketplace | Channels list, mappings/templates, simulation, export jobs, submissions/retry/dead-letter listing |
| Connectors | Definitions/install/list/reconnect/uninstall/delete, connector permissions |
| Media | Asset upload/list/validate, bulk media associations, SSRF protections |
| Dashboard | Readiness, catalog health, snapshot/trend |
| Billing | Plan usage summary, plan profile, plan tier update, plan guard |
| Audit & Metrics | Audit logs API, KPI trends API |
| ONDC/AI | ONDC endpoints (feature-flagged), auto-suggestions endpoints |

### 6. Terminology & Glossary (derived from models/routes)
- Product, Variant, Category, AttributeDefinition
- ComplianceRule, ValidationIssue
- ChannelMappingTemplate
- MarketplaceExportJob, ConnectorSubmission
- BulkImportJob/BulkImportRow, BulkEditOperation
- ConnectorDefinition/Installation/Credential/WebhookEvent
- PlanLimits, PlanUsage, TenantPlanProfile
- AuditLog, MediaAsset, DashboardSnapshot, KPI Metric Event

---

## SECTION 2 — PIM DOMAIN MODEL

### 7. Product Entity Model
| Entity | Key Fields | Relationships |
|---|---|---|
| `Product` | `id`, `tenantKey`, `title`, `description`, `brand`, `categoryId`, `hsnCode`, `gstRate`, `attributes(Json)`, `status`, `version`, `deletedAt`, `purgedById` | belongs to `Category`; has many `Variant`, `ValidationIssue`, `MarketplaceExportJob`, `BulkImportRow`, `BulkEditOperationItem` |

### 8. Attribute Model
| Entity | Key Fields | Relationships |
|---|---|---|
| `AttributeDefinition` | `id`, `tenantKey`, `categoryId`, `key`, `name`, `dataType`, `required`, `appliesTo`, `allowedValues(Json)` | belongs to `Category`; applied at product/variant level via `appliesTo` |

### 9. Product Family Model
- **Information not available in Vexa PIM project.**

### 10. Category Hierarchy
| Entity | Key Fields | Hierarchy Fields |
|---|---|---|
| `Category` | `id`, `tenantKey`, `name`, `slug`, `parentId`, `path` | parent-child via `parentId`, full path materialized in `path` |

### 11. Variant Model
| Entity | Key Fields | Relationships |
|---|---|---|
| `Variant` | `id`, `tenantKey`, `productId`, `skuCode`, `attributes(Json)`, `mrp`, `sellingPrice`, `inventoryQty`, `status` | belongs to `Product`; linked from media associations and validation flows |

### 12. Asset Model
| Entity | Storage | Key Fields |
|---|---|---|
| `media_assets` (SQL migration table) | External object storage path (`storage_path`) | `id`, `tenant_key`, `product_id`, `variant_id`, `file_name`, `mime_type`, `size_bytes`, `checksum`, `metadata`, `created_at` |

### 13. Data Validation Rules
- Built-in checks in `ComplianceService`:
  - HSN required + regex `^\d{4}(\d{2})?(\d{2})?$`
  - GST required + warning if not in `[0,3,5,12,18,28]`
  - Required category attributes check
  - ComplianceRule-based checks (required field, regex, range)
- Source: `apps/api/src/compliance/compliance.service.ts`

### 14. Product Completeness Logic
- `CatalogService.calculateCompletenessScore()`:
  - Required core fields: `title`, `brand`, `description`, `hsnCode`, `gstRate`
  - Plus required `AttributeDefinition` keys for product-level category attributes
  - Score = `round((filled_core + filled_required_attrs)/required_total*100)`
- Source: `apps/api/src/catalog/catalog.service.ts`

---

## SECTION 3 — CATALOG MODELING

### 15. Attribute Structure
- Category-scoped definitions with data type, required flag, appliesTo, allowed values.
- Product attributes stored as JSON object.
- Variant attributes stored as JSON object.

### 16. Product Family Structure
- **Information not available in Vexa PIM project.**

### 17. Category Tree
- Category tree built using `parentId` recursion and denormalized `path`.
- API provides listing and CRUD under `/api/v1/taxonomy/categories`.

### 18. Variant Structure
- Variants are child records of product with own SKU and pricing/inventory/status.
- CRUD available under catalog routes.

### 19. Localization or Channel Model
- Channel model present via `MarketplaceChannel` enum (`amazon`,`flipkart`,`meesho`), `ChannelMappingTemplate`, connector framework tables.
- Localization model: **Information not available in Vexa PIM project.**

### 20. Product Enrichment Workflow
- Implemented flow:
  1. Create/update product.
  2. Compliance validate (`/compliance/products/:id/validate`).
  3. Issues generated in `ValidationIssue`.
  4. Marketplace simulation for channel readiness.
  5. Export job submission.
- Source: catalog/compliance/marketplace modules.

---

## SECTION 4 — USER DOCUMENTATION (FEATURES PRESENT ONLY)

### 21. Product Creation
- UI route: `/catalog/products`
- API: `POST /api/v1/catalog/products` and `POST /api/v1/products`
- Required input fields include title/description/brand/category; status accepted but service enforces draft entry.
- On create, compliance validation is triggered.

### 22. Product Editing
- UI route: `/products/[id]`
- API: `PATCH /api/v1/catalog/products/:id` or `PATCH /api/v1/products/:id`
- Requires `expectedVersion` for optimistic locking.
- Invalid transition returns workflow error.

### 23. Category Management
- UI route: `/catalog/categories`
- API: `/api/v1/taxonomy/categories`
- Create/update/delete category is role-restricted to admin.

### 24. Attribute Management
- UI route: `/catalog/attributes`
- API: `/api/v1/taxonomy/categories/:id/attributes` and `/api/v1/taxonomy/categories/attributes/:attributeId`
- Category attribute definitions support product/variant scope.

### 25. Product Variants
- UI route: `/products/[id]` (Variants tab)
- API: `/api/v1/catalog/products/:id/variants`, `/api/v1/catalog/variants/:id`

### 26. Asset Management
- UI routes: `/catalog/media`, `/media`
- API: `/api/v1/media/assets`, `/api/v1/media/assets/:id/validation`, `/api/v1/media/bulk-associations`

### 27. Data Import and Export
- Import API: `/api/v1/bulk-import/*` (jobs, templates, rows, repair, error-report, requeue-dlq)
- Export/submission API: `/api/v1/marketplace/export-jobs*`, `/api/v1/submissions*`

### 28. Data Quality / Completeness
- UI routes: `/quality/issues`, `/quality/validation`, `/quality/completeness`, `/rejection`
- API: issue inbox (`/issues/inbox` via compliance module), compliance product issues, dashboard catalog health/readiness.

---

## SECTION 5 — API DOCUMENTATION

### 29. API Overview
- Base prefix: `/api/v1` set in bootstrap (`main.ts`).
- Swagger in non-production: `/api/v1/docs`, `/api/v1/docs-json`.

### 30. Authentication
- Login: `POST /api/v1/auth/login`
- Logout: `POST /api/v1/auth/logout`
- JWT with claims including `sub`, `tenantId`, `jti`, `role`, `iat`, `exp`.
- Legacy auth headers blocked.

### 31. Product APIs
- `/api/v1/catalog/products` (list/create/get/update/delete/purge)
- `/api/v1/products` (list/create/get/update)
- `/api/v1/catalog/products/:id/variants`, `/api/v1/catalog/variants/:id`

### 32. Category APIs
- `/api/v1/taxonomy/categories`
- `/api/v1/taxonomy/categories/:id`

### 33. Attribute APIs
- `/api/v1/taxonomy/categories/:id/attributes`
- `/api/v1/taxonomy/categories/attributes/:attributeId`

### 34. Asset APIs
- `/api/v1/media/assets`
- `/api/v1/media/assets/:id`
- `/api/v1/media/assets/:id/validation`
- `/api/v1/media/bulk-associations`

### 35. Search and Filtering
- Implemented query filters include examples:
  - submissions: `productId`, `connectorSlug`, `status`, `minAttempt`
  - issue inbox: severity/category/status/connector installation filters
  - marketplace templates: by category/channel
  - bulk import/bulk edit listing filters
- Full-text search service: **Information not available in Vexa PIM project.**

### 36. Pagination
- Cursor pagination is implemented.
- Defaults: `DEFAULT_CURSOR_LIMIT=50`, `MAX_CURSOR_LIMIT=200`.
- DTO: `pagination=cursor`, `limit`, `cursor`.

### 37. Webhooks or Events
- Webhook event storage table exists: `connector_webhook_events`.
- Queue lane exists: `WEBHOOK_EVENT`.
- Dedicated webhook receiver controller endpoint: **Information not available in Vexa PIM project.**
- ADR-004 webhook transport decision is pending.

### Real Request/Response Examples (from DTO/interfaces)
#### Login Request (`POST /api/v1/auth/login`)
```json
{
  "userId": "admin@tenant",
  "password": "your-password",
  "expiresInMinutes": 240
}
```
#### Login Success Response (`LoginResponse` interface)
```json
{
  "accessToken": "jwt-token",
  "tokenType": "Bearer",
  "expiresInSeconds": 14400,
  "userId": "admin@tenant",
  "tenantId": "default",
  "role": "admin"
}
```
#### Create Product Request (`CreateProductDto`)
```json
{
  "title": "Cotton Shirt",
  "description": "Regular fit cotton shirt",
  "brand": "Vexa PIM",
  "categoryId": "category-id",
  "hsnCode": "62046200",
  "gstRate": 18,
  "attributes": {
    "color": "black",
    "size": "M"
  },
  "status": "draft"
}
```
#### Create Category Request (`CreateCategoryDto`)
```json
{
  "name": "Men Shirts",
  "parentId": "optional-parent-category-id"
}
```

---

## SECTION 6 — INTEGRATION DOCUMENTATION

### 38. ERP Integration
- **Integration not defined in Vexa PIM project.**

### 39. Ecommerce Integration
- **Integration not defined in Vexa PIM project.**

### 40. DAM Integration
- Internal media storage integration exists (object storage path + CDN URL config via env).
- External DAM platform connector: **Integration not defined in Vexa PIM project.**

### 41. Marketplace Integration
- Connector-first framework implemented.
- Seeded connector definitions: `amazon-in`, `flipkart`, `meesho`.
- Capability-driven flow for publish/export.
- Connector implementations are present as stubs with TODOs for live operations.

### 42. Data Synchronization
- Export job and submission orchestration exists with status tracking and retry/dead-letter flows.
- Full bidirectional channel sync contract implementation: **Information not available in Vexa PIM project.**

### 43. Event-driven Integrations
- In-process queue service with lanes/backpressure exists.
- Webhook transport/receiver implementation decision is pending in ADR-004.

---

## SECTION 7 — SYSTEM ARCHITECTURE

### 44. High-Level Architecture
```text
Next.js Web (apps/web)
   -> REST (/api/v1/*)
NestJS API (apps/api)
   -> Prisma Service + Tenant Scope Extension
PostgreSQL (Prisma models + SQL runtime tables, RLS enabled)
Redis (JWT blocklist, dashboard cache)
In-process Queue (bulk import, connector submission, webhook-event lanes)
Object Storage/CDN (media assets, payload snapshot overflow URLs)
```

### 45. Service Architecture (AppModule)
- Imported modules include:
  - Auth, Audit, Billing, Taxonomy, Compliance, Dashboard
  - ConnectorFramework, ConnectorInstaller, Marketplace
  - BulkImport, BulkEdit, Catalog, Media, Metrics
  - RejectionIntelligence, AutoSuggestions
  - ONDC module only when `FEATURE_ONDC_ENABLED=true`
- Global guards/interceptor:
  - `JwtAuthGuard`, `RbacGuard`, `AuditLogInterceptor`
- Tenant middleware applied globally.

### 46. Data Flow Architecture (implemented paths)
- Catalog flow: product create/update -> compliance validation -> issues -> readiness/simulation -> export job.
- Import flow: create job -> process chunks -> row results -> repair/requeue -> product writes.
- Connector flow: install/reconnect/uninstall with permission + plan gating -> export/submission lifecycle.
- Dashboard flow: aggregate from products/submissions/issues/media into readiness/health endpoints.

### 47. Search and Indexing
- Dedicated search/indexing engine (Elasticsearch/OpenSearch/etc.): **Information not available in Vexa PIM project.**
- Database indexes and cursor pagination are implemented.

### 48. Caching Strategy
- Dashboard uses Redis cache (5-minute TTL).
- Non-production allows in-memory fallback cache.
- Cache keys include tenant-scoped prefixes such as `dashboard:readiness:{tenant}`.

### 49. Security Model
- JWT bearer auth; jti revocation blocklist.
- Role-based access guard.
- Tenant isolation:
  - tenant context middleware
  - Prisma tenant scope extension
  - RLS policies + CI verification script.
- Legacy client authority headers rejected.
- Media SSRF protections implemented.

### 50. Performance Model
- Cursor pagination enforced (default 50, max 200).
- Queue backpressure policies and circuit pause behavior.
- Formal SLA/SLO document: **Information not available in Vexa PIM project.**

---

## SECTION 8 — DATA ARCHITECTURE

### 51. Database Schema
- ORM schema: `packages/db/prisma/schema.prisma`
- Runtime SQL tables in migrations:
  - connector_* tables
  - media_assets
  - dashboard_snapshots
  - kpi_metric_events
  - ondc_mappings

### 52. Entity Relationships (selected)
| Parent | Child | Relationship |
|---|---|---|
| Category | Product | `Product.categoryId` |
| Category | AttributeDefinition | `AttributeDefinition.categoryId` |
| Product | Variant | `Variant.productId` |
| Product | ValidationIssue | `ValidationIssue.productId` |
| Product | MarketplaceExportJob | `MarketplaceExportJob.productId` |
| ConnectorDefinition | ConnectorInstallation | `connector_installations.connector_id` |
| ConnectorInstallation | ConnectorCredential | `connector_credentials.installation_id` |
| ConnectorInstallation | ConnectorSubmission | `connector_submissions.installation_id` |
| ConnectorInstallation | ConnectorWebhookEvent | `connector_webhook_events.installation_id` |

### 53. Product Storage Model
- Product core fields stored in normalized columns.
- Flexible product attributes stored as JSON.
- Soft delete with `deletedAt`; hard purge via explicit endpoint.
- Versioned updates with `version` optimistic locking.

### 54. Indexing Strategy (evidence-based)
- Prisma model indexes on product/category/variant/compliance/import/edit/plan/audit entities.
- Connector table indexes include tenant/time/status and idempotency unique.
- Media and dashboard metric/snapshot indexes included via SQL migrations.

### 55. Data Versioning
- Product versioning: `Product.version` + `expectedVersion` in update DTO.
- Mapping template version fields exist (`ChannelMappingTemplate.version`).
- Connector definition version field exists (`connector_version`).
- Global document-level data versioning system: **Information not available in Vexa PIM project.**

---

## SECTION 9 — IMPLEMENTATION AND DEPLOYMENT

### 56. System Requirements
- Node.js 24+
- Docker Desktop (local Postgres/Redis/RabbitMQ)
- PostgreSQL, Redis, RabbitMQ
- Source: `README.md`

### 57. Installation Process
1. Copy `.env.example` to `.env`.
2. `npm install`
3. `npm run infra:up`
4. `npm run prisma:generate`
5. `npm run prisma:migrate:init`
6. Run API/Web dev scripts.

### 58. Deployment Architecture
- GitHub Actions staging deploy workflow:
  - install, prisma generate, migrate deploy, build API/web, provider deploy command, smoke tests.
- `STAGING_DEPLOY_COMMAND` and `STAGING_BASE_URL` are required secrets.

### 59. Container / Cloud Setup
- Local containers: Postgres 16, Redis 7, RabbitMQ management via `docker-compose.yml`.
- Cloud media baseline template exists: `deploy/aws/media-baseline.yaml`.
- Full production topology specification: **Information not available in Vexa PIM project.**

### 60. Environment Configuration
- `.env.example` defines DB/JWT/Redis/auth mode/encryption keys/media/feature flags.
- Startup env validation via Zod in `apps/api/src/common/env-validation.ts`.

---

## SECTION 10 — OPERATIONS

### 61. CI/CD Pipeline
- CI:
  - prisma generate
  - prisma migrate deploy + tenant RLS verify script
  - unsafe raw SQL comment guard
  - lint/build
  - integration tests (isolation, amazon validation, completeness)
  - OpenAPI freshness check
- Staging deploy workflow as above.

### 62. Monitoring
- `/api/v1/health` exposes status, env, auth mode, db pool metrics, queue metrics.
- `/api/v1/metrics/kpi-trends` available.
- External monitoring stack definitions: **Information not available in Vexa PIM project.**

### 63. Logging
- Structured logger service with correlation ID middleware and tenant-aware fields.
- JSON log payload includes level/message/timestamp/correlationId/meta.

### 64. Error Handling
- HTTP exceptions with structured error payloads in auth/plan/bulk/connector flows.
- Queue handler errors captured via callback hooks.
- Submission retry/dead-letter endpoints available.

### 65. Backup Strategy
- Backup references exist in runbooks:
  - credential rotation requires `pg_dump` backup before run.
  - test data governance runbook advises backup before execute mode.
- Automated scheduled backup implementation details: **Information not available in Vexa PIM project.**

### 66. Disaster Recovery
- **Information not available in Vexa PIM project.**

### 67. Troubleshooting
- Available operational artifacts:
  - health endpoint
  - queue metrics in health
  - runbooks for auth bootstrap, key rotation, test data governance
  - staging post-deploy checks script references in workflow

---

## SECTION 11 — IMPLEMENTATION PLAYBOOK

### 68. Catalog Onboarding
- Documented in `docs/product/FIRST_SELLER_ONBOARDING_PLAYBOOK.md`:
  - entry criteria
  - 120-minute session flow
  - evidence capture
  - exit gates
  - escalation rules
  - weekly KPI snapshot

### 69. Data Migration
- Bulk import supports CSV/XLSX/JSON ingestion and row-level repair.
- Generic legacy data migration program documentation: **Information not available in Vexa PIM project.**

### 70. Attribute Mapping
- Marketplace field/category mapping via templates:
  - `ChannelMappingTemplate` model
  - endpoints under `/api/v1/marketplace/categories/:id/templates` and `/api/v1/marketplace/channels/:channel/mapping`

### 71. Product Import Strategy
- Bulk import process includes:
  - template creation/listing
  - mapping suggestions
  - job creation
  - chunk processing
  - row status tracking
  - error CSV report
  - row repair and DLQ requeue

### 72. Governance Model
- RBAC (`admin`/`editor`/`viewer`)
- Tenant scoping + RLS verification
- Plan limits and guard enforcement
- Connector action permissions
- Audit logging
- Privacy flows (consent/export/delete account requests)

### 73. Catalog Quality Rules
- Compliance rules + dynamic category attributes + GST/HSN checks
- Validation issues tracked as open/resolved
- Issue inbox with warning resolution flow
- Completeness scoring in catalog and dashboard health outputs

---

## Architecture Diagram (Module View)
```text
[Web UI: Next.js]
  - Dashboard / Catalog / Channels / Operations / Quality / Admin
          |
          v
[API: NestJS /api/v1]
  - Auth, RBAC, Tenant middleware
  - Catalog, Taxonomy, Compliance
  - Bulk Import, Bulk Edit
  - Marketplace, Connector Installer/Framework
  - Dashboard, Media, Metrics, Audit
          |
          v
[Data Layer]
  - PostgreSQL (Prisma models + SQL runtime tables, RLS)
  - Redis (JWT blocklist + dashboard cache)
  - Object storage/CDN (media + payload snapshots)
```

