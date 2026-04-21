# Vexa PIM Connector Workspace: PO + CTO Execution Plan

Status: Proposed for approval  
Date: 2026-04-21  
Audience: PO, CTO, platform engineering, connector engineering, web engineering, QA  
Scope basis: Current Vexa connector surfaces and connector runtime already present in this repo

## 0. Executive Decision

Vexa should continue evolving the current connector workspace as a **catalog-first PIM connector product**, not as a generic iPaaS clone.

Locked decisions:
- `Connections` remains the primary connector workspace.
- Connector setup remains a separate focused route, not an inline credential wall on the main portfolio page.
- `Mapping Workbench` remains the canonical channel/category mapping surface.
- Connector detail remains account-scoped and operational.
- Phase 3 is **catalog-only**:
  - products
  - variants
  - attributes
  - taxonomy/categories
  - media
  - publication targets
  - payload preview
  - readiness/issues
- Orders and customers are **out of scope** for the core Vexa connector workspace.

Reason:
- Current Vexa already behaves like a PIM connector workspace.
- The strongest product value is still central catalog authoring, channel readiness, mapping, and controlled publication.
- Pulling in OMS/CRM-style modules would expand scope and dilute the product.

## 1. Current Vexa Validation

The current codebase already supports the right product direction.

Validated web surfaces:
- `apps/web/src/app/connectors/page.tsx`
- `apps/web/src/app/connectors/setup/page.tsx`
- `apps/web/src/app/channels/connectors/[installationId]/page.tsx`
- `apps/web/src/app/channels/mappings/page.tsx`
- `apps/web/src/app/products/[id]/page.tsx`

Validated API/runtime surfaces:
- `apps/api/src/connector-framework/connector.interface.ts`
- `apps/api/src/connector-framework/connector.registry.ts`
- `apps/api/src/connector-framework/connector-framework.service.ts`
- `apps/api/src/connector-installer/connector-installer.service.ts`
- `apps/api/src/marketplace/marketplace.service.ts`
- `apps/api/src/marketplace/connector-mapping.service.ts`
- `apps/api/src/connectors/shopify/shopify.connector.ts`

PO conclusion:
- Vexa already has a connector portfolio, a setup flow, an account detail cockpit, and a mapping workbench.
- The next plan should refine and deepen these surfaces instead of introducing a second product model.

CTO conclusion:
- The connector runtime skeleton is already viable.
- The remaining work is mostly:
  - normalized health and catalog views
  - connector-specific maturity
  - clearer account detail and catalog drilldown
  - launch-stage and capability-driven UI behavior

## 2. Product Positioning

This is a **Vexa connector workspace**, not a generic integration admin panel.

What the connector workspace is for:
- connecting product channels
- validating credentials and publication targets
- managing mapping/readiness
- inspecting account-level sync health
- diagnosing catalog publication failures

What it is not for:
- order management
- customer management
- fulfillment operations
- general-purpose iPaaS workflows

PO rule:
- all connector surfaces should reinforce Vexa as the product source of truth for catalog operations.

## 3. Recommended Information Architecture

### Primary navigation
- `Connections`
- `Mappings`
- `Issues`
- `Governance`
- `Settings`

### Admin-only secondary surfaces
- `Plugin Registry`
- `Debug Tools`

Rejected IA patterns:
- `My Connections`
- `Data`
- `Users`
- `Plans`
- `Plugins`
- `Debug`

all as equal top-level navigation categories.

Reason:
- that structure reflects a generic iPaaS/admin shell, not a PIM connector product.

## 4. Final Connector Workspace Shape

## 4.1 Connections

Purpose:
- answer what is healthy, what is blocked, and what needs action next

Structure:
- summary rail
- filters/search
- connection inventory
- action shortcuts

Recommended columns:
- platforms
- connection name
- health
- sync state
- last activity
- issues
- actions

PO acceptance:
- an operator can identify the next connector to act on in under 10 seconds

CTO acceptance:
- list data comes from a normalized connection summary model, not connector-specific UI branches

## 4.2 Setup

Purpose:
- create or expand an installation in a focused task surface

Structure:
- connector selection
- account alias
- credential input
- validation result
- install action

Rules:
- no inline setup workspace on the main portfolio page
- planned connectors remain visible in the portfolio but blocked from self-serve install

PO acceptance:
- the setup flow feels like one focused task, not part of a noisy dashboard

CTO acceptance:
- secret handling stays masked, audited, and role-gated

## 4.3 Connection Detail

Purpose:
- operate one installed account

Header:
- connection name
- source to destination identity
- account alias
- health
- last sync
- primary actions

Recommended tabs:
- `Overview`
- `Credentials`
- `Catalog`
- `Mappings`
- `Issues`
- `Logs`
- `Access`

Rejected tabs:
- orders
- customers
- payment methods
- shipping methods
- stores

PO acceptance:
- account detail must be truly account-scoped and trustworthy

CTO acceptance:
- installation detail data must be keyed by installation/account identity, not only connector slug

## 4.4 Mapping Workbench

Purpose:
- define and validate channel/category mapping for catalog publication

Operator flow:
- choose scope
- build draft
- validate and publish

Current fit:
- already aligned with Vexa and should remain the canonical mapping surface

PO acceptance:
- users should not need a second mapping system inside a connector detail page

CTO acceptance:
- mapping manager remains shared infrastructure across connectors, not reimplemented per channel

## 5. Catalog-Centric Phase Plan

## Phase 1: Foundation and Portfolio Clarity

### Scope
- connector portfolio cleanup
- launch-stage visibility
- setup-route clarity
- account detail overview and health
- admin access visibility

### Deliverables
- stable `Connections` page
- stable `Setup` route
- stable account detail overview

### PO validation
- users can understand:
  - what is connected
  - what is blocked
  - where to go next

### CTO validation
- normalized connection summary contract exists
- launch-stage gating is enforced in both API and UI

## Phase 2: Credentials and Governance

### Scope
- dual-system or channel-specific credential display
- safe credential editing
- test connection
- access policy builder
- audit visibility for connector mutations

### Deliverables
- `Credentials` tab
- `Access` tab
- role-aware edit/test actions

### PO validation
- an admin can update or validate connector credentials without confusion

### CTO validation
- credentials are masked by default
- edit/test actions are permission-gated
- credential changes are audited

## Phase 3: Catalog Data Flow Modules

This is the corrected PIM-specific phase.

### Included modules
- `Products`
- `Variants`
- `Attributes`
- `Categories / Taxonomy`
- `Media`
- `Publication Targets`
- `Payload Preview`
- `Readiness / Issues`

### Conditional modules
- `Pricing`
- `Inventory`

only when the connector contract requires them as publish-critical product fields and source-of-truth policy is explicit.

### Explicitly excluded
- orders
- customers
- payment methods
- shipping methods
- stores

### Product goals
- show product publication context, not generic data mirror tables
- keep advanced system IDs secondary to seller/operator decisions
- expose payload readiness and missing-field blockers clearly

### UX rules
- product table first, raw connector payload second
- advanced IDs live in row expansion or drawer
- issue states should be readable without decoding internal schemas

### PO validation
- an operator can answer:
  - why a product is not publishable
  - which fields are missing
  - what media/variant/taxonomy blockers exist

### CTO validation
- module views use normalized catalog contracts where possible
- connector-specific field peculiarities stay behind adapter logic
- large catalog tables paginate and filter safely

## Phase 4: Publish and Recovery

### Scope
- publication target selection
- export/publish history
- rejection/failure summaries
- retry/requeue where safe
- connector issue drilldown

### Deliverables
- `Issues` tab
- `Logs` tab
- overview issue summary cards
- publish/retry recovery hooks

### PO validation
- support/operator can understand what failed and what to do next

### CTO validation
- retry actions are safe, permission-gated, and auditable
- observability serves operators first, raw logs second

## Phase 5: Connector-Specific Maturity

### Scope
- Shopify publication and metafield maturity
- connector-specific payload diagnostics
- richer readiness checks
- diff views where justified
- tenant-safe rollout and feature gating

### PO validation
- advanced connector behavior still feels like part of Vexa’s catalog workflow

### CTO validation
- connector-specific additions do not fork the base workspace architecture

## 6. Shopify-Specific Alignment

The current Shopify plan is already compatible with this execution model.

Validated from current docs:
- `docs/connectors/VEXA_PIM_SHOPIFY_CONNECTOR_CTO_PO_IMPLEMENTATION_PLAN_2026-04-20.md`

Locked Shopify alignment:
- Shopify is a **catalog sync connector**
- Vexa remains the workflow surface
- Shopify install/distribution concerns do not change the core workspace IA
- Shopify Phase 3 should still be catalog-centric:
  - products
  - variants
  - media
  - metafields
  - publications
  - readiness/issues

Not Shopify V1:
- orders
- customers
- fulfillment
- checkout
- theme/content management

## 7. Validation Matrix

## PO validation

### Portfolio
- Can users find the right connection quickly?
- Can they distinguish healthy, blocked, and setup-needed accounts?

### Setup
- Is setup focused and understandable?
- Are blocked/planned connectors honestly represented?

### Connection detail
- Can users understand state in under 10 seconds?
- Can they find credentials, catalog status, issues, and logs without hunting?

### Catalog modules
- Can users diagnose publication readiness without scanning raw internal IDs?
- Do tables support real catalog workflows instead of generic data browsing?

### Mapping
- Does the mapping workbench remain the canonical edit path?

## CTO validation

### Architecture
- normalized connection summary model
- normalized health model
- clear separation between shared connector UI and connector-specific adapter logic

### Security
- masked credentials
- audited connector mutations
- strict role enforcement
- safe publish/retry actions

### Performance
- server-driven filtering and pagination for large module tables
- detail drawers and advanced views do not bloat initial page payloads

### Maintainability
- shared page shell
- shared status primitives
- shared connection header pattern
- shared catalog module table patterns

## 8. Delivery Guardrails

Do this:
- refine the current Vexa model
- deepen catalog-centric connector operations
- keep mapping/readiness canonical
- expose connector maturity honestly

Do not do this:
- build a second generic iPaaS product
- introduce orders/customers into the core PIM connector workspace
- duplicate mapping logic across connector pages
- expose raw backend schema as primary UI

## 9. Final PO and CTO Decision

PO verdict:
- approved with correction that Phase 3 remains catalog-centric only

CTO verdict:
- approved provided implementation continues to reuse current Vexa surfaces and avoids generic iPaaS scope expansion

Recommended next execution slice:
- lock the connector workspace IA around current Vexa surfaces
- use Shopify as the first rigorous catalog-sync connector maturity path
- keep future connector work measured against this catalog-first execution model
