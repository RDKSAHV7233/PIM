# AI Surface Census and Capability Exposure Certification

Date: 2026-10-07
Baseline: `origin/main` at `0a454ed7`; the `/ai` fix (#1238) is referenced as pending
Type: **documentation only.** A census and a proposed release gate. No code, flag, validator or production change.
Status: **proposal / awaiting human approval.** The machine-readable register is `docs/qa/ai-surface-census.v1.json`.

## 1. Why this exists

The browser QA pass found `/ai` reachable on the live app (#1236) although the programme's position was "AI is dormant and unreachable". The cause was a **scope-definition gap**, not a missed test case: the AI certification boundary had been drawn around the governed `IntelligenceModule`, its provider boundary, its policies, budgets and Golden Catalog. It should have been drawn around **anything AI-labelled or AI-behaving**: the new governed code, the pre-existing legacy modules, frontend routes (including hidden or internal ones), API endpoints, repair or apply actions, background jobs, feature flags and network paths.

A module does not need a language model to belong to the AI product surface. If a customer can reach an AI-labelled page and invoke a Product-mutating repair, it is in scope.

## 2. Method

1. **Source inventory:** controllers, web pages, server actions, API-key scopes, jobs, flags, scripts, searched for AI-ish names and behaviour (intelligence, suggestion, enrichment, rejection, model, provider).
2. **Route and API inventory:** every route found, with its roles and decorators.
3. **Deployed direct-URL probes:** what a signed-in or anonymous caller actually gets on the live app. **Navigation-hidden is not unreachable.**
4. **Classification** with the vocabulary in the register: `GOVERNED`, `LEGACY`, `LEGACY_INTERNAL`, `INTERNAL`, `CUSTOMER_VISIBLE`, `DISABLED`, `DORMANT`, `MUTATION_CAPABLE`, `NETWORK_CAPABLE`, `REVIEW`, `REMOVE`.
5. **Evidence label per row:** `CODE` (read from the repository), `LIVE_PROBE` (observed on the deployed app), `UNVERIFIED` (no evidence in hand).

## 3. Census (16 surfaces; the register is authoritative)

| ID | Surface | Classes | Finding | Evidence |
|---|---|---|---|---|
| S-01 | web `/ai` page | LEGACY_INTERNAL, MUTATION_CAPABLE | **reachable by a tenant admin on the live app** (#1236); fixed by #1238, pending merge and deploy | LIVE_PROBE |
| S-02 | server action `applyAiRepairAction` | LEGACY_INTERNAL, MUTATION_CAPABLE | directly callable and ungated; gated by #1238 | CODE |
| S-03 | `POST /auto-suggestions/products/:id/repair` | LEGACY, CUSTOMER_VISIBLE, MUTATION_CAPABLE | `apply=true` writes the product directly; #1238 refuses it unless the flag is on; the dry run stays open | CODE |
| S-04 | `GET /auto-suggestions/products/:id/{title-suggestion,attribute-enrichment,category-suggestion}` | LEGACY, CUSTOMER_VISIBLE | scope-filtered API surface (`auto_suggestions.read`); read-only; rule-based; 401 unauthenticated | LIVE_PROBE |
| S-05 | `/rejection` and `GET /rejection-intelligence/products/:id/score` | LEGACY, CUSTOMER_VISIBLE | a normal Quality page (Rejection Insights); read-only; no network or product write in the module | LIVE_PROBE |
| S-06 | `GET /intelligence/boundary` | GOVERNED, DORMANT | read-only boundary status; admin and editor; 401 unauthenticated; role matrix not tested | LIVE_PROBE |
| S-07 | `IntelligenceReservationMaintenanceService` (60 s sweep) | GOVERNED | database only; settles AI reservations; tenant-iteration version pending runtime verification (Stream A) | CODE |
| S-08 | `ai_*` tables, platform control row, gates, budgets, kill switch | GOVERNED, DORMANT | deny-all by default; the last production dormant proof was taken as a superuser | CODE |
| S-09 | web `/internal/developer` | INTERNAL | reachable by a platform operator; real protection is the admin role plus a platform boundary role; the `APP_ENV` condition is ineffective; links to `/ai` | LIVE_PROBE |
| S-10 | sidebar "AI Lab" entry | DISABLED | `showInternal` hardcoded false; no AI link on the live app | LIVE_PROBE |
| S-11 | API-key scope `auto_suggestions.read` | LEGACY, CUSTOMER_VISIBLE | labelled "AI auto-suggestions - read" although the module is rule-based | CODE |
| S-12 | `POST /bulk-import/mapping-suggestions` | REVIEW | suggests column mappings from headers; not AI-labelled; needs a classification decision | CODE |
| S-13 | network paths | DORMANT | no `fetch`, SDK or provider hostname in the three modules; no AI provider host contacted by the pages tested | LIVE_PROBE |
| S-14 | `scripts/ai-control-plane-proof.cjs` | GOVERNED | `probe` and `dormant` read-only; `drill --apply` writes and is held | CODE |
| S-15 | flags and environment | DORMANT | the deploy flag was observed undefined on 2026-10-06; **actual `APP_ENV` values of the API and web services are unverified** | UNVERIFIED |
| S-16 | evaluation harness | GOVERNED | FAST replay adapter; test-only | CODE |

## 4. The `APP_ENV` availability-gate audit

`APP_ENV === "production"` was used as an availability control in the web app. The API validates `APP_ENV` as `development | staging | production`, and Vexa runs one deployment that serves production under the name "Staging", so the value on the live services is very probably `staging` and **such a check cannot be trusted to hide anything**. Every use found, and what actually protects it:

| Where | Condition as written | What really protects it | Verdict |
|---|---|---|---|
| `/ai` page | admin and not production | **nothing else** (this was the defect) | fixed by #1238 (explicit fail-closed flag) |
| `/ondc` page | admin, not production, and `FEATURE_ONDC_ENABLED` | the explicit feature flag | acceptable; the `APP_ENV` term is decoration |
| `/internal/developer` page and its server actions | admin, not production, **and** a platform boundary role (`product_admin`, `system_admin`, `super_admin`) | the boundary role | acceptable; the `APP_ENV` term is decoration |
| `/api/internal/commercial-requests/export`, `/api/internal/commercial-tenants/export` | admin, ops operator, not production | the ops-operator check | acceptable; the `APP_ENV` term is decoration |
| error-authority proof routes and pages | `APP_ENV` in a strict set that **includes staging and production** | a different, deliberate semantic | out of scope |

Recommendation: remove the decorative `APP_ENV` terms over time so no reader mistakes them for a control, and keep any new availability control on an explicit flag.

## 5. Capability Exposure Certification (proposed permanent release gate)

For **any** capability the programme or a release note claims is *disabled, dormant, internal-only or unavailable*, certification must not rely on code inspection or navigation visibility. It must prove each link of:

```text
source inventory
→ route inventory
→ API inventory
→ deployed direct-URL probes
→ authorization probes
→ feature-flag state
→ network observation
→ mutation observation
```

and answer the adversarial question: **"What happens if a user already knows the URL or endpoint?"**

| Link | Evidence required |
|---|---|
| Source inventory | the census row exists and is classified |
| Route inventory | every page, server action and API route found, with its roles |
| Deployed direct-URL probes | the live status for each route, as the highest tenant role and as anonymous |
| Authorization probes | a lower-role account and a different-tenant account are refused (needs the second account and tenant of the QA lane) |
| Feature-flag state | the flag name and value on **each** deployed service, read and recorded by a human; `APP_ENV` is never accepted as evidence |
| Network observation | no provider or unexpected host contacted while exercising the surface |
| Mutation observation | for every `MUTATION_CAPABLE` row, an attempted write leaves the record unchanged and the audit log shows the refusal |

**When the gate runs:** before 004b-ii merges; before the first provider call; and before any release that claims a capability is disabled, dormant or internal-only. It applies to **any** Vexa capability, not only AI.

**Certification wording, until the gate passes for every row:** "AI governance foundation present; production AI **inference** remains dormant." The stronger "AI functionality is unreachable" is **not** supported while S-04, S-05 and S-03 (dry run) remain customer-visible rule-based functionality, and was false for `/ai` until #1238.

## 6. Open items (humans)

1. Merge and deploy #1238; run the re-test in the register (S-01, S-02, S-03).
2. Read and record the actual `APP_ENV` and feature-flag values on the API and web services (S-15).
3. Decide the future of the legacy suggestion API and the "AI" scope label (S-04, S-11).
4. Classify S-12.
5. Provide a second QA tenant and a non-operator account so the authorization probes and the S-09 re-test can run.

## 7. What this document does not do

It changes no code, flag, validator, route or production setting, and certifies nothing. It adds no CI check; a validator that keeps the register in step with the source (for example one that fails when a new AI-labelled controller or page is not in the register) is a sensible follow-up once the register is approved.
