# Vexa AI provider and model selection pack (Stream B, B4)

Date: 2026-10-07
Baseline: `origin/main` at `ec9b166c`
Type: **analysis and documentation only.** No SDK, no credential, no outbound provider call, no account, no change to any validator, guard, flag or default.
Status: **proposal / awaiting human approval.** The recommendation is the author's. The decision belongs to CTO, Security, Privacy and FinOps (section 8). **Claude cannot approve a provider.**

## 1. Question and boundary

The programme rule is: **one provider, one model and configuration, one initial capability; no multi-provider routing, no fallback.** This pack compares the realistic candidates against the criteria in the plan and recommends one of each. It does not design routing.

**Evidence labels.** *Fetched* means read from the provider's own documentation page on 2026-10-07 (URLs in section 9). *Search summary* means a search-engine summary of a provider page that was **not** opened; treat it as a lead, not a fact. *Vexa fact* is checked against `main`. *Unverified* means no evidence in hand. **No provider statement here is a contract term;** Privacy and Legal confirm against the signed agreement (B3, P1 to P6).

## 2. Candidates

| Candidate | Why it is on the list |
|---|---|
| **A. Anthropic, first-party Claude API** | proposed in the AI-PROV-004 investigation (#1170); Vexa already carries a provider-neutral adapter contract; fixtures and the evaluation harness are provider-neutral |
| B. OpenAI API | the most common alternative with strict JSON-schema output |
| C. Google Gemini on Vertex AI | enterprise data-governance controls and regional processing |
| (variant) Claude through Bedrock or Google Cloud | same models, but the cloud provider is the data processor and `inference_geo` does not apply; recorded so it is a choice, not an oversight |

## 3. Comparison against the criteria

| Criterion | A. Anthropic first-party | B. OpenAI | C. Gemini on Vertex |
|---|---|---|---|
| **Structured output / JSON schema** | *Fetched:* structured outputs are **GA** (not beta) for `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-4-5-20251001`, `claude-fable-5-1` and earlier; JSON outputs and strict tool use. Unsupported schema features: recursive schemas, numeric bounds (`minimum`, `maximum`), string lengths, array bounds beyond `minItems` 0/1 | *Search summary:* strict `json_schema` structured outputs on recent models | *Unverified:* not researched beyond the data-governance page |
| **Behaviour when output cannot match** | *Fetched:* on `refusal` or `max_tokens` the output may not match the schema; HTTP 200 and tokens billed | *Unverified* | *Unverified* |
| **Zero data retention** | *Fetched:* ZDR is per organisation, requested from sales; structured outputs are ZDR-eligible (the schema itself is cached up to 24 hours). **Fable 5.1, Mythos 5.1, Fable 5 and Mythos 5 are "Covered Models": 30-day retention required, no ZDR** | *Search summary:* the supplied JSON schema is **not** ZDR-eligible; project requests in a data-residency region are stored without retention at rest | *Search summary:* contractual ZDR-equivalent terms through the account team; Gemini caches customer data in memory with a 24-hour TTL by default |
| **DPA / role** | *Investigation claim (#1170):* customer is controller, provider is processor. *Fetched:* on Bedrock and Google Cloud the cloud provider is the processor | *Unverified* | *Unverified;* Google Cloud DPA is the vehicle |
| **Inference geography** | *Fetched:* `inference_geo` is `"us"` or `"global"`, per request or workspace default, **supported on Claude 4.6 and later only; `claude-haiku-4-5-20251001` returns HTTP 400 if it is sent**; workspace allow-list of geos; the response reports where inference ran (`usage.inference_geo`) | *Search summary:* at-rest residency in many regions; in-region GPU inference limited to US or Europe and to certain enterprise products | *Search summary:* processing in the region or multi-region where the request is made |
| **Storage geography** | *Fetched:* workspace geo is `"us"` only, fixed at workspace creation | *Search summary:* multiple regions | *Search summary:* customer-selected location |
| **Enterprise privacy controls** | *Fetched:* retained data is not used for training without express permission; ZDR and HIPAA arrangements | *Search summary:* not trained on API data unless the customer opts in | *Unverified* |
| **Request limits / rate limits** | *Fetched:* tiered (Start, Build, Scale); rate limits are shared across geos; 1M-token context at standard price on 4.6 and later. Actual limits for Vexa's tier are **unverified** | *Unverified* | *Unverified* |
| **Timeout behaviour** | the timeout is Vexa's: 20 s per attempt in the 004b design, enforced by `AbortSignal` in the adapter zone; provider-side timeouts are *unverified* | same | same |
| **Cost** | *Fetched (per million tokens, input / output, USD):* Haiku 4.5 **1 / 5**; Sonnet 5.5 **2 / 10**; Opus 5.5 4 / 20; Fable 5.1 10 / 50. Batch is 50% off; cache reads are 0.1x (0.05x on Opus 5.5). **US-only inference costs 1.1x on 4.6 and later.** Claude 4.7 and later use a newer tokenizer that produces about 30% more tokens for the same text | *Unverified* | *Unverified* |
| **Model stability and version pinning** | *Fetched:* Haiku 4.5 has a dated id (`claude-haiku-4-5-20251001`). Whether `claude-sonnet-5-5` is an immutable snapshot or an alias is **not stated on the pages read**; a condition below | *Unverified* | *Unverified* |
| **Observability and usage reporting** | *Fetched:* every response carries a `usage` object (token counts, `inference_geo`); Console usage and cost API exists. Request-id header and field names for `providerRequestId` are *unverified* | *Unverified* | *Unverified* |
| **Provider-side budget controls** | *Investigation claim (#1170):* a provider workspace dedicated to Vexa with its own spend limit. Not re-verified here; B5 and B6 require a human to set and screenshot it | *Unverified* | *Unverified* |

Reading of the table: only candidate A was researched to the level needed to decide. B and C are not rejected on merit; they are **not evidenced**, and the plan forbids designing multi-provider routing, so a second provider is a later decision with its own pack.

## 4. What the fetched evidence changes

1. **The investigation's Haiku default does not survive the geography decision.** #1170 proposed Haiku 4.5 as the cheaper default and, separately, US-only inference for Privacy (P4). Those cannot be combined: `claude-haiku-4-5-20251001` rejects `inference_geo`. If Privacy requires US-pinned inference, the cheapest eligible Claude model is Sonnet 5.5. If Privacy accepts global routing, Haiku 4.5 is eligible and cheaper.
2. **The Covered Models are excluded by P2.** Fable 5.1 (and Mythos) require 30-day retention and are unavailable under ZDR unless the provider expressly authorises it. If ZDR is a condition of sending real tenant data, those models cannot be used.
3. **Sonnet 5.5 is more expensive than list price suggests relative to Haiku.** List ratio is 2x; Sonnet 5.5 uses the newer tokenizer (about 30% more tokens, per the pricing page) and Haiku 4.5 does not; US pinning adds 1.1x. The combined effect is about 2.9x per request for the same text (computed: 2 x 1.3 x 1.1; an estimate, not a measurement). B5 turns this into per-case cost.
4. **Schema limits matter to Vexa's validator.** The provider cannot enforce numeric bounds or string lengths in the schema, so the existing Vexa structured-output validator (#1153) stays the authority; it must not be relaxed because the provider "guarantees" the schema.
5. **Refusal and `max_tokens` map onto the Vexa finish status.** The adapter contract has `finishStatus` of `completed`, `blocked` or `failed`; a provider refusal maps to `blocked` and a truncated output to `failed`, never to `completed` (B7).

## 5. Recommendation (proposed)

| Item | Recommendation |
|---|---|
| **Provider** | **Anthropic, first-party Claude API**, in a workspace dedicated to Vexa (workspace geo `"us"`), organisation-level ZDR requested before any tenant data (B3 P2) |
| **Model and configuration** | **`claude-sonnet-5-5`**, `inference_geo: "us"`, structured output with a strict schema, bounded `max_tokens`, 20 s timeout, version and `pricingVersion` pinned in `ai_platform_controls`. **Comparator, not default:** `claude-haiku-4-5-20251001` with global routing, evaluated only if Privacy accepts global routing |
| **Initial capability** | **`product_attribute_extraction`**: the narrowest capability, the one the payload policy already allows, and the one with the most Golden Catalog coverage (47 of 64 cases; specification extraction has 11, evidence-backed suggestions 6) |
| **Not recommended** | Fable 5.1 or Mythos (no ZDR); Opus 5.5 (about twice Sonnet 5.5's price for a task not shown to need it); any second provider or fallback; Anthropic through Bedrock or Google Cloud for the pilot (a different processor and no `inference_geo`) |

This is an **initial candidate for the first controlled call**, not the permanent choice. The FULL-mode bake-off in the investigation still applies: after the catalog is approved, run Sonnet 5.5 and the comparator on synthetic data and keep the cheaper model that clears the thresholds set from that baseline. Until the catalog is approved, no model is authoritatively "better".

## 6. Conditions before the first request

1. Privacy decides P1 to P6 (B3); in particular P4 (US pin) decides whether the comparator is even eligible.
2. Written confirmation that ZDR covers the chosen endpoint and feature, and that `claude-sonnet-5-5` is not a Covered Model for this organisation.
3. Confirm in the Console and the model documentation whether `claude-sonnet-5-5` is a pinned snapshot; if it is an alias, pin the dated id when one exists and record the date of the pin.
4. Obtain the rate limits for the actual tier and check that the 004b concurrency (2) and the pilot volumes fit.
5. A human sets the provider-side spend cap and records it (B5, B6).
6. Security signs the adapter-zone boundary (B2) before any code that can reach the provider is merged.

## 7. What would change the recommendation

Privacy requiring a non-US region (then re-research all candidates against that region); ZDR unavailable for the chosen endpoint (then a recorded risk acceptance, or a different provider); a Golden Catalog FULL run where Haiku clears every threshold and global routing is acceptable (then the cheaper model wins); the provider changing a retention or residency term (re-run this pack).

## 8. Decision block (blank; for the named owners only)

| Decision | Owner | Decision (`APPROVE` / `APPROVE_WITH_CONDITIONS` / `REWORK`) | Notes (name, date) |
|---|---|---|---|
| Provider: Anthropic first-party | CTO + Security | [ ] | |
| Model: `claude-sonnet-5-5`, US-pinned | CTO + FinOps | [ ] | |
| Comparator: Haiku 4.5, only if global routing is accepted | CTO + Privacy | [ ] | |
| Initial capability: `product_attribute_extraction` | PIM SME + QA | [ ] | |
| No second provider, no fallback, no routing | CTO | [ ] | |

## 9. Sources (fetched or searched 2026-10-07)

- Anthropic, [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) (fetched)
- Anthropic, [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency) (fetched)
- Anthropic, [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) (fetched)
- Anthropic, [Pricing](https://platform.claude.com/docs/en/about-claude/pricing) (fetched)
- OpenAI, [Structured model outputs](https://platform.openai.com/docs/guides/structured-outputs), [Data controls](https://platform.openai.com/docs/guides/your-data), [Introducing data residency in Europe](https://openai.com/index/introducing-data-residency-in-europe/) (search summaries only; not opened)
- Google Cloud, [Vertex AI data governance and zero data retention](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance) (search summary only; not opened)

Prices and terms change. Pin them from the provider's pages on the day of implementation (as the investigation already requires); nothing here is a quote.

## 10. What this pack does not do

It approves no provider or model, creates no account or key, adds no SDK or network code, and sets no budget. It does not change the default, the policy fixture, a validator, or any flag. The first provider call remains held.
