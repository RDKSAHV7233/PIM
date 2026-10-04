# AI-SEC-001 No Direct AI Product Write Guard

Status: Draft security evidence for VEXA-AI-001

Scope: Static guard for governed AI code paths

## Goal

Prove that governed VEXA-AI-001 code cannot silently introduce a direct canonical Product write path or reuse the legacy AutoSuggestions repair path.

This guard is intentionally static and non-runtime. It does not add provider execution, schema changes, API routes, application behavior, or Product Service mutation.

## Security Rule

AI-001 must preserve the core invariant:

```text
AI proposes. Vexa validates. People approve. Product Service mutates.
```

Governed AI code must not:

- Call Product mutation APIs directly
- Inject or import `CatalogService` as a shortcut to Product mutation
- Import or inject `AutoSuggestionsModule` or `AutoSuggestionsService`
- Add write HTTP decorators before the approved apply design exists
- Instantiate provider/model execution code before the provider boundary is approved

The initial governed scan set covers:

- `apps/api/src/intelligence`
- `apps/api/src/ai`
- `apps/api/src/ai-core`
- `apps/api/src/rejection-intelligence`

## Legacy Boundary

`apps/api/src/auto-suggestions/auto-suggestions.service.ts` is treated as a legacy excluded path for AI-001.

The guard may report that legacy AutoSuggestions contains a direct Product write, but that finding is informational as long as governed AI code does not import or call it.

## Files

- `scripts/validate-ai-sec-no-direct-product-writes.cjs`
- `scripts/validate-ai-sec-no-direct-product-writes.test.cjs`

## Verification

```powershell
node --check scripts/validate-ai-sec-no-direct-product-writes.cjs
node --check scripts/validate-ai-sec-no-direct-product-writes.test.cjs
node scripts/validate-ai-sec-no-direct-product-writes.test.cjs
node scripts/validate-ai-sec-no-direct-product-writes.cjs
git diff --name-only -- apps packages prisma .github docs/openapi.yaml docs/openapi.json docs/vexa-pim.postman_collection.json
```

The final scope command should produce no output. This guard is expected to remain a script-level proof until it is explicitly wired into CI by a separate governance decision.
