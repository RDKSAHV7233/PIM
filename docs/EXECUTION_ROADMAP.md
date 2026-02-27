# Execution Roadmap (Phase-by-Phase)

## Objective
Execute the India-first PIM from validation to growth with clear phase gates, measurable exits, and minimal rework.

## Delivery Model
- Cadence: 2-week sprints
- Release pattern: end of each phase gate
- MVP release gate: end of Phase 4
- Status tracking: weekly governance and phase-end review

## Planned Timeline (Baseline)
- Phase 0: Weeks 1-3
- Phase 1: Weeks 4-7
- Phase 2: Weeks 8-10
- Phase 3: Weeks 11-14
- Phase 4: Weeks 15-18
- MVP hardening: Weeks 19-20
- Phase 5: Weeks 21-23
- Phase 6: Weeks 24-26
- Phase 7: Weeks 27-29
- Phase 8: Weeks 30-33

## Phase Gates

### Gate 0 -> 1 (Validation Complete)
Entry:
- Scope and backlog drafted
- Interview targets identified
Exit:
- 20-30 interviews complete
- ICP and pricing signals documented
- MVP scope signed off
- Canonical model and architecture decisions approved
Deliverables:
- `phase-0/PHASE0_KIT.md` completed

### Gate 1 -> 2 (Core Catalog Stable)
Entry:
- Phase 0 sign-off
Exit:
- Product CRUD, SKU master, variants, taxonomy live
- Basic UI and API functioning
- RBAC and audit baseline active

### Gate 2 -> 3 (Compliance Engine Stable)
Exit:
- Dynamic attributes operational
- GST/HSN and compliance validation active at save/export
- Validation panel usable for operators

### Gate 3 -> 4 (Marketplace Intelligence Stable)
Exit:
- Amazon and Flipkart mappings usable
- Basic Meesho mapping usable
- Channel validation and rejection simulator active

### Gate 4 -> MVP Release
Exit:
- Excel/CSV import for 1,000 SKU jobs stable
- Bulk edit and error repair UI active
- Pilot users complete real workflows successfully

### Post-MVP Gates (5 to 8)
Exit:
- Phase 5: Media validation reduces image-based errors
- Phase 6: Risk score and fix suggestions operational
- Phase 7: ONDC depth and version handling stable
- Phase 8: AI optimization features productionized

## Dependency Chain
1. Canonical schema finalization -> required for all downstream phases.
2. Compliance model -> required before reliable channel mapping.
3. Channel validation -> required before rejection intelligence.
4. Bulk operations -> required for scale adoption and MVP monetization.
5. Media validation -> required for full rejection prevention coverage.

## Non-Negotiable Engineering Baselines
- Tenant-safe data isolation
- Audit logging on critical actions
- Structured validation error model
- Contract tests for adapters and imports
- Observability for async jobs and integration failures

## Risk Controls
- Channel schema volatility:
  - Maintain versioned mapping packs and contract tests.
- Compliance drift:
  - Monthly legal/rule refresh cycle.
- Data quality variance from seller files:
  - Strict import validation with repair workflow.
- Scope creep:
  - No Phase 5+ work before MVP gate approval.

## Immediate Work Queue (Next 10 Business Days)
1. Run Phase 0 interviews and compile evidence.
2. Finalize canonical model and architecture ADRs.
3. Freeze MVP scope and publish acceptance criteria.
4. Create Sprint 1 board from Phase 1 stories.
