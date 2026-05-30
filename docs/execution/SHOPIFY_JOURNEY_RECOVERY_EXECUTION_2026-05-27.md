# Shopify Journey Recovery Execution 2026-05-27

## Purpose

Record the bounded CTO recovery work for the Shopify managed-install browser journey:

1. Fix pre-auth Shopify connector detail behavior so publication targets are not fetched during `awaiting_managed_install`.
2. Remove the Playwright API runtime shim and restore direct API startup from compiled output.
3. Harden the targeted Shopify journey runner so it rebuilds truthfully by default and uses one authoritative Shopify stub path.

## Scope

Product/UI scope:

- `apps/web/src/app/channels/connectors/[installationId]/page.tsx`
- `apps/web/test/integration/channel-connector-detail-shopify-ui.test.cjs`
- `apps/web/test/integration/shopify-managed-install-handoff-ui.test.cjs`

Platform/harness scope:

- `scripts/start-playwright-api.cjs`
- `scripts/run-playwright-shopify-connector-journey.cjs`
- `scripts/playwright-api-entry.cjs` (removed)

## Changes Delivered

### 1. Shopify pre-auth product correctness

- Added `shopifyAwaitingManagedInstall` gating in connector detail.
- Stopped `getConnectorPublications(...)` from running while Shopify is still waiting for managed install completion.
- Kept the Credentials tab in guidance mode until OAuth/token exchange completes.
- Updated existing Shopify UI contract tests to assert the new pre-auth behavior.

### 2. Playwright API startup truth

- Removed the runtime shim layer that previously patched compiled RBAC output before starting the API.
- Updated `scripts/start-playwright-api.cjs` to launch `apps/api/dist/main.js` directly.
- Deleted `scripts/playwright-api-entry.cjs`.

### 3. Shopify journey harness integrity

- Removed the dead duplicate Shopify stub implementation from `scripts/run-playwright-shopify-connector-journey.cjs`.
- Changed the targeted runner to rebuild API and web by default before the journey runs.
- Preserved a bounded explicit local escape hatch via `PLAYWRIGHT_SKIP_TARGETED_PREBUILD=1`, which now fails closed if required build artifacts are missing.
- Kept `PLAYWRIGHT_SKIP_API_BUILD=1` and `PLAYWRIGHT_SKIP_WEB_BUILD=1` only for the webServer handoff after the targeted prebuild has already completed.

## Verification Commands

Executed during recovery:

- `node apps/web/test/integration/channel-connector-detail-shopify-ui.test.cjs`
- `node apps/web/test/integration/shopify-managed-install-handoff-ui.test.cjs`
- `npm run build --workspace @pim1/web`
- `npm run build --workspace @pim1/api`
- direct API startup proof against `apps/api/dist/main.js` under Playwright-style environment values
- `npm run test:e2e:shopify-connector-journey`

## Verification Results

- Shopify detail UI contract: passed
- Shopify managed-install handoff UI contract: passed
- Web build: passed
- API build: passed
- Direct API startup health proof: passed
- Targeted Shopify managed-install browser journey: passed

## Regression Evidence Encountered and Resolved

While removing the startup shim, one truthful-path failure was surfaced and corrected:

- Failing command: `npm run test:e2e:shopify-connector-journey`
- Failing output snippet: `Cannot find module 'C:\\Users\\Om Computers\\PIM1\\apps\\api\\dist\\main.js'`
- Likely file responsible: `scripts/start-playwright-api.cjs`

The startup path was corrected and the targeted journey was rerun successfully on the direct API boot path.

## Remaining Non-Blocking Notes

- Playwright startup still emits unrelated warnings about active connector definitions without runtime implementations. These were pre-existing and did not block the Shopify recovery scope.
- No broader product, auth, or billing behavior was changed beyond the bounded startup-path cleanup already validated by the targeted Shopify flow.

## INCREMENT_STATE Governance

No `docs/execution/INCREMENT_STATE.json` update was made in this recovery because no matching unlocked Shopify recovery story was found that cleanly mapped to this bounded execution slice.

## Outcome

The Shopify managed-install journey is now:

- product-correct in pre-auth state
- started through the real API runtime
- verified through a rebuild-by-default targeted harness with one authoritative stub path
