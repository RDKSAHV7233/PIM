# Vexa PIM Shopify Connector: PO Packaging and Staging Deploy Plan

Date: 2026-04-21
Owner lens: Product Owner
Status: Approved with deployment gating

## Decision Summary

1. Shopify should be included in the product roadmap and connector portfolio.
2. Shopify should be visible as a planned connector in the main connectors portfolio.
3. Shopify should not appear as a self-serve install lane in connector setup until launch stage moves from `planned` to `live`.
4. Shopify is not currently deployed to staging, so sellers and operators will not see it there yet.

## What We Verified

### Live staging current state

The live staging API currently returns only:
- `amazon-in`
- `flipkart`
- `meesho`

Shopify is not present in the live staging connector definitions response.

Validation evidence:
- Live staging API checked at `https://api-staging-490e.up.railway.app/api/v1/connectors/definitions`

### Current product behavior in code

The connector portfolio page already supports visible planned connectors:
- [page.tsx](C:/Users/Om%20Computers/PIM1/apps/web/src/app/connectors/page.tsx:352)
- [page.tsx](C:/Users/Om%20Computers/PIM1/apps/web/src/app/connectors/page.tsx:689)

The connector setup page intentionally hides non-live connectors from self-serve install:
- [page.tsx](C:/Users/Om%20Computers/PIM1/apps/web/src/app/connectors/setup/page.tsx:279)

Shopify is currently defined as planned:
- [connector-launch-policy.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/connector-framework/connector-launch-policy.ts:35)

## PO Verdict

### 1. Packaging

Approved as a dedicated Shopify slice.

The PR should include only:
- Shopify connector runtime and registration
- Shopify publication target support
- planned-launch policy enforcement
- seed migration for Shopify connector definition
- targeted Shopify integration tests
- Shopify CTO/PO implementation plan doc

The PR should not include unrelated tenant-boundary, billing, or marketplace refactor work.

### 2. Staging deployment requirement

Approved.

To make Shopify appear on staging, engineering must deploy:

1. API code containing:
   - [connector-launch-policy.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/connector-framework/connector-launch-policy.ts)
   - [connector.interface.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/connector-framework/connector.interface.ts)
   - [connector.registry.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/connector-framework/connector.registry.ts)
   - [connector-framework.module.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/connector-framework/connector-framework.module.ts)
   - [connector-installer.controller.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/connector-installer/connector-installer.controller.ts)
   - [connector-installer.service.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/connector-installer/connector-installer.service.ts)
   - [update-publication-targets.dto.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/connector-installer/dto/update-publication-targets.dto.ts)
   - [shopify.connector.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/connectors/shopify/shopify.connector.ts)

2. Database migration:
   - [migration.sql](C:/Users/Om%20Computers/PIM1/packages/db/prisma/migrations/20260420183000_seed_shopify_connector_definition/migration.sql)

3. Web deploy only if the current staging web build does not already include the portfolio planned-connectors section.
   - For portfolio visibility, the current code path already supports planned connectors.
   - For setup visibility, no web change should be made at this stage.

4. Environment variables for real Shopify auth flows when moving beyond visibility:
   - `PIM_SHOPIFY_CLIENT_ID`
   - `PIM_SHOPIFY_CLIENT_SECRET`

### 3. Visible-planned behavior

Approved with one rule:

- Shopify must be visible in the connector portfolio as roadmap/planned.
- Shopify must remain blocked from self-serve installation.

This is already the intended behavior in the current codebase.

Therefore:
- no PO-approved change is needed to make setup page show Shopify
- portfolio visibility is the correct behavior
- setup visibility would be a product mistake at this stage

## Release Acceptance Criteria

Shopify can be called "present on staging" only when all are true:

1. `GET /api/v1/connectors/definitions` on staging includes `shopify`
2. Shopify is visible in `/channels/connectors` under planned or roadmap-style presentation
3. Shopify is not offered in `/channels/connectors/setup` self-serve install lanes
4. Shopify install action remains blocked with planned-stage messaging

## Exact Validation Steps

### API validation

1. Login on staging
2. Call:

```bash
GET /api/v1/connectors/definitions
```

Expected:
- response includes `slug: "shopify"`
- `launchStage: "planned"`
- `implementationStatus: "partial"`
- `actions.install.allowed: false`

### Web validation

1. Open `/channels/connectors`
2. Confirm Shopify appears in the planned connector section
3. Open `/channels/connectors/setup`
4. Confirm Shopify does not appear as an installable self-serve connector

## PO Packaging Note

The current local worktree contains unrelated modified files. Engineering should cut the Shopify PR as an isolated slice rather than bundling it with broader in-progress backend refactors.

## Final PO Call

- Package Shopify as a dedicated slice: yes
- Deploy Shopify to staging so it becomes visible in the portfolio: yes
- Expose Shopify in self-serve setup right now: no
