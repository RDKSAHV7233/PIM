# Vexa PIM Connector Developer Guide

Status: Active developer-facing connector guide  
Date: 2026-03-23  
Audience: Connector engineers integrating with the current Vexa PIM platform

## 1. Start Here

Use this guide if you need to:
- understand the connector API surface
- integrate a channel with current Vexa PIM mapping/readiness behavior
- choose the right connector flow for export-only vs publish-capable channels
- understand step-up re-authentication on high-risk mapping actions

This guide is intentionally API-first and task-first.
It is the main day-to-day connector guide and should answer normal implementation
questions without forcing you into another doc first.

Use the deeper docs only when you specifically need them:
- repo implementation details and ownership surfaces:
  `docs/connectors/VEXA_PIM_CONNECTOR_INTERNAL_IMPLEMENTATION_GUIDE.md`
- recipe-style worked examples:
  `docs/connectors/VEXA_PIM_CONNECTOR_RECIPES.md`
- rollout/gate truth:
  `docs/execution/INCREMENT_STATE.json`

## 2. Connector Model at a Glance

Current Vexa PIM connector behavior:
- connectors run inside a hybrid compiled registry
- mapping lifecycle is versioned
- publish-readiness is evaluated before high-risk actions
- rollback is supported
- high-risk mapping actions require step-up re-authentication

Current connector truths:
- canonical editable mapping path is `/channels/mappings`
- legacy `/connectors/[installationId]/mapping` is transition-only
- runtime discovery is hybrid, not plugin-dynamic
- broad rollout evidence is still incomplete under `INC-08`

### Current connector matrix

Use this as the current implementation-level reality check before you design a flow:

- `flipkart`
  - implementation status: `full`
  - capabilities: `PUBLISH`, `VALIDATE`, `STATUS_SYNC`
  - current role: reference implementation for a live publish-capable connector
- `amazon-in`
  - implementation status: `full`
  - declared capabilities: `PUBLISH`, `VALIDATE`, `STATUS_SYNC`, `WEBHOOK_RECEIVE`
  - current role: live Amazon India connector path with seller install, credential validation, publish, and status sync
- `meesho`
  - implementation status: `partial`
  - capabilities: `VALIDATE`, `EXCEL_EXPORT`
  - current role: export-only connector model, but export generation is not yet complete
- `ondc`
  - current role: separate admin and non-production workflow, feature-gated behind `FEATURE_ONDC_ENABLED`
  - do not treat it as a normal seller-facing marketplace connector flow

## 3. Choose the Right Connector Flow

### Export-only connector

Use this model when a channel produces an export artifact instead of direct publish confirmation.

Expected shape:
1. prepare mapping
2. run publish-readiness
3. create export job
4. process/export artifact
5. expose status to the user as export, not publish

The current real example is:
- `meesho`

### Publish-capable connector

Use this model when a channel supports direct submission/publish attempts.

Expected shape:
1. prepare mapping
2. run publish-readiness
3. create publish/export job
4. process queued work
5. surface completed or failed status with a visible reason

The current real example is:
- `flipkart`

### What every connector flow must get right

Regardless of connector type:
- capability checks must be truthful
- readiness blockers must appear before the high-risk action
- export-only flows must never be labeled `Publish`
- failed jobs must show an actionable reason, not only a generic status
- `/channels/mappings` remains the editable mapping surface

## 4. API Conventions

### Base path

Current API base path:
- `/api/v1`

### Authentication

Normal authenticated requests use Bearer auth.

High-risk mapping actions also require:
- `x-pim-step-up-token`

Current step-up endpoint:
- `POST /api/v1/auth/step-up`

Do not describe this as MFA.
The correct term is:
- `step-up re-authentication`

### Source of truth order

When documentation and code disagree, trust this order:
1. `docs/product/PRD.md`
2. `docs/execution/INCREMENT_STATE.json`
3. current code
4. generated supporting docs

## 5. Core API Surface

### Mapping lifecycle

- `GET /api/v1/marketplace/connectors/{connectorSlug}/mappings/versions`
- `POST /api/v1/marketplace/connectors/{connectorSlug}/mappings/versions`
- `POST /api/v1/marketplace/connectors/{connectorSlug}/mappings/versions/{versionId}/validate`
- `POST /api/v1/marketplace/connectors/{connectorSlug}/mappings/versions/{versionId}/publish`
- `POST /api/v1/marketplace/connectors/{connectorSlug}/mappings/versions/{versionId}/rollback`
- `POST /api/v1/marketplace/connectors/{connectorSlug}/mappings/versions/{versionId}/archive`

### Mapping evaluation

- `GET /api/v1/marketplace/connectors/{connectorSlug}/mappings/resolve`
- `POST /api/v1/marketplace/connectors/{connectorSlug}/mappings/preflight`
- `POST /api/v1/marketplace/connectors/{connectorSlug}/publish-readiness`

### Taxonomy support

- `GET /api/v1/marketplace/connectors/{connectorSlug}/taxonomy/search`
- `GET /api/v1/marketplace/connectors/{connectorSlug}/taxonomy/unmapped`

### Export / publish jobs

- `POST /api/v1/marketplace/products/{id}/export-jobs`
- `GET /api/v1/marketplace/export-jobs`
- `GET /api/v1/marketplace/export-jobs/{id}`
- `POST /api/v1/marketplace/export-jobs/{id}/process`
- `POST /api/v1/marketplace/export-jobs/{id}/requeue`

### Capability gating rule

Current runtime behavior:
- if an installation does not include `PUBLISH`, publish attempts must not proceed
- export-only connectors should still use the job pipeline, but the user-facing action/result must stay export-oriented
- `STATUS_SYNC` is optional and only applies where the connector can genuinely poll or sync upstream submission state

Use:
- `docs/openapi.yaml`
- `docs/openapi.json`

for the latest generated request/response shapes.

## 6. Mapping Lifecycle Rules

Current lifecycle:

`draft -> validated -> published -> superseded -> archived`

Operational rules:
- one published mapping per `(tenant, connector, categoryScope)`
- rollback creates a new published clone from an earlier valid version
- archive is explicit
- readiness checks can block publish flows

Current seller-facing meaning:
- `draft` = not live
- `published` = live mapping
- `superseded` = replaced by a newer live mapping
- `archived` = retained for history, no longer active

## 7. Step-Up Re-Authentication

Protected mapping actions:
- publish mapping version
- rollback mapping version
- archive mapping version

Expected developer flow:
1. obtain normal bearer token
2. request `POST /api/v1/auth/step-up`
3. use returned step-up token in `x-pim-step-up-token`
4. perform protected mapping action

This is bounded privileged-action re-confirmation.
It is not a general MFA platform.

## 8. Connector UX Expectations

Vexa PIM is product-first.

Connector UX should support:
- product readiness correction
- structured mapping changes
- truthful publish vs export labeling
- diagnostics as secondary surfaces

Connector UX should avoid:
- exposing internal runtime language as the primary user vocabulary
- reintroducing legacy template-first mapping workflows
- showing `Publish` on export-only flows

Canonical mapping UX:
- `/channels/mappings`

## 9. Quickstart Paths

### Path A: Add or adjust mapping

1. Open `/channels/mappings`
2. Create or edit a draft mapping version
3. Validate the mapping
4. Review publish-readiness
5. Step up if publishing/archive/rollback is required
6. Publish the mapping version

### Path B: Handle a failed or incorrect live mapping

1. List mapping versions
2. Identify the prior known-good version
3. Request step-up re-authentication
4. Roll back via the rollback endpoint
5. Re-run publish-readiness if needed

### Path C: Work on taxonomy/category alignment

1. Search channel taxonomy
2. Review unmapped categories
3. update category-scoped mapping
4. validate and publish when ready

### Path D: Add or review a connector flow safely

1. Confirm the connector's real `implementationStatus`
2. Confirm whether it is publish-capable or export-only
3. Make sure the UI action label matches that capability
4. Check that readiness blockers surface before the job is created
5. Check failure and retry behavior in the job result surface
6. Validate that the connector does not bypass step-up on protected mapping actions

## 10. What Is Not Current Capability

Do not plan against these as live features:
- plugin-style connector discovery
- arbitrary third-party runtime loading
- hot-loaded manifest runtime
- legacy template manager as the primary mapping editor
- MFA terminology for the current step-up implementation

## 11. Validation Checklist

After connector-facing doc or contract changes, verify:
- `npm run openapi:generate`
- `python scripts/generate_page_action_playbooks.py`
- relevant API tests for mapping lifecycle, rollback, step-up, and capability gating
- relevant web tests for mapping path, step-up UI, and structured editor
- `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"`

For connector implementation changes, also verify:
- capability-specific behavior still matches the connector's declared capabilities
- export-only flows still say `Export` in UI copy and result states
- publish-capable flows still surface actionable failure reasons
- connector status in docs still matches code reality

## 12. Release Reality

Connector functionality is materially implemented.
Broad rollout is still not complete.

Current open release item:
- `INC-08` / `RISK-P0-001`

Latest checked-in execution truth:
- snapshot `2026-03-22T05-34-42.984Z_CONTROLLED_ROLLOUT_SNAPSHOT.json`
- `consecutiveE10SignoffRuns = 0`
- `controlledRollout.pending` still contains `Need at least 2 consecutive E10 gate signoff artifacts.`
- broad rollout evidence: `7 / 14` days
- SLO trend evidence: `7 / 14` days

That means:
- internal and controlled connector work can proceed
- broad production readiness still depends on operational gate evidence

## 13. Historical Notes

Older external connector artifacts are historical only:
- `VEXA_PIM_connector_plan_review_2026-03-04.docx`
- `VEXA_PIM_CONNECTOR_DEVELOPER_GUIDE_FINAL_2026-03-06.pdf`

They predate:
- mapping lifecycle completion
- rollback support
- step-up re-authentication
- canonical `/channels/mappings` guidance

## 14. Deep Dive Docs

Use these when you need more depth than the main guide:
- internal implementation detail and code ownership surfaces:
  `docs/connectors/VEXA_PIM_CONNECTOR_INTERNAL_IMPLEMENTATION_GUIDE.md`
- worked workflow examples and recipe-style sequences:
  `docs/connectors/VEXA_PIM_CONNECTOR_RECIPES.md`

You should not need to open them for ordinary connector onboarding or basic
API-flow understanding. They are supporting deep dives, not the primary entry
point.
