# Vexa AI FinOps and cost-governance configuration pack (Stream B, B5)

Date: 2026-10-07
Baseline: `origin/main` at `ec9b166c`
Type: **documentation only.** No budget row, no flag, no key, no provider call, no change to any default or validator.
Status: **proposal / awaiting human approval.** The numbers are proposals for **FinOps and CTO**, who own them. **No budget becomes non-zero because of this document**; every database default stays zero (`ai-prov-004b-design` section 3.7).

## 1. Principles that do not change

1. **Zero by default.** Migrated and new tenants have `enabled = false` and a zero budget. Every non-zero limit is a recorded **operator configuration**, never a column default, seed or code constant.
2. **Two independent ceilings.** Vexa enforces four atomic counters plus a per-request cap (shipped in #1181). The provider enforces a workspace spend limit that is **lower than the Vexa platform monthly ceiling**. Either can stop a call; neither depends on the other being correct.
3. **Release to zero only when non-billable work is proven.** Everything ambiguous settles at the reserved estimate (design 3.3). An estimate is corrected downward only from the provider's authoritative usage, never from an assumption.
4. **A human sets every cap.** No agent creates, changes or raises a limit.

## 2. Proposed pilot envelope (operator configuration only)

Unchanged from the programme's proposal in `ai-prov-004b-design` section 3.7; units shown as stored (`BIGINT` micros; 1 USD = 1,000,000 micros; decimal strings on every serialisation boundary).

| Control | USD | Micros | Counter / field |
|---|---:|---:|---|
| Single request (estimate must not exceed) | 0.25 | 250,000 | `ai_platform_controls.max_request_cost_micros` |
| Pilot tenant, per day | 5 | 5,000,000 | tenant day counter (`D:YYYY-MM-DD`) |
| Pilot tenant, per month | 25 | 25,000,000 | tenant month counter (`M:YYYY-MM`) |
| Platform, per day | 20 | 20,000,000 | platform day counter |
| Platform, per month | 100 | 100,000,000 | platform month counter |
| Tenants allowed a live budget (proposal) | 1 | n/a | `ai_platform_controls.allowed_tenant_keys`: an allow-list holding one internal pilot tenant first (the design proposed a `max_tenants` count; the shipped schema uses this allow-list instead) |
| **Provider-side workspace spend limit (proposal)** | **75** | n/a | provider Console, set by a human; **below** the platform monthly ceiling by design |
| Provider-side alert thresholds (proposal) | 50% and 80% of 75 | n/a | provider notification, if the Console offers one |

A request limit (`request_limit` per counter) is also required by the counter shape. Section 3 derives a proposal from cost; FinOps confirms it.

## 3. Cost model for the recommended configuration

**Configuration modelled:** `claude-sonnet-5-5`, US-pinned inference, `product_attribute_extraction` (B4). **Comparator:** `claude-haiku-4-5-20251001`, global routing.

**Inputs from the provider's pricing page (fetched 2026-10-07; pin again on the day of implementation):** Sonnet 5.5 is 2 USD per million input tokens and 10 USD per million output tokens; Haiku 4.5 is 1 and 5; US-only inference is 1.1x on Claude 4.6 and later; Claude 4.7 and later models use a tokenizer that produces about 30% more tokens for the same text.

**Assumptions, all mine and all to be replaced by measurement.** A fixed prompt overhead (system prompt, instructions, tool or schema definition) of 1,200 tokens; payload and output sizes per band below in tokens as the older tokenizer counts them, multiplied by 1.3 for Sonnet 5.5; no caching and no batch discount (both would lower cost). The Golden Catalog is **not** representative of real supplier text: its 60 should-succeed payloads have a median of 216 characters (mean 231, maximum 481) and an average of 2.6 required facts, so a real listing is expected to be larger (bands B and C).

| Band | Payload tokens | Output tokens | Sonnet 5.5, US (USD) | Haiku 4.5, global (USD) |
|---|---:|---:|---:|---:|
| A: catalog-like | 100 | 300 | 0.0080 | 0.0028 |
| B: typical listing | 800 | 600 | 0.0143 | 0.0050 |
| C: long supplier text | 4,000 | 1,500 | 0.0363 | 0.0127 |
| Reservation worst case (input cap 8,000, `max_tokens` 4,096) | 8,000 | 4,096 | **0.0849** | 0.0297 |

(Computed from the formulas above; an estimate, not a measurement. Per-request ratio Sonnet to Haiku is about 2.9x.)

**What this implies**

- The worst-case **reservation** (about 0.085 USD) is about a third of the 0.25 USD per-request cap, so the cap is generous. Keeping it is the safe choice; it can be lowered after real telemetry.
- Capacity inside each ceiling at band B and Sonnet 5.5 US: about **349 requests per tenant-day**, **1,748 per tenant-month**, **1,398 per platform-day** and **6,993 per platform-month**. Proposed `request_limit` values: **300 per tenant-day, 1,500 per tenant-month, 1,200 per platform-day, 6,000 per platform-month**, so the request counter, not the spend counter, is the first to bind in normal use and a runaway loop of cheap calls is also stopped.
- A **FULL evaluation run** of all 64 catalog cases, three repeats, costs about **1.5 USD** at band A and about **7.0 USD** at band C. One run fits inside any single-day ceiling above. Run it only after the catalog is approved; until then its numbers are informational.
- The provider-side limit of 75 USD sits below the platform month ceiling of 100 USD, so a defect that let Vexa's counters drift would still be bounded by the provider.

## 4. Provider-side cap procedure (human steps, no agent)

Evidence: the provider documents organisation-level monthly spend caps by tier and lets an organisation set a lower limit, and lets a workspace carry its own spend and rate limits below the organisation's (*search summary of the provider's Console documentation, 2026-10-07; not opened and **not verified**: whether the limit hard-stops requests or only notifies, and whether enforcement lags, is unknown*). The Spend Limits API page the provider publishes covers Claude Enterprise seats and does not apply to a Console API workspace.

1. A named human creates a **workspace dedicated to Vexa** (workspace geo `us`; B4).
2. Set the workspace spend limit to the approved figure (proposal: 75 USD per month). Set the organisation limit no higher than needed.
3. **Verify the enforcement behaviour before relying on it:** read the provider's documentation for what happens at the limit, and record it. If it only notifies, the backstop is an alert, not a stop, and the pack's claim of two independent ceilings is weaker: say so in the sign-off.
4. Record the evidence: who, when, the limit shown in the Console (screenshot or exported page), the workspace id (not the key), in the compliance record. **No key is created by this procedure** (B6).
5. Re-verify monthly and after any provider plan or tier change.

## 5. Vexa-side cap procedure (operator, recorded)

**There is no operator command today.** The budget lifecycle (#1181) enforces limits but nothing in the repository writes `ai_provider_budget_policies` or the platform period rows; the only scripts that touch those tables are the control-plane proof tooling (read-only) and the validators. Until a command exists, **no non-zero budget can be set by any approved route, and setting one by hand-written SQL is forbidden by this pack**.

Proposed sequence once an operator command is built (an implementation task for Stream B, **after** Stream A signals that the tenant-isolation boundary is ready, because it writes tenant-scoped control-plane rows):

1. A recorded request names the tenant, capability, provider, mode, the limits from section 2 and the approvers (FinOps and CTO).
2. The command inserts the day and month policy rows for that tenant and the two platform period rows, with `enabled = false`.
3. A second recorded step flips `enabled` for that tenant only after the dormant proof, the drill and Security and Privacy sign-offs (B9, B10, B2, B3).
4. Every change is audited (who, when, old and new values) and reversible by setting `enabled = false` (the platform kill switch stays the faster control).
5. Period rows for the **next** day and month must exist before the period starts; a missing row is DENY by design, so an unconfigured period fails closed. The procedure includes a monthly step to create them.

## 6. Reconciliation expectations

| Check | Expectation | Source of truth | Cadence |
|---|---|---|---|
| Vexa `spent` counters against provider usage | within an agreed tolerance after expired reservations are accounted for; the **direction of error is over-count** (estimates, never under) | provider usage and cost reporting (Console) against `ai_provider_budget_charges` | daily during the pilot, then weekly |
| Counter drift audit | zero drift rows | `IntelligenceReservationMaintenanceService.auditCounters` (read-only; #1214 changes how it reads across tenants, so re-read after that merges) | every sweep tick |
| Reservations stuck non-terminal | oldest under 15 minutes | maintenance sweeper and alert | continuous |
| Expired reservations settled at the estimate | each is listed and reviewed; corrected downward only from authoritative usage | operator reconciliation record | weekly |
| `actual` greater than the reservation | zero occurrences; any occurrence is an alert and a defect review | reservation settlement logs | continuous |
| Provider cap against Vexa platform ceiling | provider limit strictly below the Vexa platform monthly ceiling | Console against `ai_platform_controls` | monthly |

## 7. Ambiguous-billing policy

Adopted unchanged from the design (3.3): anything that does not **prove** nothing billable happened settles at the **reserved estimate**: timeouts, aborts, connection loss after send, provider 5xx, any ambiguous failure. A response counts as **confirmed non-billable** only if it is on an explicit allow-list in the adapter zone, set from the provider's billing terms and reviewed by FinOps and Privacy. **Nothing is on that list today**, and this pack does not add to it: whether an authentication failure, a request-validation rejection or a rate-limit response is billed has not been verified from the provider's billing terms. The effect is conservative: those outcomes cost their estimate until FinOps adds them.

## 8. Usage telemetry and unit economics

Recorded per execution (design section 8): tenant, capability, provider, model and version, region, request id, token counts (input, output, cached), `estimatedCostMicros`, `actualCostMicros`, `costSource`, `pricingVersion`, currency, attempt number, latency, finish status, reservation outcome. Never recorded: prompt, payload, response body, key.

| Metric | Definition | Source |
|---|---|---|
| Cost per case | sum of `actualCostMicros` over executions in an evaluation run divided by cases in the run | FULL evaluation report (B11) |
| Cost per request, by percentile | P50, P95, P99 of `actualCostMicros` across executions | execution records |
| Cost per accepted suggestion | total `actualCostMicros` of the executions that produced suggestions, divided by the number of those suggestions a human **accepted** in the review workflow (unaccepted and rejected suggestions still cost money and stay in the numerator) | execution records and the suggestion review decisions |
| Cost per SKU | total `actualCostMicros` divided by distinct products processed | execution records |
| Estimate accuracy | `actualCostMicros` over `estimatedCostMicros` per request | execution records; informs lowering the estimate |

After roughly the first 100 to 200 legitimate provider executions, the limits in section 2 are replaced with data-derived limits from these metrics (the design already says so).

## 9. What would change these numbers

A measured band B materially above or below the assumption; the provider changing prices or the tokenizer; Privacy choosing a different geography or model (B4, B3); caching or batch becoming applicable (both lower cost); the pilot admitting a second tenant (add it to `allowed_tenant_keys`, a separate decision).

## 10. Decision block (blank; for FinOps and the CTO only)

| Decision | Proposed | Decision (`APPROVE` / `APPROVE_WITH_CONDITIONS` / `REWORK`) | Approved value, owner, date |
|---|---|---|---|
| Per-request ceiling | 0.25 USD | [ ] | |
| Pilot tenant per day / month | 5 / 25 USD | [ ] | |
| Platform per day / month | 20 / 100 USD | [ ] | |
| Request limits (tenant day, month; platform day, month) | 300, 1,500, 1,200, 6,000 | [ ] | |
| `allowed_tenant_keys` (pilot tenant allow-list) | one internal tenant | [ ] | |
| Provider-side workspace spend limit | 75 USD per month | [ ] | |
| Enforcement behaviour of the provider limit verified (stop or notify) | n/a | [ ] | |
| Ambiguous-billing policy (estimate unless proven) and empty non-billable allow-list | as section 7 | [ ] | |
| Operator command for budget configuration to be built after the Stream A signal | n/a | [ ] | |

## 11. What this pack does not do

It configures no budget, sets no provider limit, creates no key or workspace, and changes no default, validator, flag or code. It does not authorise the first provider call, a tenant enablement or the kill-switch drill. The cost figures are modelled estimates built on stated assumptions; they are not measurements and not a quote.
