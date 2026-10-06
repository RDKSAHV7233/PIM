# Publication targets: contract, reason codes, consumers and PR plan

Companion to `docs/adr/0015-publication-targets-derived-from-readiness-evidence.md`. Status: accepted design. Implemented so
far: the launch-policy fail-closed default (5.1a, #1182) and the pure registry and evaluator with their invariants
(5.1b, `apps/api/src/publication-targets/`, no consumers, no endpoint), and the evidence manifest with its inventory
and the Product Owner commercial-support records (5.1c-1, data only, no migration; inventory in
`docs/connectors/PUBLICATION_EVIDENCE_INVENTORY_2026-10-06.md`). Not yet implemented: tenant entitlement persistence and
provider-verification persistence (5.1c-2), fact derivation (5.1c-3), the endpoint, the divergence comparison and the
rotation metric (5.1d), and everything in 5.2 and later.

## 1. Endpoint contract

`GET /api/v1/marketplace/publication-targets` (tenant-scoped; optional `?productId=<id>` adds the product scope).
Read-only. Roles follow the existing channel read access.

```jsonc
{
  "asOf": "2026-10-05T10:00:00.000Z",
  "scope": "tenant",                       // "tenant" | "product"
  "targets": [
    {
      "key": "zoho-inventory",             // connector slug: the one identity used everywhere
      "channel": null,                     // legacy Tier-1 key ("amazon", "flipkart"...) or null
      "displayName": "Zoho Inventory",
      "tier": 2,
      "available": false,
      "installations": [                   // tenant scope: one entry per account
        { "installationId": "…", "accountAlias": "primary", "available": false }
      ],
      "conditions": [
        {
          "id": "capability_verified",
          "scope": "platform",             // platform | tenant | product
          "status": "fail",                // pass | fail | warn | not_applicable | unknown
          "code": "CAPABILITY_NOT_VERIFIED",
          "blocking": true,
          "message": "No product-pipeline evidence for PUBLISH is recorded.",
          "evidenceRef": null,
          "owner": "platform"              // platform | tenant_admin | seller
        }
        // … one entry per condition in the chain, always, in a fixed order
      ],
      "summary": { "blocking": 1, "warnings": 0, "firstBlockingCode": "CAPABILITY_NOT_VERIFIED" }
    }
  ]
}
```

Rules:
- Every **publish** target in the registry is returned, available or not. Nothing is hidden. Export-only
  connectors are not publication targets and are not returned, except with `?diagnostic=true` (admin roles), where
  they appear unavailable with `PUBLISH_NOT_DECLARED`.
- `conditions` always lists the full chain in a fixed order. A later condition that cannot be evaluated because an
  earlier one failed is `not_applicable` with the reason `BLOCKED_BY_EARLIER_CONDITION` stated in `message`,
  not omitted.
- `available` is true only when no condition is `fail` or `unknown`.
- With `productId`, the product-scope conditions are evaluated for that product and installation; without it they
  are `not_applicable`.
- The payload contains no credentials, no provider messages and no tenant data beyond the caller's own.

## 2. The chain, with sources of truth

| # | Condition id | Scope | Source of truth today | Reason code(s) on failure |
|---|---|---|---|---|
| 1 | `definition_exists` | platform | `connector_definitions` row | `CONNECTOR_NOT_DEFINED` |
| 2 | `runtime_registered` | platform | `ConnectorRegistry` | `CONNECTOR_NOT_REGISTERED` |
| 3 | `publish_declared` | platform | connector `capabilities` | `PUBLISH_NOT_DECLARED` |
| 4 | `capability_verified` | platform | evidence manifest (new), path `product_pipeline`, `reverifyBy` | `CAPABILITY_NOT_VERIFIED`, `RECERTIFICATION_REQUIRED` |
| 5 | `release_allowed` | platform + tenant cohort | `resolveConnectorLaunchPolicy` stage and its `reason`; `ConnectorTenantEntitlement` record (`controlled_pilot` grant, `early_access` opt-in; none for `live`) | `CONNECTOR_POLICY_MISSING`, `P1_BLOCKER_HOLD`, `LAUNCH_STAGE_NOT_PUBLISHABLE`, `RELEASE_RESTRICTED` |
| 6 | `commercially_supported` | platform | Product Owner approval record in the registry (new, default false) | `NOT_COMMERCIALLY_SUPPORTED` |
| 7 | `target_schema_ready` | platform | `ProductTypeSchema` registry (ADR-0008) | `TARGET_SCHEMA_MISSING`, `TARGET_SCHEMA_STALE` |
| 8 | `installation_eligible` | tenant | `connector_installations` (status, authorization metadata) | `NO_INSTALLATION`, `INSTALLATION_NOT_ACTIVE`, `INSTALLATION_AUTH_INCOMPLETE` |
| 9 | `credential_acceptable` | tenant | last trustworthy state from installation status and `validation` facts (#1149); `VALID` with reason `TOKEN_ONLY` is not provider verification | `CREDENTIAL_INVALID`, `CREDENTIAL_NEVER_VALIDATED`, `CREDENTIAL_NOT_PROVIDER_VERIFIED`, `CREDENTIAL_STALE`, `CREDENTIAL_CONFIGURATION_ERROR`; warn `CREDENTIAL_CHECK_INCONCLUSIVE` (only after a recent provider-verified `VALID`) |
| 10 | `mapping_ready` | tenant | `resolveEffectiveMapping` and `compatibilityState` | `MAPPING_NOT_READY` (`remap_required`, `blocked`, or no published mapping); warn `MAPPING_DEPRECATED` (`deprecated` while still compatible) |
| 11 | `product_ready` | product | validation issues, completeness, channel readiness | `PRODUCT_NOT_READY` |
| 12 | `prior_outcome_settled` | product | submissions with `PROVIDER_OUTCOME_UNKNOWN` (#1162) and the create classification in `connector-write-retry-policy.md` | `PRIOR_PROVIDER_OUTCOME_UNKNOWN` (**blocks** for `AMBIGUOUS` creates until reconciled; `warn` for reconciliation-safe or idempotent operations) |

Cross-cutting: `EVALUATION_UNAVAILABLE` when a source cannot be read. It is `unknown`, which makes the target
unavailable.

The existing rules that this replaces, by condition: the API's `getPublishCapableChannels()` covers 3, 8 and
part of 9 (status ACTIVE, `PUBLISH` capability, Shopify `metadata.shopId`, Flipkart/Amazon validated
credentials); the web's `isConnectorReadyToPublish()` repeats 8 and 9; `summarizeReadiness` folds the connector
condition into an error count.

## 3. Reason-code catalog (closed set)

| Code | Condition | Blocking | Owner | Seller-safe message (summary) |
|---|---|---|---|---|
| `CONNECTOR_NOT_DEFINED` | 1 | yes | platform | This channel is not available. |
| `CONNECTOR_NOT_REGISTERED` | 2 | yes | platform | This channel is not available. |
| `PUBLISH_NOT_DECLARED` | 3 | yes | platform | This channel does not support publishing. |
| `CAPABILITY_NOT_VERIFIED` | 4 | yes | platform | Publishing to this channel has not been verified for use. |
| `RECERTIFICATION_REQUIRED` | 4 | yes | platform | Verification for this channel is out of date or its schema changed and needs re-verification. |
| `CONNECTOR_POLICY_MISSING` | 5 | yes | platform | This channel is not available. |
| `P1_BLOCKER_HOLD` | 5 | yes | platform | Publishing to this channel is on hold. |
| `LAUNCH_STAGE_NOT_PUBLISHABLE` | 5 | yes | platform | This channel is not open for publishing yet. |
| `RELEASE_RESTRICTED` | 5 | yes | platform | This channel is limited to selected accounts and yours is not included. |
| `NOT_COMMERCIALLY_SUPPORTED` | 6 | yes | platform | This channel is not supported for production use. |
| `TARGET_SCHEMA_MISSING` | 7 | yes | platform | No target schema exists for this product type. |
| `TARGET_SCHEMA_STALE` | 7 | yes | platform | The target schema needs refreshing. |
| `NO_INSTALLATION` | 8 | yes | tenant_admin | Install a connector account first. |
| `INSTALLATION_NOT_ACTIVE` | 8 | yes | tenant_admin | The connected account is paused or disabled. |
| `INSTALLATION_AUTH_INCOMPLETE` | 8 | yes | tenant_admin | Finish authorizing the connected account. |
| `CREDENTIAL_INVALID` | 9 | yes | tenant_admin | The channel rejected the saved credentials. |
| `CREDENTIAL_NEVER_VALIDATED` | 9 | yes | tenant_admin | The saved credentials have never been verified. |
| `CREDENTIAL_NOT_PROVIDER_VERIFIED` | 9 | yes | platform | The saved credentials have not been checked with the channel yet. |
| `CREDENTIAL_STALE` | 9 | yes | tenant_admin | The saved credentials have not been verified recently. |
| `CREDENTIAL_CONFIGURATION_ERROR` | 9 | yes | tenant_admin | The configured store address was refused. |
| `CREDENTIAL_CHECK_INCONCLUSIVE` | 9 | warn | tenant_admin | The last credential check could not reach the channel. |
| `MAPPING_NOT_READY` | 10 | yes | tenant_admin | Field mapping is missing, blocked or needs to be redone. |
| `MAPPING_DEPRECATED` | 10 | warn | tenant_admin | The mapping uses fields the channel is retiring (still compatible). |
| `PRODUCT_NOT_READY` | 11 | yes | seller | This product has blocking issues for this channel. |
| `PRIOR_PROVIDER_OUTCOME_UNKNOWN` | 12 | yes for `AMBIGUOUS` creates, warn otherwise | seller | A previous publish may already have reached the channel; check before publishing again. |
| `EVALUATION_UNAVAILABLE` | any | yes | platform | Readiness could not be determined. |

Adding a code is a code change that updates this table, the closed set in the type, and the invariant test.

## 4. Evidence manifest (shape)

A typed module beside the launch policy; one entry per `(connector, capability, path)`.

```ts
type EvidencePath = "direct_adapter" | "product_pipeline";
type CertificationLevel = "untested" | "unit_tested" | "integration_tested" | "sandbox_verified" | "production_verified" | "certified";

interface CapabilityEvidence {
  connector: string;          // slug
  capability: ConnectorCap;   // PUBLISH | VALIDATE | STATUS_SYNC | …
  path: EvidencePath;
  level: CertificationLevel;
  evidenceRef: string | null; // PR, commit or run reference
  verifiedAt: string | null;  // ISO date
  verifiedBy: string | null;  // role or team, not a person
  reverifyBy: string | null;  // authoritative; past it the entry evaluates as RECERTIFICATION_REQUIRED
}
```

The commercial-support record is separate: `{ connector, commerciallySupported, approvedBy: "PO", approvalRef,
approvedAt }`, default false, never derived from the adapter.

Initial population is a read-only inventory pass in 5.1 from ADR-0007's table, the launch-policy comments and
`INCREMENT_STATE.json`. Where evidence cannot be found the entry is `untested`, not a guess. Example of the point
of the `path` dimension: Zoho Inventory would have `PUBLISH / direct_adapter / sandbox_verified` and
`PUBLISH / product_pipeline / untested`, which evaluates as `CAPABILITY_NOT_VERIFIED`.

### Entities introduced by 5.1 (shape only)

```ts
interface ConnectorTenantEntitlement {   // control plane; append and revoke, never edit in place
  tenantKey: string; connector: string; releaseStage: "controlled_pilot" | "early_access";
  validFrom: string; validUntil: string | null;
  approvedBy: string; approvedAt: string; reason: string; source: string;
  revokedAt: string | null;
}

interface OutcomeResolution {            // append-only; linked to the original submission, which is never rewritten
  submissionId: string;
  resolution: "CONFIRMED_SUCCEEDED" | "CONFIRMED_NOT_APPLIED" | "SUPERSEDED";
  actor: string; at: string; evidenceSource: string; reason: string;
  providerIdentifiers: string[]; correlationIds: string[];
}
```

Evidence `reverifyBy` policy defaults at creation: `sandbox_verified` +30 days, `production_verified` +30 days,
`certified` +90 days; an explicit shorter date from certification or security policy wins.

Credential freshness: `credentialFreshnessWindow >= 2 x heartbeatMaxRotation + one scheduler interval`, where
`heartbeatMaxRotation` is the supported time for every eligible installation to get one validation attempt. 5.1
exposes it as a metric and alerts when installation volume exceeds the capacity the configured window implies.

## 5. Consumers

Counts are files referencing the hardcoded list or its helpers (excluding specs), as of `main` `cb77bbdf`.

**API (14 files):** `marketplace/marketplace.service.ts` (31 references: channel listing, batch readiness,
parsing, mapping packs), `marketplace/marketplace-channels.ts` (the authority), `metrics/metrics.service.ts`,
`common/access-policy/access-policy.service.ts`, `rejection-intelligence/rejection-intelligence.service.ts`,
`media/media.service.ts`, `marketplace/mapping-resolution.service.ts`, `marketplace/connector-mapping.service.ts`,
and the DTOs `batch-marketplace-readiness`, `create-export-job`, `simulate-marketplace`,
`create-mapping-template`, `update-mapping-template`, `connector-payload-preview` (each an `@IsIn` over the list).

**Web (28 files):** `lib/marketplace-channels.ts` (the web copy and the slug maps), `lib/channel-readiness.ts`,
`lib/api/core.ts`, `lib/api/channels.ts`, `lib/channel-mappings.ts`, `components/product/products-tab.tsx`,
`components/channel/product-readiness-summary-bar.tsx`, `components/channel/product-channel-readiness-cell.tsx`,
`app/api/marketplace/readiness/route.ts` and `readiness/batch/route.ts`, `app/catalog/products/page.tsx`,
`app/products/[id]/page.tsx` and its `_components` (including `isConnectorReadyToPublish`),
`app/connectors/page.tsx`, `app/channels/mappings/page.tsx`, `app/channels/connectors/[installationId]/page.tsx`,
`app/media/page.tsx`, `app/rejection/page.tsx`, `app/actions.ts`, and others.

What changes where:

| Surface | 5.1 | 5.2 | 5.3 |
|---|---|---|---|
| Hardcoded list and slug maps | unchanged | web copy removed; API keeps the Tier-1 mapping-pack meaning | job and mapping DTOs accept registry keys per approved connector |
| `getPublishCapableChannels()` | compared, not replaced | replaced by the registry evaluation | removed |
| `isConnectorReadyToPublish()` (web) | unchanged | removed | removed |
| Product page installed publish lanes | unchanged | reads the endpoint, shows the reasons | adds the Tier-2 pilot candidate |
| Readiness batch and routes | unchanged | read the endpoint | unchanged |
| Launch policy default for an unknown slug | **changed**: unknown slug resolves to a non-installable, non-publishable stage, never `live` | unchanged | unchanged |

## 6. PR plan

All PRs target `main`, one in flight at a time, narrow, no migrations unless stated.

| PR | Scope | Verification | Rollback |
|---|---|---|---|
| **G (precedes all)** Woo governance record | Record the owners' 2026-10-05 decisions; restore `p1_blocker_hold` for WooCommerce in the launch policy with its copy and tests; preserve #1052 and #1059 historically; reconcile the stale current-state documents. Human-approved, separate from Sprint 5 code | launch-policy spec, copy-consistency test | revert |
| **5.1 (SHADOW only)** Launch-policy fail-closed default, registry, evaluator, manifest, entitlement model, endpoint, divergence comparison, rotation metric | launch policy never resolves an unknown slug to `live`; `publication-targets` module; evidence manifest with the inventory pass; reason catalog; endpoint; a comparison against the existing eligibility that logs divergence; invariants as tests | unit tests per condition and per reason; property test that `available` implies no fail/unknown; manifest completeness; fixtures for every connector; divergence report from a local run | revert; nothing consumes it |
| **5.2** Consumers | product page lanes and readiness routes read the endpoint behind a flag; remove the web's duplicated rules once divergence is zero | web integration tests; browser check of the reasons; flag off restores today's behavior | flag off, then revert |
| **5.3** First Tier-2 candidate | Zoho Inventory behind a flag and per-connector PO approval; the job DTO accepts the registry key for it; requires pipeline evidence that does not exist yet (a controlled write through the pipeline, certification, commercial support) | controlled write evidence; the evaluator shows `available` only after the evidence is recorded | flag off |

Gate: Sprint 5 implementation (5.1 onward) does not start until PR G is merged.

Enforcement is a later, separate decision. It requires PR G authoritative, the evidence inventory, entitlement
records, Product Owner commercial-support records, a supportable credential freshness policy, provider-verified
Amazon and Flipkart credentials, and outcome settlement wherever blocking is required. Until then 5.1 changes no
customer-facing eligibility and reports `PRIOR_PROVIDER_OUTCOME_UNKNOWN` only.

## 7. Risks

- **Divergence on day one.** Connectors that publish today through list membership will need manifest entries; the
  shadow comparison exists to find every difference before any behavior changes.
- **Evidence inventory cost.** Some evidence is only in comments. Marking absent evidence `untested` is correct and
  will make some connectors unavailable that the list currently allows; that is the intended result and is
  reviewed with the owners in 5.1, not decided silently.
- **Stricter thresholds.** `early_access` now needs `production_verified` pipeline evidence and an explicit cohort,
  and `commerciallySupported` needs a Product Owner record. Connectors at `early_access` today will mostly evaluate
  unavailable until their evidence and approvals are recorded. That is the intended result; the shadow report lists
  each one.
- **Credential facts.** Installations whose validation facts are empty evaluate `CREDENTIAL_NEVER_VALIDATED` until
  the next heartbeat tick; the shadow run measures how many.
- **Unsettleable block.** The unknown-outcome block must not be enforced before an operator can settle an outcome.
- **Endpoint cost.** The chain reads installations, mappings, schemas and submissions. Tenant scope is computed
  once per request; product scope is bounded to a single product and installation. Caching is a measured
  follow-up, not a design assumption.
- **Reason leakage.** Messages are seller-safe; operator detail stays in the structured `code` and `evidenceRef`.

## 8. Parked follow-ups (unchanged order)

1. Carry the provider HTTP status on publish errors so a 5xx answer after a create is classified as an unknown
   outcome.
2. Correct the WooCommerce callback contract (`BUG-WOO-OAUTH-QUERY-SECRET`) before any app-auth work.
3. The "Outcome unknown" chip in the web UI (presentation only).
