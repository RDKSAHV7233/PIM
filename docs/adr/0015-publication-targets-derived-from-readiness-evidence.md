# ADR-0015: Publication Targets Are Derived From Readiness Evidence

**Status**: Proposed
**Date**: 2026-10-05
**Author**: Sprint 5 (registry-derived publication targets), design only
**Amends**: ADR-0006 (adds a publication-level readiness above connector-level availability), ADR-0007 (adds a path dimension to certification evidence), ADR-0014 §2 (realizes "the frontend derives its channel list from the API")
**Detail**: `docs/design/publication-targets-contract.md` (endpoint contract, reason-code catalog, consumer inventory, PR plan)

---

## Context

Which destinations a product can be published to is decided today by a hardcoded list, plus several copies of
hand-written eligibility rules.

- `MARKETPLACE_CHANNELS = ["amazon", "flipkart", "meesho", "shopify", "woocommerce"]` exists twice
  (`apps/api/src/marketplace/marketplace-channels.ts` and `apps/web/src/lib/marketplace-channels.ts`), with two
  slug maps (`amazon` ↔ `amazon-in`). It is consumed by roughly 14 API files and 28 web files: DTO `@IsIn`
  validators, the access policy, the readiness routes, the product page, the catalog, media, rejection and export
  surfaces.
- It is a *Tier-1 mapping-pack* list (ADR-0006 §1), but it also acts as the publication authority:
  `parseMarketplaceChannel` rejects anything else, so a Tier-2 connector (Zoho, Shopware, eBay, PrestaShop,
  Odoo, BigCommerce, Etsy, Dynamics 365) can be installed and healthy and still can never be a product publish
  target. Nothing says why, and no surface explains it.
- Eligibility for the channels that are on the list is computed by slug-specific code that exists **twice**: the
  API's `getPublishCapableChannels()` (ACTIVE installation, `PUBLISH` capability, Shopify `metadata.shopId`,
  Flipkart/Amazon validated credentials) and the web's `isConnectorReadyToPublish()`. The comments record that the
  two have disagreed before (VEXA-202, VEXA-301-SPIKE).
- `resolveConnectorLaunchPolicy` returns `live` with every capability for any slug it does not recognize
  (fail-open), and the launch stage is not consulted by `getPublishCapableChannels()` at all.
- Evidence is inferred from code presence. ADR-0007's certification table is prose; the launch-policy comments are
  the de facto record. There is no machine-readable evidence and nothing expires.
- Since ADR-0006/0007, three things now exist that eligibility should consume and does not: truthful credential
  health (`validation.outcome`, #1141/#1144/#1149), write-outcome safety (`PROVIDER_OUTCOME_UNKNOWN`,
  `AMBIGUOUS_CREATE_OUTCOME`, #1157/#1162), and an explicit hold stage (`p1_blocker_hold`) whose assignment is a
  governance decision.

The result is that **being in code, being installable, or having healthy credentials are read as being
publishable**, in some places by accident of a list.

## Decision

### 1. The central rule

> A connector appearing in code, being installable, or even having healthy credentials must never by itself make
> it publishable. A publication target is available only when every condition in the chain below passes, and
> every failing condition is reported with an explicit reason.

### 2. The chain

```
connector definition exists                          (connector_definitions row)
AND runtime registration exists                      (ConnectorRegistry has the slug)
AND publish capability is declared                   (capabilities includes PUBLISH)
AND the capability has current evidence on the       (certification at or above the minimum for the
    path the product pipeline uses                    release stage, not expired, not recertification-due)
AND release is allowed                               (launch stage permits publishing; not p1_blocker_hold)
AND commercial support is recorded                   (explicit per-connector flag; default false)
AND installation is eligible                         (exists, ACTIVE, authorization complete)
AND credential state is acceptable                   (not expired, validated at least once, target not refused)
AND target schema exists and is compatible           (ProductTypeSchema, ADR-0008)
AND mapping is ready                                 (effective mapping resolves; not blocked/remap_required)
AND product/channel readiness passes                 (no blocking validation or completeness errors)

=> PUBLICATION TARGET AVAILABLE
```

The chain is evaluated at three scopes so that each reason has an owner:

| Scope | Conditions | Same for | Owner of the fix |
|---|---|---|---|
| Platform | definition, runtime registration, capability, evidence, release, commercial support, target schema | every tenant | Platform / PO / CTO |
| Tenant | installation, credential state, mapping | one tenant and account | Tenant admin |
| Product | product and channel readiness, prior outcome | one product on one target | Seller |

### 3. Distinct states are never collapsed

```
IMPLEMENTATION_EXISTS
≠ RUNTIME_REGISTERED
≠ INSTALLABLE
≠ CAPABILITY_VERIFIED
≠ RELEASE_ALLOWED
≠ COMMERCIALLY_SUPPORTED
≠ PUBLICATION_READY
```

Each is a separate, individually reported condition. Direct-adapter or installation evidence never implies a
publishing claim: certification is recorded **per capability and per path** (§5), and only evidence on the path the
product pipeline uses counts toward `CAPABILITY_VERIFIED`. For example, Zoho Inventory has installation, runtime and
direct-adapter evidence; its product-pipeline publish evidence is absent, so it is `INSTALLABLE` and not
`PUBLICATION_READY`.

### 4. Every false condition returns a reason

A target is never silently hidden. The server returns each target with `available` and an ordered list of
conditions, each `pass | fail | warn | not_applicable | unknown`, with a stable reason code, a seller-safe message,
the scope, and the evidence reference where one applies. The closed catalog is in the design document; the
mandatory codes include `P1_BLOCKER_HOLD`, `CAPABILITY_NOT_VERIFIED`, `CREDENTIAL_INVALID`, `TARGET_SCHEMA_MISSING`,
`MAPPING_NOT_READY`, `RECERTIFICATION_REQUIRED` and `PRODUCT_NOT_READY`.

### 5. Evidence is data, not an inference

Certification evidence is recorded in a typed, reviewed manifest (a TypeScript module checked in beside the launch
policy, changed only by PR) with one entry per `(connector, capability, path)`:

- `path`: `direct_adapter` (the connector called with its own context) or `product_pipeline` (the export job through
  `MarketplaceService`). Only `product_pipeline` evidence satisfies publication readiness.
- `level`: ADR-0007's states (`untested` … `certified`).
- `evidenceRef`: PR, commit or run reference, `verifiedAt`, `verifiedBy`, and an expiry.
- Evidence becomes `EVIDENCE_EXPIRED` after its window and `RECERTIFICATION_REQUIRED` when ADR-0013's triggers fire
  (schema change at `remap_required` or above).

Minimum `PUBLISH` level on the product-pipeline path by release stage:

| Release stage | Publishable through the product pipeline | Minimum evidence |
|---|---|---|
| `live` | yes | `production_verified` or `certified` |
| `early_access`, `controlled_pilot` | yes, for the tenants the stage allows | `sandbox_verified` |
| `manual` | export only; not a publish target | n/a |
| `code_complete`, `qa_validation`, `po_review` | no (installable for testing) | n/a |
| `p1_blocker_hold` | no | n/a: reason `P1_BLOCKER_HOLD` |
| `planned`, `under_development`, `deprecated`, `internal_diagnostic` | no | n/a |

### 6. Fail closed

- An unknown slug is not publishable (this replaces the launch policy's fail-open default for the purpose of
  publication; the policy's own default is addressed in the first implementation PR).
- Missing evidence, a missing descriptor, or an evaluation that cannot complete yields `unknown`, which makes the
  target unavailable with reason `EVALUATION_UNAVAILABLE`. It never yields available.
- A condition that is a non-blocking concern is `warn` and does not block: `CREDENTIAL_CHECK_INCONCLUSIVE` (the
  provider could not be reached; credentials were not rejected) and `MAPPING_DEPRECATED`.

### 7. Where the channel list comes from

The hardcoded list stops being the publication authority. A single server-side **publication target registry**
derives the targets from the connector registry, the launch policy, the evidence manifest, installations and
mappings, and exposes them as `GET /marketplace/publication-targets` (optionally scoped to a product). The web
consumes that endpoint and deletes its own copy of the list, the slug maps and `isConnectorReadyToPublish`.
`MARKETPLACE_CHANNELS` remains only as what ADR-0006 says it is: Tier-1 mapping-pack membership. It no longer
decides whether a target is publishable.

### 8. Credential, hold and outcome inputs are consumed, not re-derived

| Input | Source | Effect |
|---|---|---|
| Credential state | `connector_installations.status` and `validation.outcome` | `CREDENTIAL_EXPIRED` fails; `CONFIGURATION_ERROR` fails (the target URL is refused); `INDETERMINATE` is `warn`; never validated fails for the connectors that can install blank |
| Release stage | `resolveConnectorLaunchPolicy` | `p1_blocker_hold` fails with `P1_BLOCKER_HOLD`; assignment of a hold is a governance decision recorded outside this ADR |
| Prior outcome | submissions with `PROVIDER_OUTCOME_UNKNOWN` for the product on that installation | `PRIOR_OUTCOME_UNKNOWN`: `warn` by default, `fail` for connectors whose create is classified `AMBIGUOUS_CREATE_OUTCOME` (ADR-0012 taxonomy, #1157), because republishing may duplicate |

## Implementation gate

This ADR is design only. **No Sprint 5 implementation begins until the WooCommerce governance state is recorded**,
because publication eligibility consumes the launch stage and `P1_BLOCKER_HOLD` for WooCommerce is the first live
case. The owners' decisions of 2026-10-05, recorded here as inputs and implemented separately:

- The 2026-10-03 closure (#1052, #1059) is superseded and `p1_blocker_hold` restored for WooCommerce; those events
  are preserved historically and not rewritten.
- Re-closing requires explicit CTO, PO, Security, QA and SRE approval against current evidence and SHA, and
  production RLS evidence (the application/pool role has `BYPASSRLS = false`; whether it owns the tenant tables;
  whether `FORCE ROW LEVEL SECURITY` is active where ownership would otherwise bypass RLS).
- WooCommerce app-auth is not built; manual credential installation is the supported onboarding mechanism, and
  app-auth is unsupported until it is separately approved. `BUG-WOO-OAUTH-QUERY-SECRET` is a hard prerequisite
  before any future app-auth enablement.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Keep the list, add Zoho and the others to it | Repeats the defect: membership still equals authority, and the next connector repeats the argument |
| Derive availability only from `launchStage` | Stage is governance, not evidence; it cannot see credentials, mappings or products, and cannot explain a refusal |
| Store eligibility per tenant in the database | Duplicates state that is derivable and goes stale; evidence needs PR review, which a code manifest gives |
| Compute only a boolean | The seller and the operator cannot act on it; reasons are the point |
| Client-side derivation from several endpoints | That is the present duplicated-rules problem |

## Consequences

**Positive**
- One definition of "publishable", server-side, with a reason for every refusal.
- Tier-2 connectors can become publish targets without code edits to a list, once their evidence exists.
- Evidence expires and is auditable; direct-adapter evidence cannot be mistaken for pipeline evidence.
- The duplicated web and API eligibility rules disappear.

**Negative / cost**
- New code surface (registry, evaluator, manifest) and one new endpoint to keep stable.
- Behavior changes for connectors currently publishable by list membership: they must have manifest entries.
  Rollout is shadow-first (below) so differences are measured before anything changes.
- The product pipeline's job DTOs still validate against `MARKETPLACE_CHANNELS`; widening them for Tier-2 is a
  separate, per-connector, PO-approved step.

**Neutral**
- Connector-level `effectiveAvailability` (ADR-0006) is unchanged and remains an input.

## Rollout

1. **5.1 Backend (shadow).** Registry, evaluator, manifest, `GET /marketplace/publication-targets`. Existing
   behavior is unchanged; a comparison logs any divergence between the derived result and
   `getPublishCapableChannels()`.
2. **5.2 Consumers.** The product page's installed publish lanes and the readiness routes consume the endpoint
   behind a flag; the web's duplicated rules are removed once divergence is zero.
3. **5.3 First Tier-2 candidate (Zoho Inventory), behind a flag and per-connector PO approval.** Requires pipeline
   evidence that does not exist today (a controlled write through the product pipeline, certification, commercial
   support).

## Machine-checkable invariants

| Invariant | Severity |
|---|---|
| Every registered connector declaring `PUBLISH` has a descriptor and a manifest entry for each capability and path (even `untested`) | ERROR |
| `available` implies every condition is `pass`, `warn` or `not_applicable`; none is `fail` or `unknown` | ERROR |
| Reason codes are a closed set; an unknown code fails the build | ERROR |
| An unknown slug evaluates as unavailable | ERROR |
| No web file contains a slug-specific publish-readiness rule | ERROR |
| Evidence past its expiry evaluates as `EVIDENCE_EXPIRED`, never `pass` | ERROR |
| A target whose only evidence is `direct_adapter` evaluates as `CAPABILITY_NOT_VERIFIED` | ERROR |

## Open questions for the owners

1. The minimum `PUBLISH` levels in section 5 and the evidence expiry windows.
2. Which tenants an `early_access` or `controlled_pilot` stage allows (today the code allows all).
3. Who owns the per-connector `commerciallySupported` flag, and its default for connectors already at `early_access`.
4. Whether `PRIOR_OUTCOME_UNKNOWN` should block or warn for connectors whose create is `AMBIGUOUS_CREATE_OUTCOME`.
5. Whether `manual` (export-only) connectors appear as targets with a distinct kind or only as export options.

## Related
- ADR-0006 (identity, state, availability), ADR-0007 (certification evidence), ADR-0008 (target schema registry),
  ADR-0010 (channel projection), ADR-0012 (error taxonomy), ADR-0013 (schema compatibility and recertification),
  ADR-0014 (Tier-1/Tier-2 migration).
- `docs/design/connector-credential-health.md`, `docs/design/connector-write-retry-policy.md`.
- `docs/execution/P1_WOO_AUTH_CURRENT_REBASELINE_2026-10-05.md`.
