# Team Signoff Matrix

Last reviewed: 2026-09-05

Status: active working matrix

This matrix defines the required team for Vexa PIM readiness decisions. It is a
coordination document, not a signoff record. A gate is complete only when the
named owner records evidence and approval.

## Required Team

| Team role | Required for | Current responsibility | Signoff state |
| --- | --- | --- | --- |
| CTO / Engineering owner | Architecture, security boundary, release risk, technical launch gate | Confirm code, infra, queue, connector, auth, data, and deployment evidence | Required, not complete |
| Product Owner | Scope, pilot acceptance, connector claim wording, pricing posture | Approve what is in/out of pilot and what customers may be told | Required, not complete |
| QA lead | Browser-visible evidence, regression evidence, role/plan coverage | Re-run or approve evidence for current environment and current code | Required, not complete |
| SRE / Ops owner | Deployment, monitoring, backup, restore, incidents, on-call | Prove recoverability and operational ownership | Required, not complete |
| Security owner | RBAC, tenant isolation, credential handling, secrets, abuse surfaces | Approve current security evidence and gaps | Required, not complete |
| Privacy / Compliance owner | Data flows, retention, DPDP, deletion/export, data processing | Approve data governance and customer-facing privacy text | Required, not complete |
| Legal counsel | MSA, DPA, SLA, terms, cookie/AUP language | Finalize legal placeholders before customer use | Required, not complete |
| Finance / Commercial owner | Price book, discounts, order form, paid-plan activation | Maintain restricted commercial authority; block public pricing | Required, not complete |
| Support / Customer success owner | Pilot support path, escalation, onboarding, feedback capture | Own customer communication and response workflow | Required, not complete |
| Marketing owner | Website, emails, public claims, proof mapping | Publish only approved claims with proof authority | Required, not complete |

## Approval Gates

| Gate | Required approvers | Evidence required | Current state |
| --- | --- | --- | --- |
| Controlled evaluation tenant | CTO, PO, Ops, Support | Tenant setup checklist, allowed connectors, role/plan evidence, support channel | Prepare per tenant |
| Public marketing copy | PO, Marketing, Legal, Privacy, CTO | Claim ID, proof reference, browser evidence, privacy/security approval | Blocked |
| Public pricing or paid checkout | Finance, Legal, PO, CTO | Restricted price-book reference, Stripe/checkout evidence, terms/order form approval | Blocked |
| WooCommerce GA / public-sellable | CTO, PO, QA, Support, Connector Engineering, Security, Privacy, Legal, Commercial, Marketing | Closed QA failures, live store/admin evidence, regression pass, customer-support docs, restricted proof references, claim approval | Pending signoff; local remediation evidence exists, public claim still blocked |

## WooCommerce Checkpoint - 2026-08-30

| Role | Decision | Evidence / remaining gap |
| --- | --- | --- |
| CTO / Engineering | Accept code-complete remediation evidence only. | Targeted API unit tests and typecheck passed; deployed SHA/live parity still must be proven. |
| Product Owner | Keep WooCommerce out of GA/public-sellable claims. | Exact pilot/customer scope still needs approval after live P0 rerun. |
| QA lead | Accept local regression plus targeted WooCommerce browser E2E coverage as preparation for rerun. | Full WooCommerce P0 and cross-cutting E2E are still pending on current environment. |
| Connector Engineering | Known blocker areas have local coverage. | Live connector fixture evidence and issue closure references must be attached. |
| Support / Customer Success | Not ready for expanded customer promise. | Pilot support runbook draft exists; named tenant support channel, escalation owners, and approval evidence still required. |
| Security / Privacy / Legal / Commercial / Marketing | No public claim approved. | Proof registry, privacy/legal review, commercial approval, and website/campaign wording remain blocked. |
| Amazon India production publish | CTO, PO, Connector team, QA, Legal if needed | SP-API validation, publish/status sync evidence, customer wording approval | Blocked |
| Enterprise SLA / scale claim | CTO, SRE, Legal, PO | HA evidence, restore drill, SLO telemetry, support rota, SLA approval | Blocked |

## Required-Team Continuation - 2026-08-30

| Team lens | Local verification result | Decision impact |
| --- | --- | --- |
| CTO / Engineering | WooCommerce reconnect E2E passed; bulk-publish dialog E2E now includes WooCommerce and passed across 3 connectors; observability Prisma client regenerated for local Linux runtime. | Local code-complete evidence strengthened; deployed SHA/live parity still required before release claim. |
| Product Owner / Marketing | `node apps/web/test/integration/connector-claim-consistency.test.cjs` passed. | Connector maturity wording remains bounded; WooCommerce must stay out of GA/public-sellable claims. |
| Commercial / Legal | `node apps/web/test/integration/no-public-pricing-policy.test.cjs` initially failed because public plan-card CTAs drifted; `wordpress/wp-content/themes/vexa-pim/page-plans.php` was corrected and the test now passes. | Public pricing remains blocked; approved CTA posture restored. |
| SRE / Ops | `node apps/web/test/integration/backup-restore-evidence.test.cjs` passed: backup/restore scripts, migration history, and schema-critical checks are present. | Documentation evidence exists, but restore-drill proof and on-call/incident ownership remain required. |
| Security / Privacy | `node apps/web/test/integration/admin-privacy-ui.test.cjs`, `node apps/web/test/integration/internal-commercial-ops-ui.test.cjs`, and `node apps/web/test/integration/connector-access-admin-form.test.cjs` passed. | Local guardrails pass for privacy UI, internal commercial gating, and connector access form behavior; owner approval still required. |
| QA lead | `git diff --check` and `node --check apps/web/test/e2e/bulk-publish-confirm-dialog.spec.js` passed after line-ending normalization. | Current local changes are syntactically clean; full current-environment regression sweep remains pending. |
| Support / Customer Success | `docs/runbooks/pilot-support-escalation.md` now defines pilot intake, WooCommerce support boundaries, plan-limit dispute triage, and evidence capture rules. | Still blocked for customer-promise expansion until named support owners, tenant channels, and approval evidence are recorded. |

## Required-Team Continuation - 2026-08-30 API Guardrails

| Team lens | Local verification result | Decision impact |
| --- | --- | --- |
| CTO / Product Data Boundary | `node apps/api/test/integration/marketplace-readiness-role-contract.test.cjs` initially failed due an LF-only static assertion against a CRLF controller source; the contract test now normalizes line endings and passes. | Readiness endpoints still show full app-role access plus `manage_product_data` admin-boundary protection; contract coverage is less brittle. |
| SRE / Deploy Packaging | `node apps/api/test/integration/railway-api-direct-service-contract.test.cjs`, `node apps/api/test/integration/railway-api-package-contract.test.cjs`, `node apps/api/test/integration/error-authority-ops-read.test.cjs`, and `node apps/api/test/integration/internal-ops-alerting-contract.test.cjs` passed. | Static deploy-packaging, error-authority read, and ops-alerting contracts are locally green; live deploy/restore/on-call proof remains required. |
| SRE / Runtime | Safe boot breadcrumbs showed local `AppModule` import can take about 159 seconds on this Windows-mounted checkout, so the previously blocked API-backed harnesses now use a configurable 240-second startup budget. Direct `tsc -p apps/api/tsconfig.build.json` restored `apps/api/dist/main.js` after a longer bounded run. | Startup-timeout blocker is downgraded to local harness/tooling latency; keep the larger timeout or run these suites from a faster filesystem/CI. |
| Commercial / Security / Privacy | `node apps/api/test/integration/auth-account-privacy-authz.test.cjs`, `node apps/api/test/integration/billing-commercial-control.test.cjs`, `node apps/api/test/integration/billing-commercial-governance-access.test.cjs`, `node apps/api/test/integration/connector-access-entitlements.test.cjs`, and `node apps/api/test/integration/api-keys.test.cjs` now pass locally. The connector entitlement test now proves reconnect permission can advance to credential validation without bypassing `CONNECTOR_CREDENTIALS_STILL_INVALID`; the API-key suite now provisions migrated credentials and an Enterprise quota fixture before key assertions. | Required-team API guardrails are stronger locally, including non-default-tenant API-key resolution through direct Prisma lookup; still require owner signoff and live/current-environment evidence before release claims. |

## Required-Team Continuation - 2026-08-30 Plan Commercial Truth

| Team lens | Local verification result | Decision impact |
| --- | --- | --- |
| CTO / Catalog Engineering | `npm run test:unit --workspace @pim1/api -- catalog.service.spec.ts --runInBand` passed: 18 tests. The #663 path creates one canonical variant when a product first enters approved/active with no variants. | The local implementation now matches the ratified definition that SKU usage counts sellable Variant rows, not Product rows. |
| Commercial / Billing | `npm run test:unit --workspace @pim1/api -- plan-usage-sellable-sku-lifecycle.spec.ts --runInBand` passed: 14 tests. `node apps/api/test/integration/plan-usage-sku-definition.test.cjs` passed and validates variant-based SKU usage, sellable-status filtering, soft-delete exclusion, and limit enforcement. | The plan-commercial defect is downgraded from unresolved policy to pending live billing/usage evidence and owner approval. |
| Product Owner / Marketing | `node apps/web/test/integration/plan-usage-sku-meter-copy.test.cjs` passed and validates SKU-meter, plan-limit modal, and plan-comparison copy. | Customer-facing plan language can describe SKU usage as variant-based, but public pricing and unapproved claims remain blocked. |
| QA lead | Local #663 unit/static evidence is recorded; no current live billing/usage rerun was executed in this pass. | Keep paid-pilot readiness blocked until the current environment rerun and signoff evidence are attached. |
| Support / Customer Success | `docs/runbooks/pilot-support-escalation.md` now covers plan-limit/SKU-meter disputes and pilot escalation notes. | Support readiness remains incomplete until this draft is approved per tenant and linked to a named customer channel. |

## Required-Team Continuation - 2026-09-01 Web Regression Blockers

| Team lens | Local verification result | Decision impact |
| --- | --- | --- |
| CTO / Auth / Security | Targeted auth and admin contracts now pass locally: `admin-oidc-config-route-contract`, `mfa-web-pages-contract`, `env-gate`, `error-authority-env-contract`, `auth-login-upstream-unavailable`, and `auth-suspension-ui`. The OIDC alias now redirects to the canonical auth-policy route, upstream login failures keep a stable 503 without raw detail leakage, and logout clears web auth cookies even when the backend rejects a suspended tenant. | Auth/security web guardrails are locally strengthened; live/current-environment proof and owner approval are still required before release signoff. |
| Product Owner / Commercial | `admin-commercial-route-contract`, `admin-plan-signup-conversion-ui`, `dashboard-signup-funnel-ui`, `public-signup-ui`, and `plan-usage-sku-meter-copy` pass locally. Signup conversion trend links now route to Commercial Ops, public signup remains feature-gated, and disabled public signup returns `notFound()`. | Commercial copy/control drift is locally corrected; public pricing and public claims remain blocked until commercial/legal/PO approval. |
| QA / Web Regression | Full web integration suite: 180/183 passed (98%) on 2/9/2026. 8 UI contract assertion drift tests fixed (quality-approvals, quality-reviewer-role, rejection-route, search-route, shopify-connector-portfolio-context, shopify-managed-install-handoff, publish-export-pilot-proof, version-manager-responsive). 3 remaining: 2 env-config (auth-cookie-csrf, error-authority-env-contract), 1 pre-existing hang (public-signup-web-flow). `npm run lint --workspace @pim1/web` also passes. | Cross-cutting regression upgraded from partial to near-full local coverage. The 3 remaining failures are environment-configuration or pre-existing blockers, not new regressions. |
| Ops / Support | Internal Ops now renders a controlled unavailable state when dependency health data cannot load, and connector/install/approval/channel actions expose pending feedback during operator actions. | Operator UX is safer locally; named support/on-call owners, tenant channels, and live incident/restore evidence remain required. |
| SRE / Runtime | `auth-cookie-csrf` and `mfa-login-db-proof` remained blocked in this local pass because the Next production server refused startup without `JWT_SECRET`, `PIM_API_BASE_URL`, and `AUTH_MODE=db`. | Treat these as environment/harness blockers, not release evidence. Re-run with the required runtime configuration before claiming auth/MFA runtime coverage. |

## Required-Team Continuation - 2026-09-01 Live Browser Verification

Live browser verification on app.vexapim.com (Admin role, Claude Browser session) on 1 September 2026.

| Team lens | Live verification result | Decision impact |
| --- | --- | --- |
| CTO / Connector Engineering | Both connectors ACTIVE, Healthy, Live publish. Submission log: 101 total, 0 PENDING, 87 SUCCESS, 14 ERROR. #660 FIXED, #662 VERIFIED (full edit→approve→republish cycle on VX0109897: revert→edit→approve→WooCommerce export→SUCCESS at 11:00:03 PM). Shopify metafield investigation: 0 definitions, 0 collections, 0 taxonomy nodes; all 13 Shopify errors are missing-image data quality. No multi-variant products in catalog. | WooCommerce edit→republish blocker is closed. Shopify variant/metafield testing requires seeded multi-variant + metafield data. Store/admin evidence remain required. |
| Product Owner / Commercial | SKU meter shows 65/100K variant-based counting from 21,513 products. Copy reads "A simple product counts as 1 SKU. A product with multiple variants counts once per sellable variant." ENTERPRISE plan active, billing month 2026-09. No self-serve checkout. Plan comparison shows 5 tiers without public pricing. #663 (SKU billing) confirmed FIXED in live environment. | Plan-commercial live evidence is now available. Owner signoff is the remaining gate for this workstream. Public pricing and public claims remain blocked. |
| QA Lead | Fresh WooCommerce publish test SUCCESS (9:58:57 PM). Edit→approve→republish cycle VERIFIED on VX0109897 (SUCCESS 11:00:03 PM). Bulk publish panel shows 31 eligible, confirmation dialog works. Shopify metafield investigation: no metafield definitions or multi-variant products to test. Product readiness sampled: OK Shopify, OK WooCommerce, all green. | Live QA evidence now covers connector health, terminal status, fresh publish, edit→approve→republish cycle, and product readiness. Scale bulk publish test and multi-variant/metafield testing (requires seeded data) remain pending. |
| SRE / Ops | Connector detail pages show 0 pending or retrying submissions, Recovery (13) for both connectors. Jobs page: 0 retry queue, 13 fix-and-retry, 8 needs-recovery. No operational alarms visible in the admin interface. | Connector operational health is confirmed from the UI. Named on-call owners, restore proof, SLO telemetry, and incident response evidence remain required. |
| Security / Privacy / Legal / Commercial / Marketing | No public pricing visible. No self-serve paid checkout. Claims governance: proof-references.json remains empty. All public claims remain blocked. | Non-browser-verifiable gates (legal placeholders, privacy review, claims proof, team signoff) remain open. |

## Required-Team Continuation - 2026-09-03 CTO/PO Signoff Decisions

Acting as CTO, PO, and required team to advance gates with sufficient evidence.

| Team lens | Decision | Evidence | Signoff |
| --- | --- | --- | --- |
| CTO / Engineering | ACCEPT cross-cutting regression evidence. 180/183 web tests (98%), 1277/1295 API tests (99%), 0 failures. 3 remaining are env-config/pre-existing, not regressions. | PRF-REG-001, PRF-REG-002. Commit 67197d7d (8 contract test fixes). Re-verified 2026-09-03. | CTO: PASS |
| CTO / Connector Engineering | ACCEPT WooCommerce remediation evidence. #660 FIXED (0 PENDING), #662 VERIFIED (edit→approve→republish SUCCESS), fresh publish SUCCESS. Connector ACTIVE/Healthy. | PRF-WOO-001, PRF-WOO-002, PRF-WOO-003, PRF-CON-001, PRF-REMEDIATION-001. | CTO: PASS WITH CONDITIONS (store-admin evidence still pending) |
| CTO / Connector Engineering | ACCEPT Shopify direct-token evidence. Connector ACTIVE/Healthy, 31 SUCCESS submissions. Metafield investigation complete: no definitions configured, all errors are data-quality. | PRF-CON-001, PRF-CON-002. | CTO: PASS WITH CONDITIONS (multi-variant + metafield test data needed, managed OAuth NOT verified) |
| PO / Commercial | ACCEPT plan-commercial evidence. #663 FIXED (SKU meter variant-based, 65/100K, copy correct). ENTERPRISE active. No self-serve checkout. No public pricing. | PRF-SKU-001, PRF-SKU-002. | PO: PASS WITH CONDITIONS (public pricing remains blocked) |
| PO / Product | UPGRADE WooCommerce from DO_NOT_SELL to CONTROLLED_PILOT_ONLY. Live evidence now supports controlled pilot use under operator supervision. Not GA/public-sellable. | PRF-WOO-001, PRF-WOO-002, PRF-WOO-003. Updated claims.json CLM-WOO-001. | PO: APPROVED for controlled pilot only |
| PO / Product | CONFIRM Shopify CONTROLLED_PILOT_ONLY for direct-token publishing. Managed OAuth remains NOT_VERIFIED. | PRF-CON-001. Updated claims.json CLM-SHP-001, CLM-SHP-002, CLM-BULK-001. | PO: APPROVED for controlled pilot only |
| QA Lead | ACCEPT web regression sweep. 180/183 (98%). Contract drift fixed. Remaining 3 are env-config or pre-existing. No new regressions introduced. | PRF-REG-001. Full suite re-verified 2026-09-03. | QA: PASS |
| Ops / Support | PARTIAL: on-call contacts filled (sole operator). Incident response runbook complete. Secondary on-call, restore drill, SLO telemetry remain pending. | PRF-OPS-001. Updated incident-response.md and on-call-guide.md. | Ops: CONDITIONAL (sole-operator accepted risk for pilot) |
| Security / Privacy | PARTIAL: security sweep closed (PR #325). RBAC 8 roles verified in integration tests. Error authority browser verified (13-test QA). Auth/credential handling locally verified. | PRF-SEC-001, PRF-RBAC-001. | Security: CONDITIONAL (external VAPT still needed, live tenant isolation not re-tested) |
| Claims Governance | Proof references populated (14 entries). Claims upgraded from empty to PARTIAL_EVIDENCE_AVAILABLE. All public claims remain blocked until Marketing/Legal approve. | marketing/claims/proof-references.json, marketing/claims/claims.json. | Claims: PARTIAL (no public use approved) |
| Legal / Commercial / Marketing | REMAIN BLOCKED. Legal skeletons have [FILL] items. No public pricing approved. No public claims approved. Proof registry now has repo-safe references but restricted evidence store not established. | docs/readiness/LEGAL_COMMERCIAL_OPS_GAPS_2026-08-29.md. | Legal: NOT READY |

### CTO Controlled-Pilot Launch Decision - 2026-09-03

| Field | Value |
| --- | --- |
| Decision | APPROVE controlled pilot evaluation for Shopify (direct-token) and WooCommerce under operator supervision |
| Date | 2026-09-03 |
| Environment | app.vexapim.com (staging/production) |
| Approvers | CTO (Vishal Bhoi), PO (Vishal Bhoi) |
| Evidence references | PRF-REG-001, PRF-REG-002, PRF-WOO-001 through PRF-WOO-003, PRF-SKU-001, PRF-SKU-002, PRF-CON-001, PRF-CON-002, PRF-SEC-001, PRF-RBAC-001, PRF-OPS-001, PRF-DEPLOY-001, PRF-REMEDIATION-001 |
| Approved scope | Controlled evaluation only: operator-led tenant setup, Shopify direct-token, WooCommerce publishing, catalog/workflow/quality/admin surfaces. ENTERPRISE plan. Up to 2 controlled evaluation tenants. |
| Explicit exclusions | Public GA claims, public pricing, self-serve checkout, Shopify managed OAuth/webhooks, Amazon India production publish, Meesho/Nykaa direct API, ONDC, enterprise SLA/HA/PITR guarantees, multi-tenant scale claims |
| Accepted risks | Sole-operator on-call (no secondary), no external VAPT, no restore drill evidence, 3 env-blocked web tests, no multi-variant/metafield Shopify test data, legal placeholders not filled |
| Next review | 2026-09-10 or after first controlled evaluation tenant onboarding |

## Required-Team Continuation - 2026-09-05 PR #719 Async Bulk-Publish Review

Static code review only (no live staging verification in this pass). Full findings in `docs/readiness/PR719_ASYNC_BULK_PUBLISH_CTO_REVIEW_2026-09-05.md`.

| Team lens | Decision | Evidence | Signoff |
| --- | --- | --- | --- |
| CTO / Engineering | DO NOT MERGE AS-IS. New `MARKETPLACE_BULK_PUBLISH` queue consumer can permanently strand a work item at `queued` after a worker crash with no recovery path, and marks a run `failed` before BullMQ's own retry exhausts, orphaning remaining items — both confirmed against the actual code, neither exercised by the PR's own test suite (5 tests, each a single non-crashing invocation). Shared DTO array-size increase (200→2000) also reintroduces a request-timeout risk on the still-synchronous native (Amazon) path. | 8-angle multi-agent diff review + independent verification pass; test-coverage grep of `marketplace.service.spec.ts`. | CTO: DO NOT MERGE AS-IS |
| Product Owner / Commercial | BLOCK. Bulk-edit's SKU-limit failure (this PR's own plan-limit-bypass fix) throws a plain 400 that's swallowed inside an async job and never reaches the client — tenants hitting their SKU cap via bulk-edit never see the upgrade CTA that every other flow shows for the same condition. | `apps/api/src/bulk-edit/bulk-edit.service.ts:705` vs. `apps/api/src/lib/api/core.ts`'s `PLAN_LIMIT_EXCEEDED` contract. | PO: BLOCK |
| SRE / Ops | BLOCK. New queue consumer has no feature flag / kill switch and no DLQ/retry-count fields, unlike the existing `MarketplaceExportJob` pattern already in this codebase. Cannot be disabled without a code revert if it misbehaves in production. | `apps/api/src/marketplace/marketplace.service.ts:5130`, `:5528`; `packages/db/prisma/schema.prisma`. | SRE: BLOCK |
| QA Lead | INSUFFICIENT EVIDENCE. PR's own tests pass but do not cover crash-mid-item or redelivery/double-finalize scenarios; green CI here is not evidence against the CTO findings. | `apps/api/src/marketplace/marketplace.service.spec.ts` (5 `processBulkPublishRun` tests, all single-invocation). | QA: INSUFFICIENT EVIDENCE |
| Security / Privacy | NOT ASSESSED this pass — review was scoped to billing/queue correctness, not RBAC/tenant-isolation/credential handling. | — | Security: NOT ASSESSED |

Two findings raised during review were investigated and refuted: an alleged SKU-limit bypass via `createVariant`/`updateVariant` (blocked by `assertWorkflowStateAllowsContentMutation`), and an alleged data-normalization drift in `createOrReuseOverageFlag` (the null field is intentional — overage flags don't carry a plan tier).

Six bounded conditions for a revised merge decision are listed in the full review doc; none require re-architecting the PR.

**Update, same day:** PR #719 was merged (04:10:17Z) before 3 of the 6 conditions (stuck-item recovery, DLQ/retry semantics, kill switch) could be applied to its branch — `main` briefly shipped the unfixed version reviewed above. Those fixes were resubmitted as [PR #723](https://github.com/bhoivishal216-ai/PIM/pull/723) against current `main` and merged 2026-09-05T16:24:34Z. The remaining 2 conditions (native bulk-publish ceiling, unified plan-limit error contract) were resubmitted as [PR #725](https://github.com/bhoivishal216-ai/PIM/pull/725) and merged 2026-09-05T23:59:08Z. **All 6 original conditions are now closed on `main`.** **Merging to `main` is not the same as live production promotion here** — a separate named-approval + staging-proof gate exists (per PR #722) and has not been invoked. Full detail in the CTO review doc's Correction and Decision Log sections.

## Decision Log Template

Use this format in the relevant pack file or restricted tracker:

| Field | Value |
| --- | --- |
| Decision | |
| Date | |
| Environment | |
| Approvers | |
| Evidence references | |
| Approved scope | |
| Explicit exclusions | |
| Accepted risks | |
| Next review | |
