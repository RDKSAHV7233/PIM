# India-First PIM - Product Scope (v1.0)

## Goal
Build an India-first PIM that reduces marketplace rejections, improves catalog quality, and enables fast bulk operations for sellers.

## Principles
- De-risk early before heavy engineering
- Deliver value in layers (core -> compliance -> channel intelligence)
- Optimize for India workflows (Excel-heavy ops, GST/HSN, ONDC readiness)
- Prioritize rejection prevention and publish success rate

## Phase Plan

### Phase 0 - Foundation and Validation (Pre-Build)
Objective: Validate problem, ICP, pricing, and MVP boundaries.

Activities:
- 20-30 seller interviews
- Marketplace rejection pain validation
- ONDC catalog friction analysis
- Pricing sensitivity testing (INR tiers)
- Workflow wireframes and clickable prototype
- Usability feedback loop
- Canonical data model definition
- Architecture and build-vs-buy decisions

Exit criteria:
- MVP scope frozen
- Core workflows validated
- Early beta interest (LOIs/waitlist)

### Phase 1 - Core Catalog Engine (MVP Backbone)
Objective: Create a reliable single source of truth.

Deliverables:
- SKU master
- Product CRUD
- Variant management
- Category taxonomy
- Basic web UI + API

Exit criteria:
- Stable product entity model
- Variant logic works end to end
- Catalog manageable through UI/API

### Phase 2 - Compliance and Attribute Intelligence
Objective: Build India-specific moat on compliance correctness.

Deliverables:
- Dynamic attribute engine
- GST/HSN fields
- Compliance rule framework
- Regulatory field validations
- Validation alerting

Exit criteria:
- Category-driven dynamic attributes work
- GST/HSN issues are detected reliably
- Compliance validation available at save/export time

### Phase 3 - Marketplace Intelligence Layer
Objective: Reduce listing rejection via channel-aware mapping.

Deliverables:
- Amazon mapping (initial)
- Flipkart mapping (initial)
- Meesho mapping (basic)
- Channel mapping engine
- Channel validation layer
- Rejection simulator (rule-based)

Exit criteria:
- Products become export/publish-ready by channel
- Mapping + validation catches common failures
- Rejection risk visibility exists before submission

### Phase 4 - Bulk Operations (India Critical)
Objective: Drive adoption and scale through Excel-native workflows.

Deliverables:
- Excel/CSV import
- Smart field mapping
- Chunked processing pipeline
- Bulk edit actions
- Error repair UI

Exit criteria:
- 1,000 SKU upload stable
- Actionable row-level errors
- Fast bulk update workflows

### Phase 5 - DAM and Media Validation
Objective: Prevent image/media-driven rejections.

Deliverables:
- Media upload and storage
- Metadata extraction
- Resolution/aspect checks
- Channel-specific media rule validation

Exit criteria:
- Media linked to products correctly
- Media validations enforced and visible

### Phase 6 - Rejection Prevention and Intelligence
Objective: Add differentiated decision support.

Deliverables:
- Rejection simulator (expanded)
- Rejection risk score
- Heuristic rejection predictor
- Fix suggestions

Exit criteria:
- Risk score usable in workflow
- Top rejection patterns covered with guidance

### Phase 7 - ONDC Native Expansion
Objective: Deepen ONDC compatibility and future-proof strategy.

Deliverables:
- ONDC protocol depth
- Node-specific mapping
- Discovery metadata support
- Version compatibility handling

### Phase 8 - AI Optimization Layer (Post-MVP Growth)
Objective: Improve content quality and automation.

Deliverables:
- AI title optimization
- Auto attribute enrichment
- Smart categorization
- Catalog repair automation

## Feature-to-Phase Mapping
- Product data model, SKU/variants/taxonomy, CRUD APIs/UI -> Phase 1
- India compliance model (GST/HSN + rules) -> Phase 2
- Channel mapping/validation (Amazon/Flipkart/Meesho) -> Phase 3
- Bulk import/edit/error recovery -> Phase 4
- Media quality and channel media checks -> Phase 5
- Rejection scoring and guided fixes -> Phase 6
- ONDC native depth and versioning -> Phase 7
- AI optimization and auto-repair -> Phase 8

## MVP Boundary (Recommended)
Ship MVP at end of Phase 4:
- Why: Core catalog + compliance + channel mapping + bulk operations delivers immediate ROI and monetization potential.

## Success Metrics by Milestone
- Phase 0: interview completion, LOIs, MVP scope sign-off
- Phase 1: product create/update reliability, API/UI adoption in pilot
- Phase 2: compliance error detection rate
- Phase 3: pre-submission validation coverage, rejection reduction in pilot
- Phase 4: successful 1,000 SKU import throughput and correction cycle time

## Risks to Track
- Channel schema volatility (frequent marketplace changes)
- Compliance rule drift and legal updates
- Poor data quality from seller source files
- Over-customization per marketplace too early

## Immediate Next Step
Convert this scope into:
- Prioritized feature backlog per phase
- Sprint plan for Phase 1 (2-week sprints)
- Definition of done and test strategy per epic
