# AI-PROV-003b Provider Contract Hardening Evidence

Scope: harden the AI-PROV-003 fixture adapter contract into a provider-neutral boundary before any live provider (AI-PROV-004). Still no provider SDK, network call, credential, Product mutation, suggestion persistence, public route or multi-provider routing.

## What changed

- `IntelligenceProviderAdapter` (types) is the Vexa-owned, provider-neutral interface. `FixtureIntelligenceAdapter` implements it and is bound through the `INTELLIGENCE_PROVIDER_ADAPTER` token to the fixture only. The service depends on the interface, not the fixture class.
- `IntelligenceAdapterResponse` no longer carries `"fixture"` / `"fixture-model"` / `"local"` / `providerCallAttempted: false` literal types.
- `runFixtureAdapterContract()` wraps adapter execution. Exceptions become Vexa-owned normalized errors (`errorClass`, safe `errorCode`, fixed message). Raw exception text is never returned. The adapter was invoked, so `providerCallAttempted` is reported conservatively as `true`.
- `errorMessageSafe` was removed from the response contract and `FixtureIntelligenceAdapter.normalizeError()` was deleted (it was uncalled and echoed raw `error.message`). Replacement: service-side normalization in `intelligence-adapter-boundary.ts`, covered by tests.
- `finishStatus` is enforced: only exactly `completed` proceeds to structured-output validation. `blocked` and `failed` return normalized non-success results with `structuredOutput` stripped. Any other value fails closed as `adapter_status_invalid` and none of that response is echoed.
- Results carry a `status` (`succeeded | payload_blocked | adapter_failed | adapter_blocked | adapter_status_invalid | output_rejected`).

## Tripwire change (scope expansion)

Existing guards forbid the literal `ProviderAdapter` in governed sources. They now allow only the Vexa-owned `IntelligenceProviderAdapter` name (negative lookbehind in `validate-ai-core-provider-payload-dry-run.cjs` and `validate-ai-pol-tenant-policy-runtime.cjs`; `intelligence.module.spec.ts` strips that exact name before asserting). Any other `*ProviderAdapter` is still rejected. The boundary file is named `intelligence-adapter-boundary.ts` so the AI-CORE-003 persistence guard's `*provider*` import rule is unchanged.

## Acceptance

| Item | Evidence |
|---|---|
| Provider-neutral interface | `IntelligenceProviderAdapter`; stub adapter test |
| Fixture implements it | `implements IntelligenceProviderAdapter`; validator check |
| Adapter exception normalization | throwing-adapter and classified-error tests |
| Safe error sanitization | raw text with URL/key/bearer/request id absent from serialized result |
| finishStatus enforcement | failed, blocked and unknown-status tests |
| Malformed output / missing provenance | dedicated tests |
| Blocked-field short circuit | adapter never invoked for blocked input |

`schemaValid = true` still means structurally valid, policy-valid, provenance-valid and safe to process. It is not factual correctness; that remains a Golden Catalog / PIM SME evaluation concern.
