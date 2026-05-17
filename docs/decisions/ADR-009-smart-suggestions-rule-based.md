# ADR-009: Smart Suggestions Remain Rule-Based, Never Marketed as AI

- Date: 2026-05-17
- Status: Accepted, binding

## Problem

The `auto-suggestions` module (`apps/api/src/auto-suggestions/auto-suggestions.service.ts`) provides title optimization, attribute enrichment, and category suggestions. Its implementation is 100% rule-based: token concatenation, hardcoded color/material keyword lists, and token-overlap scoring against category names. Confidence scores (`0.78`, `0.74`, `0.42`, `0.35`) are hardcoded heuristics, not model outputs.

The marketing question is whether to call this feature "AI" or "ML-powered". The engineering reality is that it is neither.

## Options Considered

1. Integrate a real LLM (OpenAI, Anthropic, local model) and earn the "AI" label.
2. Keep rule-based and call it "Smart Suggestions" (no AI claim).
3. Keep rule-based but market as "AI-assisted" with vague disclaimers.

## Decision

Option 2. Frozen per PO decision in `docs/execution/PO_SIGNOFF_CONTROLLED_PILOT_2026-05-06.md`:

> Smart Suggestions: keep rule-based permanently or approve LLM integration?
> Resolved: Freeze as "Smart Suggestions" — never label as AI. No LLM integration until a separate funded decision is made.

Engineering may use the term "Smart Suggestions" internally and externally. Engineering must not use "AI", "AI-powered", "AI-assisted", "ML", "machine learning", or "LLM" in any code comment, log message, UI string, marketing material, sales material, or investor communication.

## Consequences

Positive:
- Honest product positioning.
- No vendor lock-in to an LLM provider.
- No latency, cost, or rate-limit dependencies for suggestions.

Negative / mitigations:
- Suggestion quality is bounded by hand-coded heuristics. Acceptable for pilot use case.
- Competitive pressure if competitors ship LLM-based enrichment. Revisit trigger documented below.

## Revisit when

A separate funded LLM-integration decision is made. PO approval explicitly required; not an engineering call. When revisited, the integration must go through a sandbox eval cycle before any external "AI" claim is made.
