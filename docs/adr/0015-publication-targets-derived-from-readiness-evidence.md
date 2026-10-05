# ADR-0015: Publication Targets Are Derived From Readiness Evidence

**Status**: Accepted (owner decisions of 2026-10-05 applied; contract verified on `main`; implementation gated on `docs/decisions/DR-2026-10-05-woocommerce-p1-governance.md`)
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
AND the capability has current evidence on the       (pipeline certification at or above the minimum for the
    path the product pipeline uses                    release stage, before its reverify-by date)
AND release is allowed                               (launch stage permits publishing; not p1_blocker_hold;
                                                      this tenant is in the stage's explicit cohort)
AND commercial support is recorded                   (Product Owner approval, per connector; default false)
AND installation is eligible                         (exists, ACTIVE, authorization complete)
AND credential state is acceptable                   (last trustworthy state is VALID and fresh; see section 8)
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
- `evidenceRef`, `verifiedAt`, `verifiedBy` (a role or team), and **`reverifyBy`**.
- **`reverifyBy` is authoritative.** There is no single global age. A policy default **by evidence level** is applied
  when the entry is created (`sandbox_verified` +30 days, `production_verified` +30 days, `certified` +90 days), and
  an explicit shorter date set by certification or security policy wins. The entry then carries its own date. Past `reverifyBy`, or when ADR-0013's triggers fire (schema
  change at `remap_required` or above), the capability evaluates as `RECERTIFICATION_REQUIRED`.

Minimum `PUBLISH` level on the **product-pipeline** path by release stage (owner decision, 2026-10-05):

| Release stage | Publishable through the product pipeline | Minimum pipeline evidence |
|---|---|---|
| `live` | yes | `certified` |
| `early_access` | yes, for the explicit cohort only | `production_verified` or higher |
| `controlled_pilot` | yes, for the explicit allowlist only | `sandbox_verified` or higher |
| `manual` | no (see section 7: export-only) | n/a |
| `code_complete`, `qa_validation`, `po_review` | no (installable for testing) | n/a |
| `p1_blocker_hold` | no | n/a: reason `P1_BLOCKER_HOLD` |
| `planned`, `under_development`, `deprecated`, `internal_diagnostic` | no | n/a |

**Tenant cohorts (owner decision):**
- `controlled_pilot`: an **explicit named tenant allowlist** only.
- `early_access`: an **explicit opted-in or entitled cohort** only. Never every tenant on a plan automatically.
- `live` has no release-stage cohort restriction, but every other readiness gate still applies.
- Cohort membership is a first-class **control-plane tenant entitlement record** (section 9), never a hardcoded list,
  a subscription plan, or UI state.
- A tenant outside the cohort gets `RELEASE_RESTRICTED`. Today the code does not restrict by tenant at either stage;
  introducing the cohort is a behavior change, handled in shadow first (Rollout).

**Commercial support (owner decision):** the `commerciallySupported` flag is owned by the **Product Owner**, who is
accountable for it. Technical teams supply evidence; Support and SRE supply readiness input. It is recorded with
an approval reference, defaults to false, and is never derived from the adapter's existence.

### 6. Fail closed

- **An unrecognized connector never defaults to `live`.** The launch policy's fallback for an unknown slug becomes a
  non-installable, non-publishable stage. This is a change to the policy itself (first change in 5.1), not only to
  publication.
- Missing evidence, a missing descriptor, or an evaluation that cannot complete yields `unknown`, which makes the
  target unavailable with reason `EVALUATION_UNAVAILABLE`. It never yields available.
- Only a concern that does not make another publish unsafe is a `warn` (section 8).

### 7. Where the channel list comes from, and export-only connectors

The hardcoded list stops being the publication authority. A single server-side **publication target registry**
derives the targets from the connector registry, the launch policy, the evidence manifest, installations and
mappings, and exposes them as `GET /marketplace/publication-targets` (optionally scoped to a product). The web
consumes that endpoint and deletes its own copy of the list, the slug maps and `isConnectorReadyToPublish`.
`MARKETPLACE_CHANNELS` remains only as what ADR-0006 says it is: Tier-1 mapping-pack membership. It no longer
decides whether a target is publishable.

**Export-only connectors do not appear as selectable publication targets** (owner decision). They belong on the
capability-specific export surfaces. Admin and diagnostic output (`?diagnostic=true`, admin roles) may still list
them with the reason `PUBLISH_NOT_DECLARED`, so the question "why can't I publish here?" has an answer.

### 8. Credential, mapping, hold and outcome inputs are consumed, not re-derived

**Credential state uses the last trustworthy state** (owner decision), so the truthful heartbeat is honored without
letting an installation that has never shown usable credentials become publishable:

| Last known facts | Result | Code |
|---|---|---|
| Recent `VALID`, then a later `INDETERMINATE` | **warn**; publication may continue (the provider was unreachable; the credentials were not rejected) | `CREDENTIAL_CHECK_INCONCLUSIVE` |
| Never `VALID` | **unavailable** | `CREDENTIAL_NEVER_VALIDATED` |
| Last `VALID` older than the credential freshness policy | **unavailable** | `CREDENTIAL_STALE` |
| `INVALID` (status `CREDENTIAL_EXPIRED`) | **unavailable** | `CREDENTIAL_INVALID` |
| `CONFIGURATION_ERROR` (the target URL is refused) | **unavailable** | `CREDENTIAL_CONFIGURATION_ERROR` |

**Credential freshness is derived from the heartbeat's rotation capacity, never a fixed number:**

```
heartbeatMaxRotation     = the maximum supported time for every eligible installation to receive one
                           validation attempt (the heartbeat checks 50 per tick, oldest attempt first, so it
                           grows with installation count)
credentialFreshnessWindow >= 2 x heartbeatMaxRotation + one scheduler interval
```

5.1 exposes and monitors `heartbeatMaxRotation`. If installation volume outgrows what the configured window
implies, that is an **operational capacity failure** to be alerted and fixed; it is not a reason to declare healthy
credentials stale silently.

**`TOKEN_ONLY` is a credential type, not a health result.** A stored token is not `VALID`. A credential counts as
`VALID` for publication only when the verifier has authenticated it against the provider. Today the amazon-in and
flipkart verifiers can record `VALID` with reason `TOKEN_ONLY` on a held, unexpired token with no provider call
(#1144). That record does **not** satisfy this condition: it evaluates `CREDENTIAL_NOT_PROVIDER_VERIFIED` until
those verifiers authenticate against the provider.

**Mapping.** `compatible` passes. `deprecated` is a **warn** only while the published mapping is still compatible
(`MAPPING_DEPRECATED`). `remap_required` and `blocked` make the target unavailable (`MAPPING_NOT_READY`), as
`evaluateMappingPreflight()` already treats them (ADR-0013).

**Release stage.** `p1_blocker_hold` fails with `P1_BLOCKER_HOLD`. Assigning a hold is a governance decision recorded
outside this ADR.

**Prior provider outcome** (Sprint 3 made this visible; this makes it count): a submission for the product on that
installation recorded as `PROVIDER_OUTCOME_UNKNOWN` produces `PRIOR_PROVIDER_OUTCOME_UNKNOWN`.
- For an operation whose duplicate or side-effect semantics make another publication unsafe (a create classified
  `AMBIGUOUS` in `docs/design/connector-write-retry-policy.md`: Odoo, Etsy, Dynamics 365), it **blocks** another
  create for the same installation and product **until the outcome is reconciled**.
- It is a **warn** only for operations proven idempotent or reconciliation-safe (WooCommerce and BigCommerce creates).
- The block needs a way to settle an outcome (an operator action after checking the channel, or a later successful
  attempt). That action does not exist yet; until it does, 5.1 reports the condition in shadow and does not enforce
  it, so the block cannot become permanent.

### 9. Tenant entitlements and outcome settlement

**Tenant entitlement (control plane).** One record per grant; the evaluator reads it for the release condition.

```
ConnectorTenantEntitlement
  tenant, connector, releaseStage
  validFrom, validUntil?            (optional expiry)
  approvedBy, approvedAt, reason, source
  revokedAt?
```

- `controlled_pilot`: Product or Operations explicitly grants a named tenant.
- `early_access`: the tenant explicitly opts in **and** the entitlement is recorded. No automatic plan-wide
  enrollment.
- `live`: no release-stage cohort restriction.
- Grants and revocations are auditable events; an expired or revoked entitlement evaluates `RELEASE_RESTRICTED`.

**Unknown-outcome settlement.** `PRIOR_PROVIDER_OUTCOME_UNKNOWN` is not enforced until a settlement exists. A
settlement is an **append-only resolution event linked to the original submission**; the historical submission is
never rewritten. It records the actor, timestamp, evidence source, reason, provider identifiers and correlation
ids, and resolves the outcome to exactly one of:

```
UNKNOWN -> reconciliation / authorized investigation -> CONFIRMED_SUCCEEDED
                                                     or CONFIRMED_NOT_APPLIED
                                                     or SUPERSEDED
```

There is no generic "Dismiss" action. Only a resolution event clears the block.

## Owner decisions recorded 2026-10-05

These were given by the owners on 2026-10-05 and are applied above:

| Topic | Decision |
|---|---|
| Minimum `PUBLISH` evidence | `controlled_pilot`: pipeline `sandbox_verified`+; `early_access`: pipeline `production_verified`+; `live`: pipeline `certified` |
| Evidence freshness | `reverifyBy` is authoritative; policy defaults set at creation; expired evidence is `RECERTIFICATION_REQUIRED` |
| `controlled_pilot` tenants | Explicit named tenant allowlist only |
| `early_access` tenants | Explicit opted-in or entitled cohort only; never all tenants on a plan automatically |
| `commerciallySupported` | Product Owner accountable; technical teams give evidence; Support and SRE give readiness input; not derived from adapter existence |
| Prior unknown outcome | Block another ambiguous create for the same installation and product until reconciled; warn only for operations proven idempotent or reconciliation-safe |
| Export-only connectors | Not selectable publication targets; capability-specific export surfaces; diagnostic output may explain `PUBLISH_NOT_DECLARED` |
| Unknown connector launch policy | Fail closed; never default an unrecognized slug to `live` |
| Credential health | Last trustworthy state, as in section 8 |
| Mapping `deprecated` | Warn only while the published mapping is compatible; `remap_required` and `blocked` make the target unavailable |
| Evidence `reverifyBy` defaults | Policy defaults by level: `sandbox_verified` +30d, `production_verified` +30d, `certified` +90d; an explicit shorter date wins |
| Credential freshness | `>= 2 x heartbeatMaxRotation + one scheduler interval`; `heartbeatMaxRotation` is exposed and monitored; outgrowing it is a capacity failure |
| Cohort storage | Control-plane tenant entitlement records; explicit and auditable; never plan, hardcoded list or UI state |
| `TOKEN_ONLY` | A credential type, not a health result; `VALID` only after successful provider authentication |
| Outcome settlement | Required before enforcement; append-only resolution event linked to the submission; no generic Dismiss |

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
- Behavior changes for connectors currently publishable by list membership: they must have manifest entries,
  `early_access` now requires `production_verified` pipeline evidence, and `early_access` and `controlled_pilot`
  require an explicit tenant cohort (none is enforced today). Existing installations whose credential facts are
  empty are unavailable until the next heartbeat records `VALID`. Rollout is shadow-first (below) so every
  difference is measured before anything changes.
- **Amazon and Flipkart**: their `TOKEN_ONLY` `VALID` records are not provider verification, so both evaluate
  `CREDENTIAL_NOT_PROVIDER_VERIFIED` until their verifiers authenticate against the provider. Flipkart is `live`, so
  this must be resolved before enforcement, not discovered by it; the shadow report will show it.
- The product pipeline's job DTOs still validate against `MARKETPLACE_CHANNELS`; widening them for Tier-2 is a
  separate, per-connector, PO-approved step.

**Neutral**
- Connector-level `effectiveAvailability` (ADR-0006) is unchanged and remains an input.

## Rollout

Two phases are kept strictly apart.

**5.1 SHADOW** (no customer-facing change):
```
derivePublicationTargets()
  -> calculate every condition
  -> emit availability and reason codes
  -> compare with today's behavior and log divergence
  -> NO change to what any customer can publish
  -> PRIOR_PROVIDER_OUTCOME_UNKNOWN reported only
  -> expose and monitor heartbeatMaxRotation
```

**ENFORCEMENT** (later, a separate decision) only after all of:
- PR G (the WooCommerce governance state) is authoritative on `main`;
- the evidence inventory exists;
- tenant entitlement records exist for every connector at `early_access` or `controlled_pilot`;
- Product Owner commercial-support records exist;
- the credential freshness policy is operationally supportable (`heartbeatMaxRotation` within bounds);
- the Amazon and Flipkart verifiers authenticate against the provider;
- outcome settlement exists wherever blocking is required.

This separation matters because the stricter contract will legitimately classify some currently selectable
connectors as unavailable.

Order of work:
0. **PR G.** WooCommerce governance record and `p1_blocker_hold` restored; governance only.
1. **5.1 (shadow).** Launch-policy fail-closed default for an unknown slug, registry, evaluator, manifest, entitlement
   model, `GET /marketplace/publication-targets`, the divergence comparison, the rotation metric.
2. **5.2 Consumers**, behind a flag, once the shadow divergence is understood; the web's duplicated rules are removed
   only after that.
3. **5.3 First Tier-2 candidate (Zoho Inventory)**, behind a flag and per-connector Product Owner approval; requires
   pipeline evidence that does not exist today.
4. **Enforcement**, after the list above.

## Machine-checkable invariants

| Invariant | Severity |
|---|---|
| Every registered connector declaring `PUBLISH` has a descriptor and a manifest entry for each capability and path (even `untested`) | ERROR |
| `available` implies every condition is `pass`, `warn` or `not_applicable`; none is `fail` or `unknown` | ERROR |
| Reason codes are a closed set; an unknown code fails the build | ERROR |
| An unknown slug evaluates as unavailable, and the launch policy never resolves an unknown slug to `live` | ERROR |
| No web file contains a slug-specific publish-readiness rule | ERROR |
| Evidence past its `reverifyBy` evaluates as `RECERTIFICATION_REQUIRED`, never `pass` | ERROR |
| A target whose only evidence is `direct_adapter` evaluates as `CAPABILITY_NOT_VERIFIED` | ERROR |
| A target with no installation fact of `VALID` (never validated) is unavailable | ERROR |
| `commerciallySupported` is false unless a Product Owner approval reference is recorded | ERROR |
| `credentialFreshnessWindow >= 2 x heartbeatMaxRotation + one scheduler interval`; `heartbeatMaxRotation` is exposed | ERROR |
| A `VALID` fact whose reason is `TOKEN_ONLY` does not satisfy the credential condition | ERROR |
| `PRIOR_PROVIDER_OUTCOME_UNKNOWN` is enforced only where an outcome-settlement path exists; otherwise shadow-only | ERROR |

## Remaining implementation details (not open policy)

These are decided in principle above and are settled in 5.1 by the owners reviewing the generated inventory, not by
reopening this ADR: the exact seeded entitlement records, the exact credential freshness value computed from the
measured `heartbeatMaxRotation`, and the strengthening of the amazon-in and flipkart verifiers.

## Related
- ADR-0006 (identity, state, availability), ADR-0007 (certification evidence), ADR-0008 (target schema registry),
  ADR-0010 (channel projection), ADR-0012 (error taxonomy), ADR-0013 (schema compatibility and recertification),
  ADR-0014 (Tier-1/Tier-2 migration).
- `docs/design/connector-credential-health.md`, `docs/design/connector-write-retry-policy.md`.
- `docs/execution/P1_WOO_AUTH_CURRENT_REBASELINE_2026-10-05.md`.
