# Publication targets: contract, reason codes, consumers and PR plan

Companion to `docs/adr/0015-publication-targets-derived-from-readiness-evidence.md`. Status: proposed design,
nothing here is implemented.

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
      "kind": "publish",                   // "publish" | "export_only"
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
- Every target in the registry is returned, available or not. Nothing is hidden.
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
| 4 | `capability_verified` | platform | evidence manifest (new), path `product_pipeline` | `CAPABILITY_NOT_VERIFIED`, `EVIDENCE_EXPIRED`, `RECERTIFICATION_REQUIRED` |
| 5 | `release_allowed` | platform | `resolveConnectorLaunchPolicy` stage | `P1_BLOCKER_HOLD`, `LAUNCH_STAGE_NOT_PUBLISHABLE`, `RELEASE_RESTRICTED` |
| 6 | `commercially_supported` | platform | per-connector flag in the registry (new, default false) | `NOT_COMMERCIALLY_SUPPORTED` |
| 7 | `target_schema_ready` | platform | `ProductTypeSchema` registry (ADR-0008) | `TARGET_SCHEMA_MISSING`, `TARGET_SCHEMA_STALE` |
| 8 | `installation_eligible` | tenant | `connector_installations` (status, authorization metadata) | `NO_INSTALLATION`, `INSTALLATION_NOT_ACTIVE`, `INSTALLATION_AUTH_INCOMPLETE` |
| 9 | `credential_acceptable` | tenant | installation status and `validation.outcome` (#1149) | `CREDENTIAL_INVALID`, `CREDENTIAL_NEVER_VALIDATED`, `CREDENTIAL_CONFIGURATION_ERROR`; warn `CREDENTIAL_CHECK_INCONCLUSIVE` |
| 10 | `mapping_ready` | tenant | `resolveEffectiveMapping` and `compatibilityState` | `MAPPING_NOT_READY`; warn `MAPPING_DEPRECATED` |
| 11 | `product_ready` | product | validation issues, completeness, channel readiness | `PRODUCT_NOT_READY` |
| 12 | `prior_outcome_settled` | product | submissions with `PROVIDER_OUTCOME_UNKNOWN` (#1162) | `PRIOR_OUTCOME_UNKNOWN` (`warn` or `fail`, see ADR section 8) |

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
| `EVIDENCE_EXPIRED` | 4 | yes | platform | Verification for this channel is out of date. |
| `RECERTIFICATION_REQUIRED` | 4 | yes | platform | This channel's schema changed and needs re-verification. |
| `P1_BLOCKER_HOLD` | 5 | yes | platform | Publishing to this channel is on hold. |
| `LAUNCH_STAGE_NOT_PUBLISHABLE` | 5 | yes | platform | This channel is not open for publishing yet. |
| `RELEASE_RESTRICTED` | 5 | yes | platform | This channel is limited to selected accounts. |
| `NOT_COMMERCIALLY_SUPPORTED` | 6 | yes | platform | This channel is not supported for production use. |
| `TARGET_SCHEMA_MISSING` | 7 | yes | platform | No target schema exists for this product type. |
| `TARGET_SCHEMA_STALE` | 7 | yes | platform | The target schema needs refreshing. |
| `NO_INSTALLATION` | 8 | yes | tenant_admin | Install a connector account first. |
| `INSTALLATION_NOT_ACTIVE` | 8 | yes | tenant_admin | The connected account is paused or disabled. |
| `INSTALLATION_AUTH_INCOMPLETE` | 8 | yes | tenant_admin | Finish authorizing the connected account. |
| `CREDENTIAL_INVALID` | 9 | yes | tenant_admin | The channel rejected the saved credentials. |
| `CREDENTIAL_NEVER_VALIDATED` | 9 | yes | tenant_admin | The saved credentials have never been verified. |
| `CREDENTIAL_CONFIGURATION_ERROR` | 9 | yes | tenant_admin | The configured store address was refused. |
| `CREDENTIAL_CHECK_INCONCLUSIVE` | 9 | warn | tenant_admin | The last credential check could not reach the channel. |
| `MAPPING_NOT_READY` | 10 | yes | tenant_admin | Field mapping is missing or needs attention. |
| `MAPPING_DEPRECATED` | 10 | warn | tenant_admin | The mapping uses fields the channel is retiring. |
| `PRODUCT_NOT_READY` | 11 | yes | seller | This product has blocking issues for this channel. |
| `PRIOR_OUTCOME_UNKNOWN` | 12 | per connector | seller | A previous publish may already have reached the channel; check before publishing again. |
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
  expiresAt: string | null;   // after this the entry evaluates as EVIDENCE_EXPIRED
}
```

Initial population is a read-only inventory pass in 5.1 from ADR-0007's table, the launch-policy comments and
`INCREMENT_STATE.json`. Where evidence cannot be found the entry is `untested`, not a guess. Example of the point
of the `path` dimension: Zoho Inventory would have `PUBLISH / direct_adapter / sandbox_verified` and
`PUBLISH / product_pipeline / untested`, which evaluates as `CAPABILITY_NOT_VERIFIED`.

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
| Launch policy default for an unknown slug | not changed | not changed | publication ignores it (unknown = unavailable) |

## 6. PR plan

All PRs target `main`, one in flight at a time, narrow, no migrations unless stated.

| PR | Scope | Verification | Rollback |
|---|---|---|---|
| **G (precedes all)** Woo governance record | Record the owners' 2026-10-05 decisions; restore `p1_blocker_hold` for WooCommerce in the launch policy with its copy and tests; preserve #1052 and #1059 historically; reconcile the stale current-state documents. Human-approved, separate from Sprint 5 code | launch-policy spec, copy-consistency test | revert |
| **5.1** Registry, evaluator, manifest, endpoint (shadow) | `publication-targets` module; evidence manifest with the inventory pass; reason catalog; endpoint; a comparison against the existing eligibility that logs divergence; invariants as tests | unit tests per condition and per reason; property test that `available` implies no fail/unknown; manifest completeness; fixtures for every connector; divergence report from a local run | revert; nothing consumes it |
| **5.2** Consumers | product page lanes and readiness routes read the endpoint behind a flag; remove the web's duplicated rules once divergence is zero | web integration tests; browser check of the reasons; flag off restores today's behavior | flag off, then revert |
| **5.3** First Tier-2 candidate | Zoho Inventory behind a flag and per-connector PO approval; the job DTO accepts the registry key for it; requires pipeline evidence that does not exist yet (a controlled write through the pipeline, certification, commercial support) | controlled write evidence; the evaluator shows `available` only after the evidence is recorded | flag off |

Gate: Sprint 5 implementation (5.1 onward) does not start until PR G is merged.

## 7. Risks

- **Divergence on day one.** Connectors that publish today through list membership will need manifest entries; the
  shadow comparison exists to find every difference before any behavior changes.
- **Evidence inventory cost.** Some evidence is only in comments. Marking absent evidence `untested` is correct and
  will make some connectors unavailable that the list currently allows; that is the intended result and is
  reviewed with the owners in 5.1, not decided silently.
- **Endpoint cost.** The chain reads installations, mappings, schemas and submissions. Tenant scope is computed
  once per request; product scope is bounded to a single product and installation. Caching is a measured
  follow-up, not a design assumption.
- **Reason leakage.** Messages are seller-safe; operator detail stays in the structured `code` and `evidenceRef`.

## 8. Parked follow-ups (unchanged order)

1. Carry the provider HTTP status on publish errors so a 5xx answer after a create is classified as an unknown
   outcome.
2. Correct the WooCommerce callback contract (`BUG-WOO-OAUTH-QUERY-SECRET`) before any app-auth work.
3. The "Outcome unknown" chip in the web UI (presentation only).
