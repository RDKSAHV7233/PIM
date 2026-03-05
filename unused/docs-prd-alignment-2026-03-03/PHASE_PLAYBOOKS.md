# Phase Playbooks (Phase 1 to Phase 8)

This file is the execution blueprint for each phase after Phase 0.

## Phase 1 - Core Catalog Engine
Objective:
- Build a stable source of truth for products, SKUs, variants, and categories.

In scope:
- SKU model and lifecycle
- Product CRUD API
- Variant family model
- Taxonomy management
- Basic UI for list/create/edit
- RBAC and audit baseline

Definition of done:
- CRUD reliability validated in test and staging
- SKU uniqueness and variant collision checks active
- Catalog usable from UI and API by pilot users

KPIs:
- Product create/update success rate
- API p95 latency for catalog operations
- Pilot task completion rate

Risks:
- Schema churn due to unresolved canonical model
- Weak concurrent edit handling

Exit artifacts:
- API contract doc
- Data dictionary
- Test report and release note

## Phase 2 - Compliance and Attribute Intelligence
Objective:
- Detect compliance issues before export/publish.

In scope:
- Dynamic attribute engine
- Category-required field logic
- GST/HSN fields and rules
- Regulatory validation rules
- Consolidated validation panel

Definition of done:
- Category-driven field rendering works
- Validation runs at save and pre-export
- Errors and warnings are actionable

KPIs:
- Compliance issues detected pre-export
- Time to resolve validation errors

Risks:
- Rule ambiguity and legal interpretation drift
- Category rule explosion

Exit artifacts:
- Rule catalog
- Validation UX walkthrough
- Compliance test matrix

## Phase 3 - Marketplace Intelligence
Objective:
- Reduce predictable marketplace rejections.

In scope:
- Adapter framework
- Amazon/Flipkart mapping packs
- Basic Meesho mapping pack
- Channel validation engine
- Rule-based rejection simulator

Definition of done:
- Channel export-readiness status visible
- Common rejection causes detected before submission
- Mapping templates reusable by category/channel

KPIs:
- Pre-submission failure catch rate
- Rejection reduction in pilot

Risks:
- Frequent schema updates by channels
- Mapping debt from special-case logic

Exit artifacts:
- Adapter contract and tests
- Mapping coverage report
- Pilot rejection comparison

## Phase 4 - Bulk Operations
Objective:
- Enable high-volume catalog onboarding and corrections.

In scope:
- Excel/CSV upload
- Auto mapping suggestions
- Chunked import pipeline
- Bulk edits
- Error repair grid and retry flow

Definition of done:
- 1,000 SKU import jobs complete within target SLA
- Row-level errors are repairable in-product
- Repeat imports supported with templates

KPIs:
- Import throughput
- Import failure rate
- Repair cycle time

Risks:
- Large-file memory pressure
- Dirty source data from sellers

Exit artifacts:
- Import SLA report
- Error taxonomy
- MVP release decision memo

## Phase 5 - DAM and Media Validation
Objective:
- Prevent media-driven listing failures.

In scope:
- Media upload and storage
- Metadata extraction
- Channel media validation

Definition of done:
- Product-media linkage stable
- Media checks run automatically with clear outcomes

KPIs:
- Image-related rejection trend
- Media validation pass rate

Risks:
- Storage cost expansion
- Slow processing for high-volume uploads

Exit artifacts:
- Media schema and lifecycle guide
- Channel media rule matrix

## Phase 6 - Rejection Intelligence
Objective:
- Prioritize corrections using risk scoring and guided fixes.

In scope:
- Rejection risk score
- Heuristic predictor
- Fix suggestions

Definition of done:
- Explainable risk scoring in UI
- Suggestions available for top failure modes

KPIs:
- High-risk fix conversion rate
- Reduction in repeat rejection patterns

Risks:
- Low trust if scoring is opaque
- Overfitting heuristics to narrow pilot data

Exit artifacts:
- Scoring specification
- Guidance effectiveness report

## Phase 7 - ONDC Native Expansion
Objective:
- Add robust ONDC compatibility and version resilience.

In scope:
- ONDC schema depth
- Node-specific mapping behavior
- Discovery metadata support
- Version handling

Definition of done:
- ONDC validation passes for target partner flows
- Version mismatch handling visible and safe

KPIs:
- ONDC export success rate
- Version issue incidence

Risks:
- Protocol evolution pace
- Fragmented node behavior

Exit artifacts:
- ONDC compatibility matrix
- Version policy document

## Phase 8 - AI Optimization
Objective:
- Improve catalog quality and speed through assistive automation.

In scope:
- AI title optimization
- AI attribute enrichment
- Smart categorization
- Catalog repair automation

Definition of done:
- AI suggestions gated by user approval
- Confidence and explainability surfaced
- Rollback path available for automated repairs

KPIs:
- Suggestion acceptance rate
- Manual effort reduction
- Catalog quality score improvement

Risks:
- Hallucinated suggestions
- Inconsistent gains across categories

Exit artifacts:
- AI governance policy
- Model evaluation and safety report
