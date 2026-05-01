---
title: Vexa PIM Engineering Delivery Plan
status: proposed
owner: Product + CTO
last_updated: 2026-05-01
---

# Vexa PIM Engineering Delivery Plan - 2026-05-01

## 1. Purpose

Convert the current repo-backed CTO/PO review into an execution-ready delivery plan with:

- release gates
- epics
- tickets
- owner lanes
- explicit file scope
- acceptance criteria
- validation evidence

This plan is grounded in the current checked-in repo state. It is not a rebuild proposal.

## 2. Current Product Truth

### What is already real

The current repository already contains a substantial working PIM platform with:

- product and variant workflow
- category and attribute management
- validation and completeness scoring
- import with row repair and dead-letter handling
- connector mappings with lifecycle controls
- submission/export jobs
- audit, users, API keys, outbound webhooks, and notifications
- queue-backed operations

### What is not yet true

The current repo should not be positioned as:

- enterprise-ready
- multi-market SaaS ready
- connector-uniform
- full DAM/workflow collaboration complete

### Delivery interpretation

The right move is targeted hardening around the current architecture, not redesign.

## 3. Release Decision Split

The release decision must be split into two tracks.

### Track A - Controlled India-market rollout

Status: conditional

### Track B - Enterprise multi-market SaaS positioning

Status: blocked

## 4. Release Gate Summary

| Release target | Status | Meaning |
|---|---|---|
| Internal demo | ready | Current implementation is sufficient for internal demo use. |
| QA / staging | ready | Current implementation is sufficient for validation and staging operations. |
| Pilot with test data | ready | Current implementation supports controlled pilot rehearsal with test data. |
| Controlled India-market pilot with real data | conditional | Requires Sprint 1 gate completion. |
| Broad production rollout | conditional | Requires Sprint 1 and Sprint 2 gate completion plus selected Sprint 3 hardening. |
| Enterprise / multi-market SaaS rollout | blocked | Requires identity, RBAC, localization, workflow, and data-model expansion. |

## 5. Release Gates

### Gate A - Controlled India-market pilot

This gate must pass before real customer pilot rollout.

| Gate ID | Gate | Owner | Status | Acceptance evidence |
|---|---|---|---|---|
| RG-A1 | Fix mapping step-up security contract drift | Security/Auth Lead | completed on current branch | mapping step-up integration test passes and API/docs align |
| RG-A2 | Separate connector maturity labels across UI and docs | Connector Platform Lead | completed on current branch | live/manual/experimental labels visible and truthful |
| RG-A3 | Add connector installation/account selector in mapping workbench | Channel Mapping Lead | completed on current branch | operator can identify connector account/store being mapped and readiness evaluates the selected installation context |
| RG-A4 | Add fallback acknowledgement UX and persistence | Channel Mapping Lead | completed on current branch | required fallback acknowledgement is visible and stateful |
| RG-A5 | Tie readiness evaluation to exact mapping version ID | Channel Mapping Lead | completed on current branch | readiness output names the evaluated version |
| RG-A6 | Show top mapping blockers inline without hidden dependency | Product UX Lead | completed on current branch | operator can see why publish is blocked immediately |

### Gate B - Broad production rollout

This gate must pass before broad production claims.

| Gate ID | Gate | Owner | Status | Acceptance evidence |
|---|---|---|---|---|
| RG-B1 | Show active/promoted mapping version banner | Channel Mapping Lead | completed on current branch | active version is visible on mapping workbench |
| RG-B2 | Add PIM field sample value preview in mapping table | Channel Mapping Lead | completed on current branch | sample source values visible during mapping |
| RG-B3 | Expose mapping lifecycle audit metadata | Platform Governance Lead | completed on current branch | save/validate/publish/archive/rollback actor + timestamp visible |
| RG-B4 | Show connector health and payload preview in blocked states | Connector Platform Lead | completed on current branch | blocked state includes health context and payload preview path |
| RG-B5 | Improve product detail readiness header and terminology | Product UX Lead | completed on current branch | product page shows blocker summary and uses publish/export terms consistently |
| RG-B6 | Replace raw-JSON-first bulk edit with structured operator flow | Catalog Operations Lead | completed on current branch | default bulk-edit experience is structured and preview-first |
| RG-B7 | Add first-class media governance | Catalog Operations Lead | completed on current branch | main image, order, alt text, and asset health are explicit |
| RG-B8 | Expand operational notifications and alert coverage | Platform Operations Lead | open | critical failures raise in-app notifications with deep links |

### Gate C - Enterprise SaaS positioning

This gate is required before enterprise-ready positioning.

| Gate ID | Gate | Owner | Status | Acceptance evidence |
|---|---|---|---|---|
| RG-C1 | Add SSO / MFA / SAML roadmap foundation | Identity Platform Lead | open | tenant-level auth policy and first enterprise auth path exist |
| RG-C2 | Expand RBAC and delegated access model | Identity Platform Lead | open | scoped role model supports category/brand/channel boundaries |
| RG-C3 | Add localization and multi-currency data model | Catalog Platform Lead | open | locale/market/currency-aware product and pricing model exists |
| RG-C4 | Add product relationships / bundles / kits | Catalog Platform Lead | open | relationship model is UI/API/schema-backed |
| RG-C5 | Add workflow collaboration and SLA model | Workflow Platform Lead | open | assignee/comments/change request/SLA flows exist |
| RG-C6 | Add enterprise-scale search architecture | Platform Architecture Lead | open | large-catalog search path is defined and validated |

## 6. Delivery Guardrails

Execution must respect repo guardrails already in force:

- do not rebuild completed work without regression proof
- do not reopen locked increments casually
- every ticket must define explicit file scope
- no silent behavior removal without equivalent replacement and test proof

This plan itself does not reopen locked stories. It defines forward work based on validated gaps and release posture.

## 7. Ownership Model

| Owner lane | Responsibility |
|---|---|
| Product UX Lead | operator clarity, blocker visibility, terminology, guided workflows |
| Security/Auth Lead | step-up contract, auth policy, MFA/SSO foundation |
| Channel Mapping Lead | mapping workbench, readiness/version/fallback flows |
| Connector Platform Lead | connector maturity truth, health, payload preview, connector capabilities |
| Catalog Operations Lead | bulk edit safety, media governance, duplicate governance |
| Platform Governance Lead | audit metadata, admin contract consistency |
| Platform Operations Lead | notifications, rate limits, queue and observability behavior |
| Catalog Platform Lead | localization, currency, relationships, schema expansion |
| Platform Architecture Lead | search scalability and enterprise architecture decisions |
| Workflow Platform Lead | assignment, comments, SLA, escalation |

## 8. Sprint Plan Overview

| Sprint | Goal | Release impact |
|---|---|---|
| Sprint 1 | Release safety and mapping trust | required for controlled India-market pilot |
| Sprint 2 | Operator confidence and publish clarity | required for broad production posture |
| Sprint 3 | Production hardening and governance | required for stronger operational confidence |
| Sprint 4+ | Enterprise and SaaS foundations | required for enterprise positioning |

## 9. Epic Breakdown

## Epic 1 - Release Safety And Mapping Trust

Goal: close the minimum set of gaps blocking a real customer pilot.

### Ticket E1-T1 - Normalize step-up error contract

- Priority: P0
- Owner: Security/Auth Lead
- Release gate: RG-A1
- Current status: completed on current branch
- File scope:
  - `apps/api/src/auth/step-up.guard.ts`
  - `apps/api/test/integration/connector-mapping-step-up.test.cjs`
  - `apps/web/src/lib/channel-mappings.ts`
  - `docs/openapi.yaml`
  - `docs/openapi.json`
- Problem:
  - mapping step-up test expects `403 STEP_UP_TOKEN_SESSION_MISMATCH`
  - runtime returned `401 STEP_UP_TOKEN_INVALID`
- Required behavior:
  - invalid, malformed, or expired step-up token -> `401 STEP_UP_TOKEN_INVALID`
  - valid step-up token bound to wrong session/user/tenant -> `403 STEP_UP_TOKEN_SESSION_MISMATCH`
  - valid token with wrong protected scope/action -> `403 STEP_UP_SCOPE_MISMATCH`
- Acceptance criteria:
  - `connector-mapping-step-up.test.cjs` passes
  - frontend shows correct recovery guidance for each denial type
  - audit logs preserve denial reason
  - generated API docs match actual status codes and payloads
- Validation:
  - `node apps/api/test/integration/connector-mapping-step-up.test.cjs`
  - `rg -n "STEP_UP_TOKEN_INVALID|STEP_UP_TOKEN_SESSION_MISMATCH|STEP_UP_SCOPE_MISMATCH" docs/openapi.yaml docs/openapi.json`

### Ticket E1-T2 - Add connector maturity truth labels

- Priority: P0
- Owner: Connector Platform Lead
- Release gate: RG-A2
- Current status: completed on current branch
- File scope:
  - `apps/web/src/app/connectors/page.tsx`
  - `apps/web/src/app/connectors/setup/page.tsx`
  - `apps/web/src/app/channels/connectors/[installationId]/page.tsx`
  - `apps/api/src/connector-framework/connector-launch-policy.ts`
  - `docs/connectors/README.md`
- Problem:
  - live connectors, manual connectors, and experimental connectors must not appear equivalent
- Required labels:
  - `Live publish`
  - `Export/manual`
  - `Beta`
  - `Experimental`
  - `Disabled`
- Acceptance criteria:
  - Meesho is never shown as equivalent to live publish connectors
  - ONDC is explicitly marked experimental/admin-only/non-production
  - connector cards show supported operations such as validate, publish, webhook, retry
  - docs and UI use the same maturity labels
- Validation:
  - route-level screenshots or UI proof for connectors surfaces
  - `rg -n "Live publish|Export/manual|Experimental|Beta|Disabled" apps/web docs/connectors`

### Ticket E1-T3 - Add mapping connector account selector

- Priority: P0
- Owner: Channel Mapping Lead
- Release gate: RG-A3
- Current status: completed on current branch
- File scope:
  - `apps/web/src/app/channels/mappings/page.tsx`
  - `apps/web/src/components/channel/*`
  - `apps/web/src/lib/api/*`
  - `apps/api/src/connector-installer/connector-installer.controller.ts`
  - `apps/api/src/marketplace/*`
- Problem:
  - operators need to know which connector installation/account/store the mapping applies to
- Acceptance criteria:
  - mapping screen exposes connector installation/account selector where relevant
  - current connector context is visible in header/state
  - mapping actions preserve selected installation context
  - readiness and preview are evaluated against the chosen connector context
- Current branch note:
  - UI preserves `installationId` through the legacy handoff route, exposes a connector-account selector in mapping scope, and shows the selected account/store in the workflow header and context card.
  - Publish readiness and preflight now accept `installationId` and report the evaluated installation context, so the selected connector account drives the gate result instead of only the connector slug default.
- Validation:
  - UI contract proof on `/channels/mappings`
  - focused integration tests for selected connector account behavior
  - installation-aware publish readiness API integration test

### Ticket E1-T4 - Add fallback acknowledgement UX and persistence

- Priority: P0
- Owner: Channel Mapping Lead
- Release gate: RG-A4
- Current status: completed on current branch
- File scope:
  - `apps/web/src/app/channels/mappings/page.tsx`
  - `apps/web/src/components/channel/*`
  - `apps/api/src/marketplace/connector-mapping.service.ts`
- Problem:
  - fallback acknowledgement exists in backend behavior but needs explicit operator acknowledgment and persistence
- Acceptance criteria:
  - required fallback acknowledgement is visible before protected action
  - acknowledgement state persists per draft/version as intended
  - readiness and publish flows surface missing acknowledgement clearly
- Current branch note:
  - Mapping preflight/readiness now consume the active fallback acknowledgement state.
  - Version history exposes version-scoped save/clear acknowledgement controls and blocks publish until acknowledgement is present when required.
  - Readiness copy now explains fallback blockers in operator language instead of raw backend codes.
- Validation:
  - mapping lifecycle UI proof
  - API contract proof for fallback acknowledgment fields

### Ticket E1-T5 - Bind readiness to exact mapping version

- Priority: P0
- Owner: Channel Mapping Lead
- Release gate: RG-A5
- Current status: completed on current branch
- File scope:
  - `apps/web/src/app/channels/mappings/page.tsx`
  - `apps/web/src/components/channel/version-manager*`
  - `apps/api/src/marketplace/connector-mapping.service.ts`
- Problem:
  - readiness evaluation must state exactly which version was evaluated
- Acceptance criteria:
  - readiness card names the evaluated version ID/state
  - stale readiness cannot be confused with current draft state
  - publish decision path names version under review
- Current branch note:
  - Readiness now names the exact published mapping version IDs being evaluated and explicitly distinguishes them from unsaved draft state.
  - When no published mapping exists for the scope, the readiness card explains that the gate is falling back to the system or tenant default path instead.
- Validation:
  - UI proof in mapping workbench
  - version/readiness integration test coverage

### Ticket E1-T6 - Show top blockers inline in mapping workbench

- Priority: P0
- Owner: Product UX Lead
- Release gate: RG-A6
- Current status: completed on current branch
- File scope:
  - `apps/web/src/app/channels/mappings/page.tsx`
  - `apps/web/src/components/channel/*`
- Problem:
  - publish blockers are too hidden and require expansion
- Acceptance criteria:
  - top blockers are visible above the fold
  - each blocker links to exact fix area where possible
  - protected actions explain why unavailable
- Current branch note:
  - The mapping workflow header now surfaces the top publish blockers above the fold.
  - Operators can jump directly from that summary to the readiness section, and blocker labels are translated into operator-readable copy.
- Validation:
  - UI proof in mapped/unmapped/blocked states

## Epic 2 - Operator Confidence And Publish Clarity

Goal: make the current production flows clearer and safer for operators.

### Ticket E2-T1 - Add active/promoted version banner

- Priority: P1
- Owner: Channel Mapping Lead
- Release gate: RG-B1
- Current status: completed on current branch
- File scope:
  - `apps/web/src/app/channels/mappings/page.tsx`
  - `apps/web/src/components/channel/version-manager*`
- Acceptance criteria:
  - operator can instantly identify the live/promoted version
  - current draft vs active version cannot be confused
- Current branch note:
  - Version history now shows an above-the-fold banner for the active promoted version and a clear empty-state banner when no live version exists yet.

### Ticket E2-T2 - Add PIM source value preview in mapping table

- Priority: P1
- Owner: Channel Mapping Lead
- Release gate: RG-B2
- Current status: completed on current branch
- File scope:
  - `apps/web/src/components/channel/mapping-editor.tsx`
  - `apps/api/src/marketplace/marketplace.service.ts`
- Acceptance criteria:
  - table shows sample product values from PIM source fields
  - operator can preview whether mapping is semantically correct
- Current branch note:
  - The mapping table now shows a sample-value column sourced from the selected product when present, or from a category sample product when the workbench is opened standalone.

### Ticket E2-T3 - Expose audit metadata in mapping history

- Priority: P1
- Owner: Platform Governance Lead
- Release gate: RG-B3
- Current status: completed on current branch
- File scope:
  - `apps/web/src/components/channel/version-manager*`
  - `apps/api/src/marketplace/connector-mapping.service.ts`
  - `packages/db/prisma/schema.prisma`
- Acceptance criteria:
  - history shows who saved, validated, published, archived, or rolled back
  - timestamps are visible and role-appropriate
- Current branch note:
  - Mapping version history now hydrates lifecycle event metadata from `connector_mapping_events` and surfaces actor/timestamp lines directly in the version table without a schema migration.

### Ticket E2-T4 - Show connector health and payload preview when blocked

- Priority: P1
- Owner: Connector Platform Lead
- Release gate: RG-B4
- Current status: completed on current branch
- File scope:
  - `apps/web/src/app/channels/connectors/[installationId]/page.tsx`
  - `apps/web/src/app/channels/mappings/page.tsx`
  - `apps/api/src/connector-installer/connector-installer.controller.ts`
- Acceptance criteria:
  - blocked publish state includes connector health cue
  - operator can reach payload preview directly from blocked state
- Current branch note:
  - The blocked-state readiness panel now shows connector-account health and direct links into connector health and payload-preview recovery surfaces.

### Ticket E2-T5 - Improve product readiness header and terminology

- Priority: P1
- Owner: Product UX Lead
- Release gate: RG-B5
- Current status: completed on current branch
- File scope:
  - `apps/web/src/app/products/[id]/page.tsx`
  - `apps/web/src/app/products/[id]/_components/*`
- Problem:
  - product detail still uses generic `Submit` action and hides important publish blockers too deeply
- Acceptance criteria:
  - product header shows product readiness, mapping readiness, media readiness, connector readiness, approval status, and last publish attempt
  - disabled publish action explains why
  - terminology uses `Publish` or `Export` consistently, not generic `Submit`
- Current branch note:
  - The product header now uses publish/export wording, surfaces six top-level readiness cards, and exposes blocker recovery links for quality, channels, media, connector setup, and approval follow-up.

## Epic 3 - Production Hardening And Governance

Goal: reduce operator error and strengthen operational recovery.

### Ticket E3-T1 - Replace raw-JSON-first bulk edit with structured builder

- Priority: P1
- Owner: Catalog Operations Lead
- Release gate: RG-B6
- Current status: completed on current branch
- File scope:
  - `apps/web/src/app/operations/bulk-edit/page.tsx`
  - `apps/web/src/components/bulk-edit/*`
  - `apps/api/src/bulk-edit/*`
- Acceptance criteria:
  - default flow uses structured field picker and operation selector
  - advanced JSON mode is secondary
  - preview shows affected count and before/after values
  - validation runs before apply
- Current branch note:
  - Bulk edit now defaults to a structured field-and-operation builder with generated payload preview, while raw JSON remains available only inside an advanced disclosure path.

### Ticket E3-T2 - Add first-class media governance

- Priority: P1
- Owner: Catalog Operations Lead
- Release gate: RG-B7
- Current status: completed on current branch
- File scope:
  - `packages/db/prisma/schema.prisma`
  - `apps/api/src/media/*`
  - `apps/web/src/app/media/page.tsx`
  - `apps/web/src/app/products/[id]/_components/media-tab.tsx`
- Required model additions:
  - `altText`
  - `isMain`
  - `sortOrder`
  - `assetHealthStatus`
  - `lastCheckedAt`
  - `channelEligibility`
  - `usageCount`
- Acceptance criteria:
  - operator can choose main image
  - gallery order is explicit
  - missing alt text can be surfaced as warning
  - broken or ineligible assets are visible before publish
- Current branch note:
  - Media assets now expose governance controls for alt text, main image, order, channel eligibility, and persisted asset-health feedback, with validation warnings surfacing missing alt text and ineligible-channel usage.

### Ticket E3-T3 - Expand notifications and operational alerts

- Priority: P1
- Owner: Platform Operations Lead
- Release gate: RG-B8
- File scope:
  - `apps/api/src/notifications/*`
  - `apps/api/src/outbound-webhooks/*`
  - `apps/web/src/components/nav/notification-center.tsx`
  - `apps/api/src/notifications/notification-event.types.ts`
- Required events:
  - `connector_down`
  - `connector_credentials_expired`
  - `publish_failed`
  - `scheduled_export_failed`
  - `import_repair_required`
  - `readiness_blocker_detected`
  - `mapping_validation_failed`
  - `queue_dlq_threshold_exceeded`
- Acceptance criteria:
  - in-app notification exists for critical operator failures
  - notifications deep-link to exact job/product/connector
  - severity levels are clear

### Ticket E3-T4 - Add duplicate and identifier governance

- Priority: P1
- Owner: Catalog Operations Lead
- File scope:
  - `packages/db/prisma/schema.prisma`
  - `apps/api/src/compliance/*`
  - `apps/api/src/bulk-import/*`
  - `apps/api/src/catalog/*`
  - `apps/web/src/app/quality/*`
- Required checks:
  - duplicate SKU
  - duplicate barcode / GTIN
  - invalid GTIN format
  - missing barcode where required
  - duplicate title within brand/category where applicable
  - variant SKU collision
- Acceptance criteria:
  - validation issues are created for duplicate identifiers
  - imports detect duplicates before commit where feasible
  - quality dashboard can report duplicate issues

### Ticket E3-T5 - Add broader API rate limiting

- Priority: P2
- Owner: Platform Operations Lead
- File scope:
  - `apps/api/src/auth/*`
  - `apps/api/src/bulk-import/*`
  - `apps/api/src/bulk-edit/*`
  - `apps/api/src/marketplace/*`
  - `apps/api/src/connector-framework/*`
  - `apps/api/src/admin/*`
  - `docs/architecture/security-threat-model.md`
- Acceptance criteria:
  - limits are tenant-aware and principal-aware
  - throttled responses are consistent `429`
  - abuse events are observable
  - internal workers are not accidentally throttled

### Ticket E3-T6 - Improve search scalability path

- Priority: P2
- Owner: Platform Architecture Lead
- File scope:
  - `apps/api/src/catalog/catalog.service.ts`
  - `packages/db/prisma/schema.prisma`
  - performance test assets under `apps/api/test/` or `scripts/`
- Acceptance criteria:
  - near-term indexing/query improvements are defined and implemented
  - large-catalog search test exists
  - future search architecture decision is documented

## Epic 4 - Enterprise Identity And Access

Goal: establish the minimum identity and RBAC foundation for enterprise deals.

### Ticket E4-T1 - Add MFA foundation

- Priority: P2
- Owner: Security/Auth Lead
- Release gate: RG-C1
- File scope:
  - `apps/api/src/auth/*`
  - `apps/web/src/app/login*`
  - `apps/web/src/components/auth/*`
- Acceptance criteria:
  - tenant-level auth policy exists
  - MFA challenge and recovery flow exist
  - security audit events are emitted

### Ticket E4-T2 - Add OIDC / SAML roadmap foundation

- Priority: P2
- Owner: Identity Platform Lead
- Release gate: RG-C1
- File scope:
  - auth modules
  - workspace/admin auth settings surfaces
  - docs
- Acceptance criteria:
  - tenant can be configured for external identity mode
  - enterprise auth direction is code-backed, not doc-only

### Ticket E4-T3 - Expand RBAC and delegated access

- Priority: P2
- Owner: Identity Platform Lead
- Release gate: RG-C2
- File scope:
  - `packages/db/prisma/schema.prisma`
  - `apps/api/src/common/access-policy/*`
  - `apps/api/src/workspace-users/*`
  - `apps/web/src/app/admin/users/page.tsx`
- Target personas:
  - Catalog Admin
  - Content Editor
  - Category Manager
  - Media Manager
  - Approver
  - Channel Manager
  - Connector Admin
  - Auditor
  - Read-only Client
- Acceptance criteria:
  - publish permission is separable from edit permission
  - connector credentials access is restricted
  - scoped access supports category/brand/channel boundaries

## Epic 5 - Enterprise Catalog Model

Goal: expand the core catalog model for multi-market and enterprise workflows.

### Ticket E5-T1 - Add localization and multi-currency model

- Priority: P2
- Owner: Catalog Platform Lead
- Release gate: RG-C3
- File scope:
  - `packages/db/prisma/schema.prisma`
  - catalog/media/marketplace services
  - product/category UI surfaces
- Required entities:
  - `ProductTranslation`
  - `AttributeTranslation`
  - `CategoryTranslation`
  - `LocalizedMedia`
  - `PriceList`
  - `Currency`
  - `Market`
- Acceptance criteria:
  - product values can vary by locale/market
  - publish path can target market-aware values
  - prices can vary by market/currency

### Ticket E5-T2 - Add product relationships, bundles, and kits

- Priority: P2
- Owner: Catalog Platform Lead
- Release gate: RG-C4
- File scope:
  - schema
  - catalog APIs
  - product detail UI
  - marketplace export path where supported
- Required entities:
  - `ProductRelationship`
  - `Bundle`
  - `BundleItem`
  - `KitComponent`
  - `ReplacementProduct`
  - `AccessoryProduct`
- Acceptance criteria:
  - operator can define relationship type
  - relationships can be channel-aware where required

### Ticket E5-T3 - Add workflow collaboration and SLA model

- Priority: P2
- Owner: Workflow Platform Lead
- Release gate: RG-C5
- File scope:
  - schema
  - quality/workflow APIs
  - product and issue UI
- Required entities:
  - `Task`
  - `Assignee`
  - `CommentThread`
  - `Mention`
  - `ChangeRequest`
  - `SLA`
  - `Escalation`
- Acceptance criteria:
  - products or issues can be assigned
  - approvers can request changes
  - overdue work is visible on dashboard

## 10. Execution Order

### Sprint 1 - Release safety

Execute in order:

1. `E1-T1` Normalize step-up error contract
2. `E1-T2` Add connector maturity truth labels
3. `E1-T3` Add mapping connector account selector
4. `E1-T4` Add fallback acknowledgement UX and persistence
5. `E1-T5` Bind readiness to exact mapping version
6. `E1-T6` Show top blockers inline

### Sprint 2 - Operator confidence

Execute in order:

1. `E2-T1` Active/promoted version banner
2. `E2-T2` PIM source value preview
3. `E2-T3` Mapping audit metadata
4. `E2-T4` Connector health and payload preview
5. `E2-T5` Product readiness header and terminology

### Sprint 3 - Production hardening

Execute in order:

1. `E3-T1` Structured bulk edit
2. `E3-T2` Media governance
3. `E3-T4` Duplicate governance
4. `E3-T3` Expanded notifications
5. `E3-T5` Broader rate limiting
6. `E3-T6` Search scalability path

### Sprint 4+ - Enterprise roadmap

Execute in order:

1. `E4-T1` MFA foundation
2. `E4-T2` OIDC / SAML foundation
3. `E4-T3` Expanded RBAC and delegated access
4. `E5-T1` Localization and multi-currency
5. `E5-T2` Relationships / bundles / kits
6. `E5-T3` Workflow collaboration

## 11. Release Criteria By Milestone

### Controlled India-market pilot may proceed when

- Gate A is complete
- connector claims are truthful
- mapping workbench clearly identifies account/version/blockers
- fallback acknowledgement works end to end

### Broad production rollout may proceed when

- Gate A and Gate B are complete
- product readiness is visible at product detail level
- bulk edit is safe by default
- media governance is upgraded
- key operational notifications exist

### Enterprise SaaS positioning may proceed when

- Gate C is complete
- enterprise identity and access are real
- enterprise catalog model is real
- workflow collaboration is real
- search architecture supports enterprise-scale catalogs

## 12. Non-Goals For This Plan

This plan does not recommend:

- rebuilding the catalog architecture
- replacing the connector framework
- rewriting the web shell
- reopening locked completed increments without regression proof

## 13. Final CTO / PO Position

```text
Do not rebuild the current PIM.
Close the release-safety and operator-trust gaps first.
Use the current architecture as the base for production hardening.
Treat enterprise SaaS as a separate capability track, not as an immediate release claim.
```
