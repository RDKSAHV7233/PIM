# India-First PIM - Product Backlog (v1.0)

## Backlog Conventions
- Priority:
  - `P0` = must-have for MVP
  - `P1` = should-have after MVP stabilization
  - `P2` = growth/optimization
- Story format: `As a <user>, I want <capability>, so that <outcome>.`
- MVP boundary: End of Phase 4

## Phase 0 - Foundation and Validation

### Epic P0-E1: ICP and Problem Validation (`P0`)
Story P0-US-001:
As a product team, I want a structured interview script and respondent mix, so that discovery data is comparable across seller types.
Acceptance criteria:
- Interview guide includes workflow, rejection, compliance, and pricing sections.
- Respondent mix covers at least 3 seller segments (small, mid, aggregator).
- Target marketplaces include Amazon, Flipkart, and at least one additional channel.

Story P0-US-002:
As a product manager, I want 20-30 completed interviews, so that we can quantify pain severity.
Acceptance criteria:
- Minimum 20 completed calls with notes stored in a shared repository.
- Top 5 pain points are ranked by frequency and severity.
- Rejection-related pain appears with quantified impact (time or money lost).

Story P0-US-003:
As a founder, I want willingness-to-pay signals, so that pricing can be anchored to real demand.
Acceptance criteria:
- At least 3 pricing tiers tested (monthly INR plans).
- At least 5 prospects indicate acceptable price range.
- Findings include objections and expected ROI narratives.

### Epic P0-E2: Workflow Validation and MVP Definition (`P0`)
Story P0-US-004:
As a seller, I want wireframes for core workflows, so that I can validate usability before build.
Acceptance criteria:
- Wireframes cover catalog create/edit, bulk upload, compliance checks, and channel mapping.
- Clickable prototype exists for at least 3 end-to-end journeys.
- Feedback captured from at least 5 target users.

Story P0-US-005:
As a product owner, I want an MVP feature list with exclusions, so that scope remains controlled.
Acceptance criteria:
- Features tagged `in MVP` or `out of MVP`.
- MVP aligns to Phase 1-4 only.
- Stakeholder sign-off captured.

### Epic P0-E3: Technical Direction (`P0`)
Story P0-US-006:
As an engineering lead, I want a canonical product data model draft, so that future modules share one schema.
Acceptance criteria:
- Core entities include product, SKU, variant, category, attributes, media.
- Required and optional fields documented.
- Versioning approach for schema changes documented.

Story P0-US-007:
As an engineering lead, I want architecture and build-vs-buy ADRs, so that implementation starts with clear constraints.
Acceptance criteria:
- ADRs produced for storage, search, queueing, and media stack.
- Integration approach for marketplace adapters documented.
- Non-functional targets defined (performance, reliability, security baseline).

## Phase 1 - Core Catalog Engine

### Epic P1-E1: Catalog Domain Model (`P0`)
Story P1-US-001:
As a catalog manager, I want a SKU master model, so that each sellable unit is uniquely tracked.
Acceptance criteria:
- SKU uniqueness enforced within tenant scope.
- SKU status lifecycle defined (draft, active, archived).
- Audit fields (`created_at`, `updated_at`, `created_by`) available.

Story P1-US-002:
As a catalog manager, I want variant grouping, so that size/color families are managed together.
Acceptance criteria:
- Parent-child product structure supported.
- Variant dimensions are configurable.
- Variant combination collisions are prevented.

Story P1-US-003:
As a catalog manager, I want category taxonomy management, so that products can be organized consistently.
Acceptance criteria:
- Category tree supports parent-child hierarchy.
- Category assignment is mandatory for publish-ready status.
- Category changes are version-tracked.

### Epic P1-E2: Product CRUD API (`P0`)
Story P1-US-004:
As an internal integrator, I want secure product CRUD APIs, so that UI and external tools can manage catalog records.
Acceptance criteria:
- Endpoints for create/read/update/delete are available.
- Validation errors return structured field-level responses.
- API contract documented with examples.

Story P1-US-005:
As a user, I want safe concurrent edits, so that data is not accidentally overwritten.
Acceptance criteria:
- Optimistic locking or version check supported on update.
- Conflicting updates return deterministic error.
- Conflict path is surfaced to UI.

### Epic P1-E3: Basic Catalog UI (`P0`)
Story P1-US-006:
As an operator, I want product list and filters, so that I can quickly find records.
Acceptance criteria:
- List supports search by SKU, title, category, status.
- Pagination and sorting supported.
- Empty and error states are implemented.

Story P1-US-007:
As an operator, I want product create/edit forms, so that I can maintain catalog data without API use.
Acceptance criteria:
- Required fields enforced in UI.
- Inline validation messages shown before submit.
- Save draft and publish-ready states available.

## Phase 2 - Compliance and Attribute Intelligence

### Epic P2-E1: Dynamic Attribute Engine (`P0`)
Story P2-US-001:
As a catalog operator, I want category-specific required attributes, so that records satisfy downstream channel requirements.
Acceptance criteria:
- Attribute definitions are category-bound.
- Required/optional logic is configurable.
- UI dynamically renders relevant fields for selected category.

Story P2-US-002:
As a product admin, I want reusable attribute sets, so that common rules are managed centrally.
Acceptance criteria:
- Attribute sets can be cloned and versioned.
- Effective dates support controlled rollout.
- Breaking changes are blocked without migration path.

### Epic P2-E2: GST/HSN and Regulatory Validation (`P0`)
Story P2-US-003:
As a seller, I want GST and HSN fields validated, so that tax compliance errors are reduced.
Acceptance criteria:
- GST and HSN fields available in data model and UI.
- Format and basic rule checks implemented.
- Errors are shown at field and summary level.

Story P2-US-004:
As a compliance manager, I want rule-based regulatory checks, so that non-compliant listings are flagged early.
Acceptance criteria:
- Rule framework supports severity levels (error/warning).
- Rules run on save and on pre-export checks.
- Rule results include clear remediation guidance.

### Epic P2-E3: Validation UX (`P0`)
Story P2-US-005:
As an operator, I want a consolidated validation panel, so that I can fix issues quickly.
Acceptance criteria:
- All product issues appear in one panel with field anchors.
- Filters available by severity and channel relevance.
- Validation state refreshes after field edits.

## Phase 3 - Marketplace Intelligence Layer

### Epic P3-E1: Channel Adapter Framework (`P0`)
Story P3-US-001:
As an engineering team, I want a pluggable channel adapter interface, so that marketplace integrations are maintainable.
Acceptance criteria:
- Standard adapter contract defined (schema, rules, export payload).
- Channel adapters are independently deployable/configurable.
- Contract test harness exists for adapters.

### Epic P3-E2: Initial Marketplace Mapping Packs (`P0`)
Story P3-US-002:
As a seller, I want Amazon field mapping, so that my catalog can be prepared for Amazon submission.
Acceptance criteria:
- Core Amazon attributes mapped from canonical schema.
- Unmapped required fields are surfaced clearly.
- Mapping templates can be saved per category.

Story P3-US-003:
As a seller, I want Flipkart field mapping, so that I can prepare compliant listings for Flipkart.
Acceptance criteria:
- Core Flipkart attributes mapped from canonical schema.
- Channel-specific constraints supported.
- Validation output identifies missing/invalid fields.

Story P3-US-004:
As a seller, I want basic Meesho support, so that small-seller channels are covered.
Acceptance criteria:
- Basic required field mapping available.
- Export-ready status shown after validation pass.
- Unsupported fields are explicitly marked.

### Epic P3-E3: Channel Validation and Rejection Simulation (`P0`)
Story P3-US-005:
As a seller, I want channel-specific pre-checks, so that I can avoid predictable rejections.
Acceptance criteria:
- Validation engine runs channel rule sets.
- Results identify likely rejection reasons.
- Pass/fail summary visible before export.

Story P3-US-006:
As an operator, I want a rejection simulator view, so that I understand risk before listing.
Acceptance criteria:
- Simulator shows top failing rules per channel.
- Suggested corrections linked to fields.
- Simulation can be rerun after fixes.

## Phase 4 - Bulk Operations (India Critical)

### Epic P4-E1: Excel/CSV Import Pipeline (`P0`)
Story P4-US-001:
As a seller, I want to upload Excel/CSV files, so that I can onboard large catalogs quickly.
Acceptance criteria:
- `.xlsx`, `.xls`, `.csv` file types accepted.
- Upload parsing handles at least 1,000 SKUs per job.
- Import jobs are asynchronous with progress status.

Story P4-US-002:
As an operator, I want chunked processing and retry handling, so that large imports remain stable.
Acceptance criteria:
- Job processes in chunks with checkpoint tracking.
- Failed chunks are retryable without duplicating successful rows.
- Processing metrics are captured (time, success, failure counts).

### Epic P4-E2: Smart Mapping and Templates (`P0`)
Story P4-US-003:
As a seller, I want auto-suggested column mapping, so that setup time is reduced.
Acceptance criteria:
- System suggests mappings by header similarity and prior usage.
- Confidence score shown for each suggestion.
- User can override mappings before processing.

Story P4-US-004:
As a recurring seller, I want saved import templates, so that repeat uploads are fast.
Acceptance criteria:
- Template save/load per tenant supported.
- Template versioning maintained.
- Template compatibility warnings shown when schema changes.

### Epic P4-E3: Bulk Edit and Error Repair (`P0`)
Story P4-US-005:
As an operator, I want bulk edit actions, so that I can correct many SKUs at once.
Acceptance criteria:
- Bulk update supports selected fields across filtered products.
- Preview confirms affected records before apply.
- Change history is logged for rollback analysis.

Story P4-US-006:
As an operator, I want row-level error repair UI, so that failed imports can be fixed efficiently.
Acceptance criteria:
- Error grid shows row, column, and reason.
- Inline correction + revalidate + reprocess workflow available.
- Export of error report supported.

## Phase 5 - DAM and Media Validation

### Epic P5-E1: Media Asset Management (`P1`)
Story P5-US-001:
As a catalog operator, I want image uploads linked to products, so that listings include required media.
Acceptance criteria:
- Multiple images per product/variant supported.
- Storage path and metadata persisted.
- Duplicate detection by checksum available.

Story P5-US-002:
As a catalog operator, I want media metadata extraction, so that quality checks can run automatically.
Acceptance criteria:
- Width, height, format, size extracted on upload.
- Metadata available in UI and API.
- Corrupt files are rejected with clear error.

### Epic P5-E2: Channel Media Rules (`P1`)
Story P5-US-003:
As a seller, I want channel-specific media validation, so that image-based rejections drop.
Acceptance criteria:
- Rule checks include resolution, aspect ratio, and format.
- Validation references target channel rule set.
- Media status is visible in publish readiness view.

## Phase 6 - Rejection Prevention and Intelligence

### Epic P6-E1: Risk Scoring (`P1`)
Story P6-US-001:
As a seller, I want a rejection risk score per product/channel, so that I can prioritize fixes.
Acceptance criteria:
- Score range and interpretation are documented.
- Score updates after data or rules change.
- High-risk records are filterable in UI.

Story P6-US-002:
As a product analyst, I want heuristic rule weighting, so that score quality improves with observed outcomes.
Acceptance criteria:
- Heuristic weights are configurable.
- Historical outcome feedback can adjust weights.
- Score components are explainable.

### Epic P6-E2: Guided Remediation (`P1`)
Story P6-US-003:
As an operator, I want fix suggestions tied to validation failures, so that correction time decreases.
Acceptance criteria:
- Suggestions map to failing rule and field.
- One-click navigation to affected field exists.
- Suggestion acceptance outcomes are tracked.

## Phase 7 - ONDC Native Expansion

### Epic P7-E1: ONDC Protocol Coverage (`P1`)
Story P7-US-001:
As an ONDC-focused seller, I want ONDC schema and metadata support, so that my catalog is network-compatible.
Acceptance criteria:
- ONDC-relevant fields added to canonical mapping layer.
- Required discovery metadata can be populated.
- Validation checks ONDC completeness before export.

### Epic P7-E2: Version and Node Handling (`P1`)
Story P7-US-002:
As an integration admin, I want version-aware ONDC mappings, so that protocol changes do not break operations.
Acceptance criteria:
- Mapping packs support protocol version selection.
- Backward compatibility behavior is documented.
- Version mismatch alerts are surfaced pre-export.

## Phase 8 - AI Optimization Layer

### Epic P8-E1: AI Content Optimization (`P2`)
Story P8-US-001:
As a seller, I want AI-assisted title optimization, so that listings are clearer and more discoverable.
Acceptance criteria:
- User can generate alternative titles from product context.
- Output enforces channel constraints (length/prohibited terms).
- User approval required before applying suggestions.

Story P8-US-002:
As a seller, I want AI-assisted attribute enrichment, so that incomplete catalog data can be completed faster.
Acceptance criteria:
- Missing attributes are suggested with confidence scores.
- Suggestions cite source basis (rule, history, or model inference).
- Low-confidence suggestions are flagged for manual review.

### Epic P8-E2: Smart Categorization and Repair (`P2`)
Story P8-US-003:
As an operator, I want smart category suggestions, so that products map faster to appropriate taxonomies.
Acceptance criteria:
- Top category suggestions returned with confidence.
- Operator can accept or override suggestion.
- Feedback loop captures accepted/overridden outcomes.

Story P8-US-004:
As a catalog team, I want automated catalog repair workflows, so that repeated data quality issues are resolved at scale.
Acceptance criteria:
- Batch repair rules can be executed in preview mode.
- Repair impact summary shown before apply.
- Rollback supported for automated repair runs.

## Cross-Cutting Epics

### Epic X-E1: Security and Access Control (`P0`)
Story X-US-001:
As an account admin, I want role-based access control, so that sensitive catalog actions are restricted.
Acceptance criteria:
- Roles at least include admin, editor, viewer.
- API and UI enforce permissions consistently.
- Unauthorized actions are logged.

### Epic X-E2: Observability and Auditability (`P0`)
Story X-US-002:
As an operations lead, I want audit logs for catalog and bulk changes, so that incident analysis is possible.
Acceptance criteria:
- Create/update/delete actions logged with actor and timestamp.
- Bulk operations capture job-level and row-level outcomes.
- Logs exportable for compliance review.

### Epic X-E3: Performance and Reliability (`P0`)
Story X-US-003:
As a platform owner, I want performance baselines, so that user experience remains acceptable at scale.
Acceptance criteria:
- Product list page target response time defined and measured.
- 1,000-SKU import benchmark tracked in CI or staging runs.
- Error rate and retry behavior monitored.

## Suggested Execution Order
1. Phase 0 completion + MVP sign-off
2. Phase 1 and cross-cutting `X-E1/X-E2` baseline
3. Phase 2 compliance layer
4. Phase 3 channel intelligence
5. Phase 4 bulk operations (MVP release gate)
6. Phase 5 and Phase 6
7. Phase 7 ONDC depth
8. Phase 8 AI optimization
