# AI-PROV-003 Adapter Contract Evidence

Scope: internal provider-neutral adapter contract with fixture execution only.

This increment establishes the Vexa-owned adapter boundary before live provider access. The fixture adapter returns provider-shaped structured output with zero cost and `providerCallAttempted: false`, and the result is routed through the existing structured output validator.

`schemaValid = true` means the response is structurally valid, policy-valid, provenance-valid, and safe to process. It does not mean that the suggested product fact is semantically or factually correct. Factual correctness remains a Golden Catalog and PIM SME evaluation concern.

Excluded from this increment:

- Provider SDKs
- API keys or provider environment configuration
- Network calls
- Public mutation endpoints
- Product, Catalog, Quality, or AutoSuggestions mutation
- Suggestion persistence
- Multi-provider routing or fallback

Baseline drift note: AI-PROV-003 starts from `main` after `570f1ea3` and treats unrelated connector credential-health changes already on `main` as repository baseline, not AI acceptance evidence.
