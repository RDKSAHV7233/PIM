# Vexa AI Privacy and data-processing decision pack (Stream B, B3)

Date: 2026-10-07
Baseline: `origin/main` at `ec9b166c`
Type: **documentation only.** No provider code, no SDK, no credential, no network path, no change to the payload policy fixture.
Status: **proposal / awaiting human approval.** The recommendations are the author's. **Claude cannot sign for Privacy, Legal or Security.** Only the named owners can record a decision, in section 7 or in a pull request.

## 1. Purpose and how to read this

The first controlled provider call may not send any tenant data until the open Privacy decisions from the AI-PROV-004 investigation (#1170) are recorded. This pack turns them into eleven decisions (section 2), maps every category of Vexa data to `AI_ALLOWED`, `AI_ALLOWED_WITH_REDACTION` or `AI_BLOCKED` (section 3), states the redaction and audit requirements (sections 4 and 5), and records two Vexa-side gaps found while preparing it (section 6).

**Source labels.** *Vexa fact* is checked against code or a fixture on `main`. *Investigation claim* is a statement about the provider recorded in `ai-prov-004-investigation-2026-10-05.md` from the provider's published pages on 2026-10-05; **it has not been re-verified here and is not the signed agreement**. Privacy and Legal must confirm every investigation claim against the contract before relying on it.

**Principle that does not change:** the default is deny. Anything not listed as allowed in `test-fixtures/ai-policy/provider-payload-policy.v1.json` is `AI_BLOCKED` (`AiTenantPolicy.defaultClassification` defaults to `AI_BLOCKED` in the schema). The map in section 3 is a proposal for what the policy *could* allow per capability later; it does not add an allowed field. Secrets and credentials remain blocked in every case.

## 2. The eleven decisions

| # | Decision | Known (label) | Proposed | Owner | Evidence needed before signing |
|---|---|---|---|---|---|
| P1 | **Data processing agreement** | Investigation claim: commercial customers are the data controller, the provider the processor | Execute the provider's DPA before any tenant data leaves Vexa; no request with real tenant data until it is on file | Privacy + Legal | the signed DPA, with its date, in the compliance record |
| P2 | **Zero data retention (ZDR)** | Investigation claim: standard retention is automatic deletion within 30 days; ZDR is available by arrangement and does not apply to every feature | Request ZDR **before** real tenant data; synthetic data only until it is confirmed in writing | Privacy + Security | written ZDR confirmation naming the endpoint and features used; if ZDR is unavailable for the chosen feature, a recorded risk acceptance for 30-day retention |
| P3 | **Provider training use** | Vexa fact: `allowModelTraining` defaults to `false` (schema, `AiTenantPolicy`). Investigation claim: the provider does not train on commercial API inputs or outputs by default | Keep `allowModelTraining = false`; treat any change as a Privacy decision, never a configuration tweak; obtain the training-use statement in the DPA | Privacy | the DPA clause |
| P4 | **Inference geography** | Investigation claim: inference can be restricted to US-only infrastructure, at a price premium for current models. Vexa fact (memory record, Railway): the API runs in us-west2 | Decide whether tenants require a pinned region; for the pilot, pin to the single region the DPA names and record it in `providerRegion` on every execution | Privacy + CTO | the DPA's region terms; the per-tenant region requirement (if any) |
| P5 | **Storage geography** | Investigation claim: workspace data at rest is US | Accept only if no tenant has a contractual non-US data-at-rest requirement; otherwise block that tenant from AI enablement | Privacy + Legal | list of tenants with a residency clause (none known to this pack; a human must check) |
| P6 | **Subprocessors** | Not decided. The provider becomes a subprocessor of Vexa | Update the subprocessor disclosure and the tenant notice **before** enabling any tenant; per-tenant enablement (`approvedBy`, `approvedAt`) is the consent record | Privacy + Legal | published subprocessor list diff; tenant notice text; the first enabled tenant's recorded approval |
| P7 | **Deletion and retention** | Vexa fact: `retentionDays` exists on the tenant policy (default `0`); its semantics are unconfirmed (carried open from #1170). Vexa fact: account deletion removes a user's MFA enrollment and auth identity only (section 6, G2) | Define retention for `AiExecution` and `AiSuggestion` rows and for the provider side; confirm `retentionDays` semantics; add the AI tables to the tenant deletion and export procedure | Privacy + Backend | a written retention schedule; a deletion test that proves AI rows for a deleted tenant are removed |
| P8 | **Allowed product-data classes** | Vexa fact: the fixture allows `product.title`, `description`, `brand`, `categoryPath`, `attributes.*`, `supplierSpecifications.*`, `media.altText` | For the **first** capability only (`product_attribute_extraction`) send exactly those; nothing else (section 3) | Security + PIM SME | the unchanged policy fixture and the first-capability field list |
| P9 | **Blocked data** | Vexa fact: customer email and phone, auth password, connector credentials, billing card number, tenant internal key are `AI_BLOCKED`; the default is blocked | Confirm the blocked list and that **secrets stay blocked with no override** | Privacy + Security | the fixture and the 4 of 4 blocked-payload result in FAST |
| P10 | **Redaction requirements** | Vexa fact: `product.internalNotes` and `supplier.contactEmail` are `AI_ALLOWED_WITH_REDACTION` with required redaction and evidence in `redactedFields` | Do **not** send either in the first increment (data minimisation: neither is needed for extraction); keep the redaction mechanism for later capabilities | Privacy + Security | the first-capability field list excludes both |
| P11 | **Audit requirements** | Vexa fact: `AiExecution` records provider, model, version, region, request id, token counts, cost, hashes; raw payload storage is forced off | Confirm the audit record in section 5 is sufficient for a data-subject or tenant inquiry | Privacy + Security | a worked example of reconstructing "what was sent for entity X" from hashes and the policy version |

## 3. Data classification map (category level)

This map covers every one of the 76 Prisma models, grouped by what the data is. **Current** is what the policy fixture and runtime default do today. **Proposed class** is what Privacy should confirm. Where the proposal is `AI_ALLOWED` or `AI_ALLOWED_WITH_REDACTION` but the first capability does not need it, the field stays blocked until a later capability and a policy change say otherwise.

| Group (models) | Contents | Current | Proposed class | Note |
|---|---|---|---|---|
| Product core text (`Product.title`, `description`, `brand`; `Category` name/path) | catalog facts | allowed (title, description, brand, categoryPath) | **AI_ALLOWED** | the extraction source |
| Product attributes (`Product.attributes`; `AttributeDefinition`) | typed attribute values | allowed (`attributes.*`) | **AI_ALLOWED** | free-text values can still hold personal data (section 6, G1) |
| Supplier specifications | supplier-provided specs | allowed (`supplierSpecifications.*`) | **AI_ALLOWED** | same caveat |
| Media alt text (payload path `product.media.altText`; not a `MediaAsset` column) | text | allowed | **AI_ALLOWED** | binary media, URIs and file names are not text sources |
| Media binary, URIs, file names, integrity scans (`MediaAsset`, `MediaIntegrityScan*`) | files and locations | default blocked | **AI_BLOCKED** | objects in arrays are blocked since AI-POL-002 |
| Variants (`Variant`) | SKU, options, variant text | default blocked | **AI_ALLOWED_WITH_REDACTION** (later capability) | blocked in the first increment |
| Translations (`ProductTranslation`, `CategoryTranslation`) | translated catalog text | default blocked | **AI_ALLOWED** (translation capability only) | same content class as the source text |
| Tax codes and rates (`Product.hsnCode`, `gstRate`; `TaxRegime`, `ProductTaxCode`) | public tax classification | default blocked | **AI_ALLOWED** (later capability) | not personal; not needed for extraction |
| Prices and markets (`ProductPrice`, `PriceList`, `Market`, `Currency`; `Product` vendor scope) | commercial data | default blocked | **AI_BLOCKED** | commercially sensitive; the product read path already redacts vendor scope and pricing for unprivileged actors (AI-POL-001) |
| Internal notes (`product.internalNotes`) | free text by staff | allowed with redaction (policy) | **AI_ALLOWED_WITH_REDACTION** | **excluded from the first increment** (P10) |
| Supplier contact (`supplier.contactEmail`) | personal data of a supplier contact | allowed with redaction (policy) | **AI_ALLOWED_WITH_REDACTION** | **excluded from the first increment** (P10) |
| Workflow and review text (`ApprovalComment`, `ChangeRequest`, `WorkflowSla`, `ValidationIssue`) | free text by users, user ids | default blocked | **AI_ALLOWED_WITH_REDACTION** (later, if ever) | blocked now; contains user-authored text and ids |
| Product relationships (`ProductRelationship`) | links between products | default blocked | **AI_ALLOWED** (later capability) | identifiers only |
| Bulk import/edit/publish (`BulkImport*`, `BulkEdit*`, `MarketplaceBulkPublish*`, `BulkImportTemplate`, `ChannelMappingTemplate`, `MarketplaceExportJob`) | raw uploaded rows, mappings, job state | default blocked | **AI_BLOCKED** | raw rows can contain anything a supplier uploaded |
| Customers (`customer.*`) | customer email, phone, PII | blocked | **AI_BLOCKED** | out of scope for product intelligence |
| Identity and access (`AuthIdentity`, `ApiAccessKey`, `UserMfaEnrollment`, `UserMfaBackupCode`, `AuthRecoveryToken`, `TenantAuthPolicy`, `OidcConfig`, `AccessScopeAssignment`, `PublicSignupRequest`) | users, credentials, MFA, recovery tokens | `auth.password` blocked; rest default blocked | **AI_BLOCKED** | secrets: no override ever |
| Connector secrets (`ConnectorCredential`, `connector.apiKey`, `accessToken`, `refreshToken`, `webhookSecret`) | marketplace and store credentials | blocked | **AI_BLOCKED** | secrets: no override ever |
| Connector operations (`ConnectorInstallation`, `ConnectorDefinition`, `ConnectorTenantEntitlement`, `ConnectorSubmission`, `ConnectorWebhookEvent`, `ConnectorMapping*`, `ConnectorPermission`, `ConnectorProductSyncState`, `ConnectorSyncSchedule`, `ConnectorProductLink`, `OutboundWebhook*`) | store domains, remote ids, payloads | default blocked | **AI_BLOCKED** | may carry store identifiers and remote payloads |
| Billing and commercial (`billing.cardNumber`; `StripeWebhookEvent`, `TenantCommercialRequest`, `PlanLimits`, `PlanUsage`, `TenantPlanProfile`) | payment and plan data | card number blocked; rest default blocked | **AI_BLOCKED** | |
| Tenant and workspace identity (`tenant.internalKey`, `WorkspaceDirectory`) | tenant keys and names | blocked | **AI_BLOCKED** | operational identifiers must not reach a provider |
| Privacy and account lifecycle (`AccountConsentEvent`, `AccountExportRequest`, `AccountDeletionRequest`) | consent and data-subject requests | default blocked | **AI_BLOCKED** | |
| Audit and telemetry (`AuditLog`, `KpiMetricEvent`, `DashboardSnapshot`, `OpsAlertState`, `UserNotification`) | actor ids, actions, metrics | default blocked | **AI_BLOCKED** | |
| AI control plane (`AiExecution`, `AiSuggestion`, `AiTenantPolicy`, `AiProviderBudget*`, `AiPlatformControl`, `AiPlatformBudgetPeriod`) | governance records and model output | default blocked | **AI_BLOCKED** (never sent back as input) | output is stored by hash and suggestion value; see section 5 |

**First-capability field list (proposal for P8 and P10):** `product.title`, `product.description`, `product.brand`, `product.categoryPath`, `product.attributes.*`, `product.supplierSpecifications.*`, `product.media.altText`. Everything else is blocked.

## 4. Redaction requirements (proposed)

1. **Allow-list assembly.** The prompt is built from named fields only and never serialises a whole payload object (design, 004b).
2. **Fingerprint re-check.** The adapter recomputes the payload fingerprint from what it was handed and refuses on mismatch, so a code path that skipped the dry-run cannot reach the provider (design).
3. **Last-line credential check.** The FREE_TEXT credential check (AI-POL-003) is re-applied to the final serialised prompt (design). It detects credentials only; it does **not** detect personal data (G1).
4. **Redaction evidence.** Any `AI_ALLOWED_WITH_REDACTION` field must carry `redactedFields` evidence before it can be sent; none is sent in the first increment.
5. **No raw storage.** `allowRawPayloadStorage` stays forced `false`; only hashes are stored.
6. **Synthetic data until P1, P2 and P6 are recorded.** No tenant data reaches any provider before the DPA, the ZDR decision and the subprocessor disclosure.

## 5. Audit requirements (proposed)

For every call, retained for the period set under P7: tenant key; capability; provider key; model key and version; provider region; provider request id; policy version; payload hash and fingerprint (never the payload); attempt number; estimated and actual cost with cost source and pricing version; token counts; finish status and normalised error class; the gate that denied, if any; and the tenant policy's `approvedBy` and `approvedAt`. Required capability: reconstruct, for a given entity and date, **which fields were sent** (by policy version and hash), **to which provider, model and region**, under **which tenant approval**, without storing the content. Privacy should confirm that a hash plus policy version is an acceptable substitute for content in a data-subject inquiry (P11).

## 6. Vexa-side gaps found while preparing this pack

| # | Gap | Evidence | Effect | Proposed action |
|---|---|---|---|---|
| G1 | **No personal-data detection on allowed free text.** The detector covers credentials only. A supplier note that carries a phone number or email inside `description` or an `attribute` value would be sent. The only personal-data protection is the structured blocked paths (`customer.*` etc.) and the two redactable fields, which are excluded. | detector list in `intelligence-secret-detection.ts` (credential detectors only); policy fixture | personal data typed into an allowed free-text field is not caught | Privacy decides: a personal-data check on free text before real tenant data, or a recorded risk acceptance backed by ZDR (P2) and the synthetic-data-only rule for the pilot |
| G2 | **AI tables are not part of any deletion path found.** Account deletion deletes a user's MFA enrollment and auth identity only; no reference to `AiExecution` or `AiSuggestion` exists in the deletion worker. `retentionDays` semantics are unconfirmed. `AiSuggestion` holds suggested values and evidence derived from product text. | `account-deletion-worker.service.ts` (`executeAccountDeletion`); schema | no defined removal of AI rows when a tenant or product is deleted | decide the retention schedule (P7), then a small Backend change plus a deletion test (a Stream B implementation task only after the Stream A boundary signal, because it touches tenant-scoped runtime code) |

## 7. Sign-off block (blank; for the named owners only)

| # | Decision | Decision (`APPROVE` / `APPROVE_WITH_CONDITIONS` / `REWORK`) | Conditions or notes | Owner (name, date) |
|---|---|---|---|---|
| P1 | DPA | [ ] | | |
| P2 | Zero data retention | [ ] | | |
| P3 | Training use | [ ] | | |
| P4 | Inference geography | [ ] | | |
| P5 | Storage geography | [ ] | | |
| P6 | Subprocessors and tenant notice | [ ] | | |
| P7 | Deletion and retention | [ ] | | |
| P8 | Allowed data classes (first capability) | [ ] | | |
| P9 | Blocked data (secrets stay blocked) | [ ] | | |
| P10 | Redaction | [ ] | | |
| P11 | Audit | [ ] | | |
| G1 | Personal data in free text | [ ] | | |
| G2 | AI data deletion and retention | [ ] | | |

## 8. What this pack does not do

It records no decision and signs nothing. It does not change `provider-payload-policy.v1.json`, any detector, any default, any tenant policy or any budget. It does not send, and does not authorise sending, any data to any provider. It does not re-verify provider claims; those remain investigation claims until the contract says so. The kill-switch drill and the first provider call remain held.
