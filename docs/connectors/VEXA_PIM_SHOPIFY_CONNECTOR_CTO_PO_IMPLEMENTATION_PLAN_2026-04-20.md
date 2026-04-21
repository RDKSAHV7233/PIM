# Vexa PIM Shopify Connector CTO/PO Implementation Plan

Status: Proposed for approval
Date: 2026-04-20
Audience: CTO, PO, platform engineering, connector engineering, QA
Scope basis: Official Shopify docs verified on April 20, 2026, plus current Vexa connector architecture in this repo

## 0. PO Review Verdict

Verdict: Approved with changes

Approved business direction:
- Shopify should be treated as a Vexa catalog sync channel, not a marketplace-style connector.
- Vexa should remain the primary operator workflow surface.
- V1a should stay focused on product, variant, media, metafield, and publication sync.
- Inventory should remain opt-in and deferred behind a source-of-truth policy.

Required PO corrections before execution:
- Shopify must be surfaced as a planned connector until managed install, token exchange, and publication flow are implemented.
- Planned connectors must be blocked from installation at both UI/API action level and service-enforcement level.
- Runtime and definition status must never silently fall back to `full` when an implementation is missing.

Approved execution slice:
- Phase 0 foundation only
- Add Shopify as a planned connector definition and runtime placeholder
- Block seller installation until the real auth/sync slice is ready
- Validate definition visibility, launch-stage gating, and no-install side effects

## 1. Executive Decision

Vexa should build Shopify as a catalog sync connector, not as a marketplace-style connector and not as a second admin product.

Locked decision:
- V1 should target Shopify as a commerce channel for product, variant, media, metafield, and publication sync.
- V1 should not attempt orders, fulfillment, checkout, theme management, or Shopify-native merchandising workflows.
- V1 should use Shopify Admin GraphQL, not REST.
- V1 should ship first as a custom-distributed embedded Shopify app for pilot customers, with the primary operational UI remaining in Vexa.
- Vexa should implement expiring offline token handling from day one, even for custom distribution, to avoid rework if the app later moves to public distribution.

Reason:
- Shopify's official docs now center the Admin GraphQL API for catalog operations and show `2026-04` as the latest stable version on April 20, 2026.
- Shopify-managed install plus token exchange is the recommended path for apps rendered in the Shopify admin.
- Public apps created on or after April 1, 2026 must use expiring offline tokens.
- Custom distribution is faster for pilot rollout and avoids App Store review, while still supporting embedded installs.

## 2. Product Positioning For Shopify

This connector is not a generic Shopify app. It is a Vexa channel connector.

Customer fit:
- brands and mid-market merchants already using Shopify as their storefront
- operators who want Shopify storefront data to be fed from Vexa's catalog workflow
- merchants who want controlled product publication and channel-specific sync from a central PIM

What Vexa should sell:
- central product authoring in Vexa
- controlled sync into Shopify
- structured mapping, completeness, approval, and publish readiness before storefront publication

What Vexa should not sell in V1:
- "run your Shopify store from Vexa"
- order or fulfillment operations
- Shopify theme/content editing
- checkout, discounts, or merchandising automation inside Shopify admin

## 3. Validated Vexa Surfaces To Reuse

### Connector runtime
- `apps/api/src/connector-framework/connector.interface.ts`
- `apps/api/src/connector-framework/connector.registry.ts`
- `apps/api/src/connector-framework/connector-framework.service.ts`
- `apps/api/src/connector-installer/connector-installer.service.ts`

### Marketplace and mapping
- `apps/api/src/marketplace/marketplace.service.ts`
- `apps/api/src/marketplace/connector-mapping.service.ts`
- `apps/api/src/marketplace/marketplace-channels.ts`

### Existing connectors to copy patterns from
- `apps/api/src/connectors/flipkart/flipkart.connector.ts`
- `apps/api/src/connectors/amazon/amazon.connector.ts`

### Existing web/operator UI surfaces
- `apps/web/src/app/connectors/page.tsx`
- `apps/web/src/app/channels/mappings/page.tsx`
- `apps/web/src/app/products/[id]/page.tsx`

Conclusion:
- Vexa already has the right connector runtime skeleton.
- The missing work is Shopify-specific auth, product sync semantics, publication semantics, inventory policy, and app distribution shape.

## 4. Locked PO Decisions

### 4.1 V1 business scope
Included:
- install/connect Shopify store to Vexa
- product and variant sync from Vexa to Shopify
- media sync from Vexa to Shopify
- Vexa-owned metafield sync for identity and connector metadata
- publish to selected Shopify publication(s)
- connection health, last sync state, and failure visibility in Vexa
- app uninstall handling

Deferred:
- order sync
- fulfillment sync
- price rules and discounts
- collections as a first-class V1 scope
- theme/content sync
- Shopify Billing API
- App Store go-to-market
- multi-store one-click rollout UX beyond per-installation setup

### 4.2 Source-of-truth policy
Locked decision:
- Vexa is the source of truth for product content.
- Inventory is not source-of-truth by default.

Reason:
- Shopify's `inventorySetQuantities` docs explicitly say to use it only when the calling system is the source of truth for inventory quantities.
- Many merchants use ERP, WMS, or Shopify-native tools for stock. Forcing Vexa to own inventory in V1 creates avoidable product risk.

PO rule:
- product and publication sync are in V1
- inventory write is opt-in and only for tenants that explicitly designate Vexa as the inventory source of truth

### 4.3 Merchant UX policy
Locked decision:
- the operational workflow remains in Vexa
- the Shopify embedded app is minimal and exists to support install, consent, connection status, and merchant trust

Reason:
- Vexa already has mapping, readiness, approvals, and submission UX.
- Rebuilding those flows inside Shopify admin would create duplicate product surfaces and slow delivery.

## 5. Locked CTO Decisions

### 5.1 App shape
Recommended architecture:
- minimal embedded Shopify app for install and connection status
- Vexa-hosted API and operator UI remain the system of workflow truth
- deep-link from Shopify app to Vexa workspace after successful install

This is the right compromise because:
- Shopify recommends managed install plus token exchange for apps rendered in Shopify admin
- Vexa should not duplicate its full operator UI inside Shopify
- future public distribution remains possible without re-architecting the connector

### 5.2 Distribution model
Phase 1 decision:
- custom distribution for pilot

Reason:
- official distribution docs say custom distribution supports installation on a single store or stores in the same Plus org
- custom distribution doesn't require App Store approval
- custom distribution can't use Shopify Billing API, which is acceptable because Vexa already bills outside Shopify

Phase 2 decision:
- public distribution only after pilot metrics, support model, and token rotation are proven

Reason:
- only public apps can be listed on the Shopify App Store
- public apps introduce review, listing, and support expectations that Vexa does not need for pilot validation

### 5.3 Authentication and token model
Locked decision:
- use Shopify managed install if the app is embedded
- use token exchange, not manual authorization code grant, for the embedded app
- persist expiring offline tokens and refresh tokens from day one

Reason:
- Shopify-managed install removes browser redirects for install and scope changes
- Shopify docs recommend token exchange for apps rendered in the Shopify admin
- token exchange supports expiring offline access tokens
- official Shopify changelog says new public apps as of April 1, 2026 must use expiring offline tokens

Required token storage fields in Vexa credential storage:
- access token
- access token expiry timestamp
- refresh token
- refresh token expiry timestamp
- granted scopes
- shop domain
- shop identifier

### 5.4 API policy
Locked decision:
- use GraphQL Admin API `2026-04`
- avoid REST for new Shopify connector work

Reason:
- official docs show `2026-04` as the latest stable Admin GraphQL version on April 20, 2026
- publication and modern product workflows are GraphQL-first

## 6. Shopify Constraints That Change The Design

### 6.1 `productSet` is powerful but dangerous
Shopify documents `productSet` as the primary mutation for syncing products from an external source.

Important consequence:
- for list fields, Shopify says omitted entries can be deleted
- that includes variants and metafields

CTO decision:
- use `productSet` only when Vexa owns the full intended state of the product payload being synced
- do not use `productSet` for partial patch semantics without a read-merge-write step

Practical rule:
- full product sync path: `productSet`
- partial metadata-only path: separate narrower mutations if needed

### 6.2 Publication is not implicit
Shopify publication now needs explicit handling.

Official docs show:
- `publications` query requires `read_publications`
- `publishablePublish` requires `write_publications`
- products must be active to be visible in a channel

CTO decision:
- publication is a distinct step in the connector, not a side effect we assume Shopify will do automatically

PO decision:
- Vexa should expose publication target selection in connector setup or per-tenant connector defaults

### 6.3 Inventory must be handled as a policy choice
Shopify's `inventorySetQuantities` docs say it should only be used when the caller is the source of truth for inventory. They also require idempotency handling and concurrency-safe quantity checks in current API versions.

CTO decision:
- do not make inventory sync mandatory in V1
- if enabled, it must be single-location first and use explicit idempotency and compare-and-set logic

### 6.4 Webhooks must be fast and authenticated
Shopify docs require HMAC validation and recommend queueing webhook processing to handle bursts.

CTO decision:
- Shopify webhooks go through Vexa's queue immediately after signature validation
- no heavy business processing in the request thread

## 7. Required Shopify Access Scopes

Minimum V1 scopes:
- `read_products`
- `write_products`
- `read_publications`
- `write_publications`

V1b optional inventory scopes:
- `read_inventory`
- `write_inventory`
- `read_locations`

Why:
- product and variant sync require product scopes
- publication selection and publish actions require publication scopes
- location-aware inventory requires inventory and location access

PO rule:
- request only the minimum scopes required for the contracted feature set
- do not request orders, fulfillments, or customer scopes in V1

## 8. Vexa Data Model And Runtime Design

### 8.1 Connector identity
Add connector definition:
- slug: `shopify`
- display name: `Shopify`
- capabilities for V1:
  - `PUBLISH`
  - `VALIDATE`
  - `STATUS_SYNC`
  - `WEBHOOK_RECEIVE`

### 8.2 Installation metadata
Store in installation metadata:
- `shopDomain`
- `shopId`
- `appInstallationId`
- `selectedPublicationIds`
- `primaryPublicationId`
- `inventoryMode` = `disabled | source_of_truth`
- `primaryLocationId` for inventory-enabled tenants
- `tokenMode` = `expiring_offline`

Store secrets in encrypted credential storage:
- current access token
- refresh token
- expiry metadata

### 8.3 External identity strategy
Locked decision:
- use Shopify `productSet` identifier support with a stable Vexa-owned custom identifier for product upsert

Reason:
- Shopify docs show `productSet` can upsert by custom ID
- this avoids brittle handle-based matching
- it reduces duplicate-product risk on retries

Recommendation:
- create and own a Vexa product identity metafield convention for Shopify
- treat that as the canonical bridge key for product upsert

### 8.4 Publication strategy
Use `publications` to fetch available publication targets and persist the chosen target per installation or per tenant default.

Use `publishablePublish` as the explicit publish action after successful content sync.

### 8.5 Inventory strategy
V1a:
- no inventory writes by default
- read-only inventory awareness allowed for future diagnostics

V1b:
- one mapped location per installation
- use `inventorySetQuantities` only for tenants with `inventoryMode = source_of_truth`
- use required idempotency and compare-and-set semantics

## 9. V1 Functional Scope

### 9.1 V1a: Pilot-ready Shopify connector
Included:
- embedded install flow
- managed install + token exchange
- expiring offline token persistence and refresh
- shop identity capture
- publication discovery
- product/variant/media/metafield sync using GraphQL Admin API
- explicit publish action to chosen publication
- app uninstall webhook
- connector health and failure visibility in Vexa

Excluded:
- inventory writes
- inbound drift reconciliation beyond uninstall and minimal health events
- App Store listing

### 9.2 V1b: Controlled inventory support
Included:
- optional inventory sync
- single-location mapping
- idempotent `inventorySetQuantities`
- compare-and-set / concurrency-safe updates
- inventory write only for source-of-truth tenants

Excluded:
- multi-location inventory orchestration
- fulfillment-order logic
- ERP-style inventory reservation logic

## 10. Delivery Plan

### Phase 0: Architecture and partner setup
Duration:
- 1 week

Deliverables:
- Shopify partner app created
- distribution model chosen: custom distribution
- embedded app enabled
- managed install enabled
- scopes declared in Shopify app configuration
- Vexa connector definition seeded for `shopify`
- decision record for product-only V1a and inventory-delayed V1b

Exit criteria:
- merchant can install the app into a development store
- Vexa can persist a valid expiring offline token set

### Phase 1: Install and auth foundation
Duration:
- 1 to 1.5 weeks

Engineering work:
- add minimal Shopify app endpoints
- implement managed install token exchange flow
- persist token expiry and refresh metadata
- add token refresh service
- add uninstall handling and installation cleanup

Exit criteria:
- install success > 95 percent across development stores
- reconnect path works without manual DB intervention
- expired token can be refreshed automatically

### Phase 2: Product sync foundation
Duration:
- 1.5 to 2 weeks

Engineering work:
- implement `ShopifyConnector`
- add product payload mapper from Vexa product to Shopify product model
- add variant and media mapping
- add stable Vexa custom identifier strategy for `productSet`
- implement sync result normalization and seller-safe error mapping

Exit criteria:
- create new product in Shopify from Vexa
- update existing product in Shopify without duplication
- repeat retry uses same logical identity and does not create duplicates

### Phase 3: Publication and operator workflow
Duration:
- 1 week

Engineering work:
- fetch publications
- let tenant choose default publication target
- implement explicit publish action using `publishablePublish`
- surface publication errors and status in Vexa

Exit criteria:
- synced active product can be published to selected publication
- inactive product is blocked with clear seller-facing message
- Vexa audit and submission history reflect publication attempt

### Phase 4: Webhooks and operational hardening
Duration:
- 1 week

Engineering work:
- register webhook subscriptions
- verify HMAC signature
- queue webhook processing
- handle uninstall and selected product sync events
- add alerting for repeated webhook failures and token refresh failures

Exit criteria:
- uninstall disconnects store safely
- webhook retries do not create duplicate side effects
- burst webhook delivery does not block request threads

### Phase 5: Optional inventory support
Duration:
- 1 to 1.5 weeks

Engineering work:
- add location selection in setup
- add `inventoryMode` policy toggle
- implement `inventorySetQuantities` with idempotency and compare-and-set behavior
- add reconciliation and support diagnostics

Exit criteria:
- inventory writes succeed only for explicitly enabled tenants
- repeated retries do not double-apply
- concurrent mismatch returns clear retryable or operator-facing error

### Phase 6: Public app readiness
Duration:
- 2 to 4 weeks after pilot

Engineering work:
- App Store review hardening
- public distribution compliance pass
- support and onboarding assets
- merchant-facing install docs
- production observability and abuse controls

Exit criteria:
- pilot metrics and support burden are acceptable
- token refresh and publication flows are stable under real tenant load
- PO approves broader GTM motion

## 11. UX Plan

### Merchant-facing Shopify app
Minimal pages only:
- connection status
- store identity and granted scopes
- last sync summary
- link back to Vexa workspace
- disconnect guidance

### Operator-facing Vexa UI
Primary workflows remain in Vexa:
- connector install state
- publication target defaults
- product sync and publish actions
- errors and retry visibility
- audit trail

UX principle:
- Shopify admin is for trust and install confirmation
- Vexa is for ongoing catalog operations

## 12. Risks And Mitigations

### Risk 1: `productSet` deletes list data unexpectedly
Cause:
- Shopify documents list-field replacement semantics

Mitigation:
- only run full-state product sync through `productSet`
- use read-merge-write or narrower mutations for partial updates
- add connector tests for metafield and variant preservation

### Risk 2: publication scopes are missing on early installs
Cause:
- publication actions need `read_publications` and `write_publications`

Mitigation:
- request them in the first production-ready scope set
- do not defer publication scopes until after merchants install

### Risk 3: inventory writes damage merchant stock accuracy
Cause:
- Vexa may not be the true inventory source

Mitigation:
- inventory off by default
- explicit tenant opt-in
- single-location first
- compare-and-set and idempotent writes only

### Risk 4: token rotation failures break background sync
Cause:
- expiring offline tokens now rotate and refresh

Mitigation:
- refresh proactively before expiry
- retry on unauthorized responses
- alert on refresh failure
- surface reconnect state in Vexa

### Risk 5: public app review slows launch
Cause:
- App Store approval adds process and support expectations

Mitigation:
- launch pilot through custom distribution first
- move to public only after pilot proof

## 13. Delivery Estimates

Recommended staffing:
- 1 senior full-stack engineer for Shopify app/auth and Vexa web changes
- 1 senior backend engineer for connector runtime, mapping, sync, and token lifecycle
- shared PO and QA support

Estimated effort:
- V1a pilot: 4.5 to 6.5 weeks
- V1b inventory: plus 1 to 1.5 weeks
- public app hardening: plus 2 to 4 weeks

Single-engineer fallback:
- V1a pilot: 8 to 10 weeks

## 14. Acceptance Criteria

### PO acceptance
- merchant can connect a Shopify store without engineering help
- Vexa can sync a product with variants and media into Shopify
- Vexa can publish that product to the chosen publication
- failures are visible in plain business language
- operator does not need to leave Vexa for normal sync work

### CTO acceptance
- no REST dependency in the connector
- managed install and token exchange are in place for embedded flow
- expiring offline token refresh is implemented
- retries are idempotent where Shopify requires it
- webhook intake is authenticated and queued
- publication and inventory are explicit policy choices, not hidden side effects

## 15. Final Recommendation

Approve Shopify V1 with the following contract:
- custom-distributed embedded app first
- Vexa remains the operational UI
- GraphQL Admin API `2026-04`
- managed install + token exchange
- expiring offline tokens from day one
- V1a = product, media, metafield, and publication sync
- V1b = optional inventory for source-of-truth tenants only
- public App Store motion only after pilot success

This is the fastest route that is technically correct, product-coherent, and commercially realistic for Vexa.

## 16. Official Shopify Sources Used

Verified on April 20, 2026:
- Shopify Admin GraphQL API reference: https://shopify.dev/docs/api/admin-graphql/latest
- `productSet`: https://shopify.dev/docs/api/admin-graphql/latest/mutations/productSet
- `publications`: https://shopify.dev/docs/api/admin-graphql/latest/queries/publications
- `publishablePublish`: https://shopify.dev/docs/api/admin-graphql/latest/mutations/publishablePublish
- `inventorySetQuantities`: https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventorysetquantities
- API limits: https://shopify.dev/docs/api/usage/limits
- Idempotency: https://shopify.dev/docs/api/usage/implementing-idempotency
- Webhooks overview: https://shopify.dev/docs/apps/build/webhooks
- HTTPS webhooks and HMAC verification: https://shopify.dev/docs/apps/build/webhooks/subscribe/https
- Shopify managed install: https://shopify.dev/docs/apps/build/authentication-authorization/app-installation
- Token exchange: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
- Offline access tokens: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens
- Authorization code grant guidance: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
- API access scopes: https://shopify.dev/docs/api/usage/access-scopes
- App distribution: https://shopify.dev/docs/apps/launch/distribution
- App listing visibility: https://shopify.dev/docs/apps/launch/distribution/visibility
- Shopify developer changelog: expiring offline tokens required for new public apps as of April 1, 2026: https://shopify.dev/changelog
