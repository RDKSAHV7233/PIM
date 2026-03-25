# TEJ PIM Flipkart v1 Implementation Plan

Status: Contract locked for implementation
Date: 2026-03-10
Audience: Product, platform, and connector engineers implementing Flipkart v1 on current TEJ PIM

## 1. Scope

This plan defines the implementation contract for Flipkart v1 in TEJ PIM.

It is intentionally strict. It freezes the decisions that must not drift during implementation:
- connector capability model
- installation and credential contract
- taxonomy strategy
- operation model
- idempotency contract
- response normalization contract
- seller-facing UI truth

This is a TEJ PIM implementation plan, not a generic marketplace architecture note.

## 2. Validated TEJ PIM Surfaces

Flipkart v1 will build on these existing TEJ PIM surfaces:

### Installation and connector framework
- `apps/api/src/connector-installer/connector-installer.controller.ts`
- `apps/api/src/connector-installer/connector-installer.service.ts`
- `apps/api/src/connector-framework/connector-framework.service.ts`
- `apps/api/src/connector-framework/connector.registry.ts`
- `packages/db/prisma/migrations/20260304130000_connector_framework_tables/migration.sql`

### Marketplace and mapping lifecycle
- `apps/api/src/marketplace/marketplace.controller.ts`
- `apps/api/src/marketplace/marketplace.service.ts`
- `apps/api/src/marketplace/connector-mapping.service.ts`
- `packages/db/prisma/migrations/20260306171000_connector_mapping_lifecycle_v1/migration.sql`

### Current web surfaces
- `apps/web/src/app/channels/mappings/page.tsx`
- `apps/web/src/app/products/[id]/page.tsx`
- `apps/web/src/app/catalog/products/page.tsx`
- `apps/web/src/app/actions.ts`
- `apps/web/src/lib/api.ts`

### Existing product contract
- `docs/product/PRD.md`
- `docs/execution/INCREMENT_STATE.json`

## 3. Locked v1 Decisions

### 3.1 Connector type
Flipkart v1 is:
- `publish-capable`

Seller-facing truth:
- action label must be `Publish to Flipkart`
- not `Export`

### 3.2 v1 scope
Included:
- listing create/update
- price update
- inventory update
- category/taxonomy alignment
- publish-readiness gating
- failure visibility
- retry/requeue visibility

Deferred:
- order sync
- notifications/webhooks
- returns
- fulfillment lifecycle
- standalone reconciliation tooling

### 3.3 Taxonomy strategy
Flipkart v1 uses:
- imported/snapshotted taxonomy

It does not use:
- live provider taxonomy lookups during seller publish flow

Rationale:
- stable category requirements
- testable readiness logic
- no publish-time dependency on external taxonomy drift

### 3.4 Operation model
Flipkart v1 uses:
- one unified `Publish to Flipkart` action

This unified publish operation includes:
- listing payload
- price
- inventory

Flipkart v1 does not introduce separate seller-facing actions for:
- sync price
- sync inventory

### 3.5 Mapping model
Flipkart v1 reuses the current TEJ PIM lifecycle mapping system.

It does not create:
- a second mapping editor
- a Flipkart-only mapping subsystem
- a second category-mapping subsystem

Current mapping contract remains:
- `draft -> validated -> published -> superseded -> archived`
- one published mapping per `(tenant, connector, categoryScope)`

### 3.6 Real provider validation
Implementation may proceed now with:
- mocked/provider-simulated execution
- connector-level automated validation

Real provider validation is deferred until:
- sandbox credentials are configured in UI

## 4. Installation and Credential Contract

Flipkart installation must use the existing TEJ PIM connector installation model.

The Flipkart installation contract must expose:
- `clientId`
- `clientSecret`
- `sellerAccountId` or equivalent seller identifier if required by provider flow
- token fields only if required by the validated auth flow

Credential split:
- non-secret:
  - account identifier
  - display/config metadata
- secret:
  - client secret
  - access token / refresh token if applicable

Rules:
- credentials must be stored through current TEJ PIM encrypted connector credential flow
- no env-driven production shortcut
- test connection must validate real credential shape and provider reachability when sandbox credentials exist

## 5. Taxonomy Contract

Flipkart taxonomy must be stored inside TEJ PIM-owned persistence.

The taxonomy snapshot model must support:
- category id
- category path / display name
- required target attributes per category
- version or import timestamp
- active snapshot tracking

Operational model:
- taxonomy is imported through controlled ingestion
- readiness uses the imported snapshot
- category search and unmapped category flows use the imported snapshot

This means:
- publish-readiness is deterministic for a given snapshot
- seller workflows do not depend on live provider taxonomy fetches

## 6. Response Normalization Contract

Every Flipkart publish execution must normalize into one of:
- `completed`
- `failed`
- `retrying`

### Success payload contract
Must include:
- `connectorSlug`
- `installationId`
- `productId`
- `operation`
- `externalRef` if provider returns one
- `submittedAt`
- `channelStatus`

### Failure payload contract
Must include:
- `connectorSlug`
- `installationId`
- `productId`
- `operation`
- `failureCode`
- `failureReason`
- `retryable`
- `fieldPath` if failure is field/category specific

Rules:
- seller-visible failure reason must come from normalized failure payload
- raw provider payload may be stored for diagnostics, but seller UI must not depend on raw provider text

## 7. Idempotency Contract

Flipkart v1 idempotency key:
- `(tenantKey, installationId, productId, operation, sourceVersionHash)`

Definitions:
- `tenantKey`: current tenant scope
- `installationId`: current Flipkart installation
- `productId`: current product
- `operation`: `PUBLISH`
- `sourceVersionHash`: deterministic hash of the effective mapped publish input

Rules:
- retries must reuse the same logical idempotency key
- duplicate process/requeue calls must not create duplicate live submissions
- idempotency must be enforced before external provider submission

## 8. Seller-Facing UI Truth

Seller truth for Flipkart v1:
- show `Publish to Flipkart`
- show readiness blockers before action
- show failed publish with actionable reason
- show retry only when safe

Seller UI must not expose as primary concepts:
- payload envelope
- template manager
- internal connector runtime language
- raw provider error dumps

Canonical surfaces:
- product detail is the main publish surface
- `/channels/mappings` is the canonical mapping surface

## 9. File-by-File Implementation Scope

### Phase A: Contract and schema
- `packages/db/prisma/schema.prisma`
- new migration under `packages/db/prisma/migrations/**`
- `apps/api/src/marketplace/dto/**`
- `docs/connectors/**`

### Phase B: Installation and credentials
- `apps/api/src/connector-installer/**`
- `apps/api/src/connector-framework/**`
- `apps/web/src/app/connectors/**`
- `apps/web/src/app/actions.ts`
- `apps/web/src/lib/api.ts`

### Phase C: Taxonomy and mapping
- `apps/api/src/marketplace/connector-mapping.service.ts`
- `apps/api/src/marketplace/marketplace.controller.ts`
- optional new taxonomy service under `apps/api/src/marketplace/**`
- `apps/web/src/app/channels/mappings/page.tsx`

### Phase D: Publish execution
- `apps/api/src/marketplace/marketplace.service.ts`
- optional Flipkart-specific publish adapter under `apps/api/src/marketplace/**` or `apps/api/src/connector-framework/**`

### Phase E: Seller-facing truth
- `apps/web/src/app/products/[id]/page.tsx`
- `apps/web/src/app/catalog/products/page.tsx`
- `apps/web/src/app/actions.ts`
- `apps/web/src/lib/api.ts`

### Phase F: Validation
- new backend Flipkart integration tests
- new web Flipkart UI tests

## 10. Validation Commands

Existing suites to preserve:
- `npm run lint`
- `npm run build`
- `npm run test:integration:connector-mapping-lifecycle`
- `node apps/api/test/integration/connector-mapping-precedence.test.cjs`
- `node apps/api/test/integration/connector-mapping-rollback.test.cjs`
- `node apps/api/test/integration/connector-mapping-step-up.test.cjs`
- `npm run test:integration:metrics-kpi-trends`
- `npm run test:integration:marketplace-capability-ui-gating`
- `npm run test:integration:connector-action-matrix-ui-gating`
- `node apps/web/test/integration/mapping-canonical-ui.test.cjs`
- `node apps/web/test/integration/mapping-structured-editor.test.cjs`
- `node apps/web/test/integration/mapping-step-up-ui.test.cjs`
- `node apps/web/test/integration/product-detail-workflow-ui.test.cjs`

New Flipkart-specific suites to add:
- `apps/api/test/integration/flipkart-installation.test.cjs`
- `apps/api/test/integration/flipkart-taxonomy.test.cjs`
- `apps/api/test/integration/flipkart-publish-readiness.test.cjs`
- `apps/api/test/integration/flipkart-publish-job.test.cjs`
- `apps/api/test/integration/flipkart-idempotency.test.cjs`
- `apps/web/test/integration/flipkart-product-detail-ui.test.cjs`
- `apps/web/test/integration/flipkart-mapping-ui.test.cjs`
- `apps/web/test/integration/flipkart-failure-visibility.test.cjs`

## 11. Definition of Done

Flipkart v1 is complete only if:
1. Flipkart installs through the current connector installation flow
2. credentials validate and persist securely
3. taxonomy snapshot is loaded and searchable
4. mapping lifecycle works for Flipkart category scope
5. publish-readiness blocks invalid products
6. one product can be published through the job engine
7. one failed publish shows actionable seller-facing reason
8. retry/requeue works without duplicate submission
9. product UI truthfully says `Publish to Flipkart`
10. all listed validation suites pass

## 12. Open External Dependency

Real provider validation is deferred until Flipkart sandbox credentials are configured in UI.

That does not block implementation.
It only blocks final provider-backed validation evidence.
