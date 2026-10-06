# SEC-DB-RLS-001 M1a: connector credential writes use the tenant client

Date: 2026-10-06
Baseline: `origin/main` at `37299a6b`
Issue: #1189. Plan: #1193 (M1 to M6). Lane: #1195. Identity foundation: #1198.
Type: **application change, no production behaviour change today** (the production runtime role is still a superuser, so row level security is bypassed either way). It makes the credential write path correct for the day the runtime role is restricted.

## 1. What changed

| File | Change |
|---|---|
| `connector-installer/credential-encryption.service.ts` | `storeCredential` writes through `PrismaService.tenant(input.tenantKey)` instead of the context-free client. `transaction()` now takes the tenant key and opens the transaction on that tenant's client. The new `PrismaService` constructor argument is optional only so that tests which build the service by hand (and run as the admin identity) are unchanged; Nest always injects it. |
| `connector-installer/connector-installer.service.ts` | the 10 `credentialEncryptionService.transaction(...)` call sites pass the `tenantKey` they already hold. Nothing else in the file changed. |
| specs | `connector-installer.service.spec.ts` mock updated for the new signature; four new tests in `credential-encryption.service.spec.ts` (tenant client used, two tenants on two clients, transaction on the tenant client, fallback without it). |
| `scripts/restricted-role-lane.v1.json` | `bulk-publish-runs-installation-filter` (a Shopify install for a non-default tenant) is removed from `expectedFailing`: it now passes as the restricted role, and the ratchet forces the removal. `connector-idempotency-semantics` **stays** tracked, with a corrected reason (see section 3). |

Why this is safe: the tenant client already injects the same `tenantKey` the code was passing explicitly, so for a superuser the rows read and written are identical. A credential write for tenant B now runs on tenant B's connection (`app.tenant_key` set), which is what the RLS policy requires.

## 2. Finding: two credential-rotation paths are cross-tenant, not mechanical

The inventory classed both files as B (known tenant, direct client) with a mechanical fix. Reading them shows otherwise:

- `ConnectorCredentialEncryptionService.rotateKey`: scans every tenant's credentials by key version. Operator procedure; no runtime caller.
- `ConnectorCredentialService.rotateAllCredentials`: the same sweep, and **the heartbeat calls it automatically on startup when the key version changed**.

Under a restricted runtime role both would see only the `default` tenant, so a key rotation would **silently re-encrypt one tenant's credentials and report success**. That is the silent failure class this programme exists to remove, and it sits directly under the paused secret-rotation work (#474). Both entries are reclassified to class A, remediation tenant-iteration, with a positive assertion (a non-default tenant's credentials are re-encrypted). They stay open in the inventory and are not changed here: iterating tenants versus running the sweep under an operator identity is a design choice that belongs with the M3 helper and the rotation plan, and should be decided before any key rotation or role cutover.

## 3. Evidence

Local lane run: PostgreSQL 16, API built from this branch, preload pointing the API at `vexa_runtime_ci` (NOSUPERUSER, NOBYPASSRLS, non-owner). Unit suites: 83 tests pass.

- `bulk-publish-runs-installation-filter` passes as the restricted role (the credential upsert that returned HTTP 500 now succeeds for a non-default tenant).
- **I expected `connector-idempotency-semantics` to pass too, and it does not.** The first lane run showed it failing with a missing-credentials error after `connector.credential.refresh_needed`: the Flipkart connector reads its own stored credentials through the context-free client (`flipkart.connector.ts`), so the write fix alone cannot satisfy it. That is M1b. The baseline entry stays, with the reason corrected, instead of the baseline being edited to fit.
- The first full run also showed `bulk-publish-runs-installation-filter` failing once with "API did not become healthy within 60000ms" while six tests ran at once on a busy machine; run alone it passes in 8 seconds. Treat that as a load-sensitive start-up timeout in the lane, not a product failure, and re-run before concluding anything if it recurs in CI.

## 4. Not in M1a

- The 16 connector files (`connectors/*`) that read or write credentials and submissions through the context-free client: M1b, mechanical, same pattern.
- `media/media.service.ts`: M1b.
- `shopify.connector.ts`: marked review, because it passes a transaction into `storeCredential`.
- Both rotation paths above.
- No production access, no credential change, no role change.
