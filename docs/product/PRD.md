# PIM1 Product Requirements Document (PRD)

- Product: PIM1
- Version: 1.0 (March 2026 consolidation)
- Owner: Product + Engineering
- Status: Active baseline

## 1. Product Summary
PIM1 is an India-first, multi-tenant Product Information Management platform with a connector-first integration architecture. Core catalog and compliance live in PIM1; marketplace-specific execution lives in connectors (Amazon, Flipkart, Meesho, ONDC later).

## 2. Problem Statement
Sellers and catalog teams currently manage fragmented product data across spreadsheets and channel-specific portals. This causes:
- High rejection rates due to missing required fields and channel-specific constraints.
- Slow onboarding and error-prone bulk updates.
- Weak visibility into readiness and operational risk.
- Rework caused by coupling core catalog logic with channel-specific behavior.

## 3. Product Goals
- Establish catalog as source of truth with tenant-safe operations.
- Provide reliable compliance and channel readiness signals before publish.
- Enable fast bulk import/edit with traceability and row-level repair.
- Isolate channel integrations through a connector contract for extensibility.
- Support launch operations with clear increment gates and evidence-driven checks.

## 4. Users and Roles
- Admin: taxonomy, compliance, and platform controls.
- Editor: day-to-day catalog operations and workflow updates.
- Viewer: read-only visibility and monitoring.
- Marketplace Ops: connector setup, readiness checks, publish/export management.

## 5. Scope
### In scope
- Product, category, variant catalog operations.
- Compliance validation (GST/HSN and required fields).
- Channel readiness simulation and structured issue normalization.
- Bulk import templates, jobs, retries, DLQ and row repair.
- Bulk edit with preview and operation history.
- Connector installation, credentialing, export/publish orchestration.

### Out of scope (current cycle)
- OMS/order lifecycle replacement.
- Full DAM intelligence automation beyond defined INC-03/INC-05 scope.
- AI-led autonomous optimization as a launch dependency.

## 6. Architecture Principles
- Connector-first boundary: core domain and integration domain are separated by interface contract.
- Tenant safety first: no cross-tenant data access under any route or background job.
- Idempotent external operations: retries must not create duplicate submissions.
- Structured errors end-to-end: issues remain machine-usable for analytics and repair UX.
- Evidence gates over assumptions: increment progression requires passing gate checks.

## 7. Functional Requirements
- FR-001: Products page is primary operational surface with tabbed navigation.
- FR-002: Triage status must combine compliance issues and per-channel blocking/warning outcomes.
- FR-003: Create Product flow uses explicit labels and category-driven structured attributes.
- FR-004: Seller-facing forms never expose raw JSON attribute entry.
- FR-005: Bulk Import supports CSV/XLSX/JSON, mapping templates, retries, row repair, and error export.
- FR-006: Bulk Edit supports scoped filtering, preview, apply, and immutable operation history.
- FR-007: Categories are visible to all authorized roles; category creation is admin-only.
- FR-008: Internal developer/internal links are isolated from seller-first workflows.
- FR-009: Connector orchestration branches by connector capability (publish vs export-only).
- FR-010: Connector submissions retain payload snapshots with size cap and overflow storage link.
- FR-011: Dashboard readiness, catalog health, and usage endpoints provide cached aggregate views.

## 8. Non-Functional Requirements
- NFR-001: All tenant-scoped reads/writes include tenant filters and pass isolation gate tests.
- NFR-002: JWT auth with revocation/blocklist support and role-enforced access control.
- NFR-003: Encryption service supports key versioning and rotation.
- NFR-004: Queue workers enforce backpressure and connector-specific rate limits.
- NFR-005: Web/API list endpoints are paginated (cursor-based defaults and limits).
- NFR-006: Startup fails fast on invalid/missing required environment variables.
- NFR-007: Staging is mandatory for increment gate sign-off from INC-05 onward.

## 9. Connector Contract Requirements
- CR-001: Idempotency key must be stable per logical operation (`{jobId}:PUBLISH` pattern).
- CR-002: Webhook dedupe uniqueness is scoped per installation/account, not global event id.
- CR-003: `normaliseError` returns structured `ConnectorIssue` (not plain string).
- CR-004: Capability checks are runtime-based (`installation.capabilities.includes(...)`).
- CR-005: Export-only connectors complete via explicit export return path.
- CR-006: Connector mapping lifecycle is tenant-scoped and versioned with `draft -> validated -> published -> superseded -> archived`.
- CR-007: Public mapping writes support only `tenant_connector_default` and `tenant_connector_category_mapping`; connector default templates remain internal system defaults in the current cycle.
- CR-008: Category alignment is modeled through mapping `categoryScope` plus taxonomy search/unmapped flows, not a separate category-mapping subsystem in the current cycle.
- CR-009: Export job creation must hard-block on publish readiness, including connector installation/capability, credential status, required attribute mappings, fallback acknowledgement, and product scope checks.
- CR-010: Connector discovery is hybrid in the current cycle: database definitions activate only statically compiled runtime connectors; manifest/plugin discovery is future scope.

## 10. Data Governance and Compliance
- DG-001: Raw payload fields require explicit retention, redaction, and purge policy.
- DG-002: Sensitive credential/token values are never logged or stored in audit metadata.
- DG-003: Test data is hidden by default in seller views and isolated from production workflows.
- DG-004: Pre-growth compliance tasks include consent records, export, and erasure APIs.

## 11. Milestones and Increments
- INC-01 + INC-02: Catalog/compliance/intelligence/bulk operations foundations complete.
- INC-03 + INC-05: Connector foundation, media baseline, installation, publish/export worker hardening.
- INC-06 + INC-07: Rejection intelligence confidence modeling and workflow maturation.
- INC-08+: ONDC architecture and adapter path after connector baseline stabilizes.

## 12. Gate Criteria (Execution-Control)
- Mandatory lint/build/test gates per increment with evidence artifacts.
- Staging run metadata required for sign-off: environment, tenantId, date, gitTag, runUrl.
- Named integration suites for idempotency, webhook dedupe, isolation, and notification safety.

## 13. Success Metrics
- Readiness accuracy: triage numbers match row-level compliance + channel state.
- Operational throughput: bulk workflows handle benchmark volumes within target latency.
- Rejection reduction: lower channel reject rate after readiness correction and repair flow.
- Reliability: retry paths do not create duplicate channel submissions.
- Connector phase expansion metrics such as mapping completion rate, first publish success rate, setup time to first publish, and blocker resolution rate remain planned instrumentation, not current launch-gate metrics.

## 14. Risks and Mitigations
- Risk: connector API/schema drift.
- Mitigation: connector boundary, versioned contract, heartbeat and readiness checks.

- Risk: data leakage/cross-tenant reads.
- Mitigation: tenant-scoping extensions, CI RLS checks, isolation tests.

- Risk: stale templates for export-only channels.
- Mitigation: template hash verification and scheduled validation scripts.

## 15. Release Readiness
PIM1 is ready for controlled progression when increment gates pass on staging with documented evidence. Broad production rollout requires closure of remaining security/ops/compliance blockers and connector operational readiness.

## 16. Source Inputs Used
This PRD is consolidated from imported March 2026 architecture/execution documents, redesign notes, UI review, and in-repo product scope/backlog artifacts.
