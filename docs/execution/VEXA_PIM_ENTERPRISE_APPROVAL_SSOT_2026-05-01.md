---
title: Vexa PIM Enterprise Approval SSOT
status: proposed
owner: Product + CTO
last_updated: 2026-05-01
---

# Vexa PIM Enterprise Approval SSOT - 2026-05-01

## 1. Purpose

Convert the repo-backed CTO/PO review into one approved enterprise roadmap that:

- starts from current Vexa truth
- separates controlled rollout from enterprise positioning
- defines phased delivery gates
- keeps customer claims aligned with shipped evidence

This is an expansion plan, not a rebuild plan.

## 2. Current Truth

### What Vexa already has

The current repository already proves meaningful product and platform foundations:

- product and variant workflow
- category, taxonomy, and mapping workbench flows
- media governance, validation, and completeness
- import repair, export/submission lifecycle, and queue-backed jobs
- audit, roles, delegated access foundations, notifications, and admin controls
- BullMQ/Redis-backed operational architecture

### What Vexa does not yet have

The current repo does not yet prove enterprise approval for:

- first-class tenant SSO / OIDC / SAML
- first-class MFA platform
- true locale/market/currency-aware catalog model
- product relationships / bundles / kits
- mature collaboration workflow with tasking and SLA
- packaged enterprise scale proof

### Current release posture

As of 2026-05-01, the honest release posture remains:

- Internal demo: Ready
- QA/staging: Ready
- Pilot with test data: Ready
- Controlled real-customer rollout: Conditional
- Broad production rollout: Blocked
- Enterprise / multi-market SaaS: Blocked

Important note:

- the staging outage tied to missing credential-encryption environment variables was recovered
- the latest healthy rollout snapshot still shows `broadPending = ["Controlled rollout observation window covers 13 of 14 required days."]`
- Phase 0 must reconcile launch-governance docs and live evidence to the newest truth before any stronger production claim

## 3. Strategic Framing

Vexa is not missing enterprise because it is immature.

Vexa is missing enterprise because the next enterprise layer has not been productized yet.

That means:

- do not redesign the core platform
- do not weaken working rollout controls
- do not market roadmap items as current functionality

## 4. Commercial Approval Ladder

Vexa should use two enterprise levels instead of one.

### Level A - Enterprise Baseline

This is the earliest serious enterprise-selling posture.

Required:

- Phase 0 complete
- Phase 1 complete
- Phase 2 complete
- Phase 5 lite complete

Safe claim:

> Vexa supports enterprise identity controls and multi-market catalog operations, with bounded scale evidence.

### Level B - Full Enterprise Approval

This is the stronger enterprise-ready posture.

Required:

- Phase 0 complete
- Phase 1 complete
- Phase 2 complete
- Phase 3 complete
- Phase 4 complete
- Phase 5 full complete

Safe claim:

> Vexa supports enterprise identity, multi-market catalog operations, relationship modeling, collaboration workflows, and packaged scale evidence.

Do not use "enterprise-ready" externally until Level B is complete and evidence-backed.

## 5. Delivery Sequence

Recommended order:

1. Phase 0 - Launch Truth
2. Phase 1 - Enterprise Identity and Access
3. Phase 2 - Enterprise Catalog Model
4. Phase 5 lite - Scale and SLO proof in parallel
5. Phase 3 - Relationships / Bundles / Kits
6. Phase 4 - Collaboration Workflow
7. Phase 5 full - enterprise proof packaging

Why this order:

- Identity is the first procurement blocker
- Localized catalog is the first business-operations blocker
- Relationship and workflow depth matter after identity and market readiness

## 6. Phase 0 - Launch Truth

### Goal

Reconcile current release-governance docs and live evidence to the latest repo and staging truth.

### Required outcomes

- broad-rollout evidence reaches `14/14`
- canonical release docs reference the latest valid snapshot, not stale ones
- connector maturity claims remain honest
- enterprise roadmap is explicitly described as future-phase work

### Gate: PH0-G1

Pass conditions:

- latest rollout snapshot has `health.ok = true`
- latest rollout snapshot has `controlledPending = []`
- latest rollout snapshot has `broadPending = []`
- current-state and readiness rollup docs are refreshed to match the latest snapshot

### Safe claim after Phase 0

> Vexa is suitable for controlled rollout and bounded production expansion. Enterprise capabilities remain roadmap items.

## 7. Phase 1 - Enterprise Identity and Access

### Goal

Pass the first real enterprise security review.

### What is already present

- step-up re-authentication for high-risk actions
- tenant-aware access policy foundations
- admin/user governance and audit

### What must be added

- tenant-level auth policy
- MFA foundation
- OIDC external identity mode
- delegated-access expansion for publish, credential, and admin boundaries

### Explicit product rules

- OIDC is required in this phase
- SAML is optional follow-up driven by target-account demand
- SCIM is not a Phase 1 requirement
- step-up must remain, but must not be marketed as MFA

### Gate: PH1-G1

Pass conditions:

- tenant auth policy exists and is enforced
- MFA enrollment and enforcement work
- at least one real OIDC provider is tested successfully
- delegated access can independently separate edit, publish, connector-admin, and audit-sensitive operations
- auth and access changes are audited

### Safe claim after Phase 1

> Vexa supports enterprise identity baseline controls including OIDC SSO, MFA enforcement, and fine-grained delegated access.

Do not claim:

- full SAML coverage unless actually implemented
- external audit completion unless one has actually been performed

## 8. Phase 2 - Enterprise Catalog Model

### Goal

Make Vexa truly multi-market without duplicating whole products.

### What must be added

- locale/market-aware product values
- currency-aware prices
- localized content and category labels
- market-aware import/export/publish resolution

### Required domain additions

- `Market`
- `Currency`
- `PriceList`
- `ProductTranslation`
- `AttributeTranslation`
- `CategoryTranslation`
- localized media support as needed

### Gate: PH2-G1

Pass conditions:

- product data can vary by locale/market
- prices can vary by market/currency
- validation can run per market/channel context
- import/export/publish paths resolve market-aware values correctly
- existing products remain backward compatible

### Safe claim after Phase 2

> Vexa supports multi-market catalog operations with localized content and market-aware pricing.

## 9. Phase 3 - Relationships / Bundles / Kits

### Goal

Support enterprise merchandising and assortment modeling.

### Required capabilities

- generic typed product relationships
- bundle and kit structures
- channel-aware relationship applicability
- safe export behavior for unsupported channels

### Gate: PH3-G1

Pass conditions:

- operators can create and manage typed relationships
- bundle and kit pricing/inventory rules are deterministic
- export paths include only supported relationship semantics
- relationship changes are auditable

### Safe claim after Phase 3

> Vexa supports product relationships, bundles, and kits with governed export behavior.

## 10. Phase 4 - Collaboration Workflow Expansion

### Goal

Expand Vexa from approval-oriented workflow into team collaboration workflow.

### What already exists

- approval states
- decision notes
- notifications

### What must be added

- task assignment
- comment threads
- change requests
- SLA visibility
- escalation paths

### Gate: PH4-G1

Pass conditions:

- products or issues can be assigned
- approvers can request changes in product
- comments and mentions are visible and persisted
- overdue work is visible on dashboard and queue views
- SLA and escalation behavior are test-confirmed

### Safe claim after Phase 4

> Vexa supports collaborative product operations with assignment, change requests, comments, and overdue-work visibility.

## 11. Phase 5 - Enterprise Proof Packaging

### Goal

Make enterprise claims evidence-backed instead of assumption-backed.

### Important rule

Performance numbers must be treated as:

1. internal benchmark targets
2. validated benchmark results
3. externally marketable claims

Those are not the same thing.

### Phase 5 lite

Required for Enterprise Baseline:

- benchmark scenarios defined
- large-catalog test dataset exists
- core latency and throughput results documented internally
- operational SLO draft exists

### Phase 5 full

Required for Full Enterprise Approval:

- repeatable benchmark evidence is current
- runbooks are complete
- monitoring and alert definitions are documented
- security/compliance evidence pack exists
- disaster-recovery posture is documented

### Gate: PH5-G1

Pass conditions:

- benchmark suite is repeatable
- results are captured with date, environment, and commit context
- SLO/SLA language is documented and approved internally
- enterprise operations evidence is packaged for review

### Safe claim after Phase 5 full

> Vexa has packaged benchmark, availability, and operational evidence for enterprise review.

Do not claim numeric SLA or catalog-scale guarantees externally until measured and approved.

## 12. Go-To-Market Rules

### Green claims now

- controlled-rollout PIM
- mapping/readiness/governance-heavy platform
- queue-backed marketplace operations
- connector-specific rollout with honest maturity labeling

### Yellow claims after Phase 1

- enterprise identity baseline
- OIDC SSO
- MFA enforcement
- delegated access boundaries

### Yellow claims after Phase 2

- multi-market catalog support
- localized content and pricing

### Red claims until later phases complete

- enterprise-ready
- full enterprise workflow suite
- enterprise-scale proven
- complete federated identity stack
- full relationship and assortment modeling

## 13. Decision Framework

### Commit to the full enterprise program if:

- enterprise ACV and procurement-led deals are strategic
- target customers need identity review, multi-market readiness, and team workflow
- engineering capacity can support a multi-month expansion lane

### Stop after Enterprise Baseline if:

- the business only needs enterprise security and multi-market credibility
- relationship and collaboration depth are not immediate deal blockers

## 14. Final CTO/PO Recommendation

Recommended next moves:

1. finish Phase 0 honestly
2. start Phase 1 immediately
3. start Phase 5 lite in parallel with Phase 1 or Phase 2
4. commit to Phase 2 before using any multi-market language externally
5. sequence Phase 3 before Phase 4

This is the approved strategic direction:

- no rebuild
- no inflated enterprise claims
- no weakening of current rollout safety controls
- phase-based enterprise expansion with evidence gates

## 15. Source References

Primary repo-backed references for this SSOT:

- `docs/execution/CURRENT_STATE.md`
- `docs/execution/VEXA_PIM_ENGINEERING_DELIVERY_PLAN_2026-05-01.md`
- `docs/execution/VEXA_PIM_ENTERPRISE_DELEGATED_ACCESS_REPORT_2026-04-25.md`
- `packages/db/prisma/schema.prisma`
- `apps/api/src/auth/*`
- `apps/api/src/common/access-policy/*`
- `apps/api/src/queue/queue.service.ts`
