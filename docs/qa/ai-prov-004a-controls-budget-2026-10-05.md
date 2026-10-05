# AI-PROV-004a Controls and Budget Evidence

Date: 2026-10-05
Baseline: `origin/main` at `e9349ed5a5beca49c9706599ed5956b5ce65860e`
Type: controls-only implementation evidence.

## Scope

AI-PROV-004a adds internal provider-execution eligibility and budget reservation controls only.

It does not add:

- provider SDKs;
- provider credentials;
- outbound provider requests;
- live adapter configuration;
- public write routes;
- Product mutation;
- AutoSuggestions reuse;
- suggestion persistence from the eligibility path.

## Implemented Controls

- Provider-neutral budget policy table.
- Provider-neutral budget reservation table.
- Tenant-scoped RLS on both tables.
- Fail-closed defaults: no existing or new tenant is enabled by migration.
- Integer cost accounting in micros.
- Execution eligibility result with `ALLOW` / `DENY`.
- Platform feature flag input that denies unless explicitly true.
- Platform kill-switch input.
- Tenant policy approval checks.
- Positive live payload cap requirement.
- Capability and provider allow-list checks.
- Missing, invalid, disabled, expired, mismatched, or exhausted budget denial.
- Idempotent matching reservation reuse.
- Atomic reservation shape using one conditional tenant-scoped update.
- Zero provider call and zero Product mutation invariants in the result.

## Local Verification

```text
npm run prisma:generate
node scripts/validate-ai-prov-provider-execution-eligibility.test.cjs
node scripts/validate-ai-prov-provider-execution-eligibility.cjs
npm run test:unit --workspace @pim1/api -- --runTestsByPath src/prisma/extensions/tenant-scope.spec.ts --runInBand --no-coverage
npm run test:unit --workspace @pim1/api -- --runTestsByPath src/intelligence/intelligence.service.spec.ts src/intelligence/intelligence.module.spec.ts src/intelligence/intelligence.controller.spec.ts src/intelligence/intelligence-capability.registry.spec.ts src/intelligence/ai-eval-fast.spec.ts src/intelligence/ai-eval-scorers.spec.ts src/intelligence/intelligence-payload-policy.spec.ts src/intelligence/intelligence-secret-detection.spec.ts --runInBand --no-coverage
Get-ChildItem -LiteralPath scripts -Filter 'validate-ai-*.cjs' | Sort-Object Name | ForEach-Object { node $_.FullName }
npm run build --workspace @pim1/api
node scripts/check-unsafe-raw-comments.cjs
git diff --check
```

Results:

- Prisma generate: PASS.
- New AI-PROV-004a validator: PASS.
- Tenant-scope drift guard: 1 suite / 5 tests PASS.
- Focused intelligence Jest: 8 suites / 381 tests PASS.
- All `validate-ai-*.cjs` governance validators: PASS.
- API build: PASS.
- Unsafe raw Prisma call guard: PASS.
- Diff check: PASS with line-ending warnings only.

## Merge Hold

The prior post-merge CI hold for `d833b403` is clear. PR `#1173` is merged and its CI rollup is green:

- `detect-changes`: SUCCESS
- `build`: SUCCESS
- `connector-network-transport (22)`: SUCCESS
- `connector-network-transport (24)`: SUCCESS
- `backend-tests`: SUCCESS
- `e2e`: SUCCESS

AI-PROV-004 live provider work remains blocked until Security records AI-POL-003 approval, Privacy decisions are complete, provider/model approval is recorded, feature flag and kill switch are proven, and budget controls are accepted.
