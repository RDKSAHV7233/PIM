# INC-10 — Connector Idempotency Test Diagnostic

**Status:** Diagnostic notes for the connector lead picking up `INC-10 ST-FK-RUNTIME-003/004/005`.
**Author:** CTO, 2026-05-17.
**Purpose:** Reduce ramp-up time when this ticket is staffed.

---

## Current state

- `scripts/run-increment-gates.cjs` includes `Integration: connector idempotency` with `allowFailure: true`.
- Comment in source: *"Flipkart publish loop is incomplete (INC-10: ST-FK-RUNTIME-003/004/005 in_progress). Known-failing until Flipkart credential runtime and real publish path are implemented."*
- `INCREMENT_STATE.json` confirms ST-FK-RUNTIME-003 is `in_progress` and has reopened-reason: *"Tenant-safety hardening found remaining credential-path raw SQL in the live Flipkart connector runtime."*
- Regression evidence cites three `RLS-BYPASS` raw SQL sites in `apps/api/src/connectors/flipkart/flipkart.connector.ts` lines 495, 530, 723.

The known-failing posture is **documented and bounded** — it's not a hidden defect. But the sunset condition is INC-10 closure (ADR-006 in this branch).

---

## What the idempotency test actually does

`apps/api/test/integration/connector-idempotency-semantics.test.cjs` (648 lines) is a high-quality end-to-end test that:

1. Boots the real API binary at a random port.
2. Spins up an HTTP stub at `127.0.0.1:<random>` that serves:
   - `POST /oauth-service/oauth/token` → returns `{ access_token: "stub-access-token", ... }`
   - `POST /sellers/listings/v3/skus/listings/update` → returns 500 on the **first** call, 200 on the second call (simulates transient failure → retry).
3. Sets `PIM_FLIPKART_OAUTH_BASE_URL=stub.baseUrl` only. `PIM_FLIPKART_API_BASE_URL` is intentionally left unset.
4. Relies on `flipkart.connector.ts:resolveApiBaseUrl()` falling back to `${oauthBaseUrl}/sellers` when `PIM_FLIPKART_API_BASE_URL` is empty. The fallback produces exactly the path the stub serves.
5. Seeds Flipkart credentials directly via `PrismaDirectService` + `ConnectorCredentialEncryptionService` (bypasses OAuth flow for the install step).
6. Creates a product → variant → category → installation → export job → process attempt #1 (expects `retrying`) → requeue → process attempt #2 (expects `completed`).
7. **Asserts:** the `connector_submissions` table has exactly 1 row with `idempotency_key = "{jobId}:PUBLISH"` and `attempt_number >= 2` after the retry.
8. **Asserts:** no other idempotency keys for the same job exist (no attempt-number-keyed duplicates).
9. Asserts cross-tenant isolation: a fixture row in tenant B with the same idempotency key remains visible only to tenant B.

The test design is solid. The contract it enforces is exactly the idempotency-key semantics the connector should honor.

---

## Most likely failure modes

I could not run the test live (no local Postgres in the diagnosing environment). Based on structural analysis only, these are the candidates in order of probability:

### Probability 1 — Credential resolution path returns no credential row

The `seedCredentials` helper writes encrypted credentials via `ConnectorCredentialEncryptionService.storeCredential()`. But the Flipkart connector's `getCredentialRow()` at `flipkart.connector.ts:530` reads via `$queryRawUnsafe<CredentialRow[]>(...)`. If the raw SQL filter does not match what the seeder wrote (e.g., `tenant_key`, `key_version`, `status` columns), the read returns zero rows and the publish fails before reaching the stub.

**Action:** Compare the `INSERT` shape in `ConnectorCredentialEncryptionService.storeCredential` against the `SELECT` predicate at `flipkart.connector.ts:530`. Confirm `tenant_key`, `installation_id`, and `status` (`active` vs `error` vs `expired`) match.

### Probability 2 — `RLS-BYPASS: manual tenant filter` paths bypass tenant context

The three sites at lines 495, 530, 723 use `$queryRawUnsafe` / `$executeRawUnsafe`. They include a manual `WHERE tenant_key = $1` clause but bypass the RLS-aware Prisma client extension (ADR-001). The flagged risk in `INCREMENT_STATE.json` is that the manual filter is correct but easy to drift — for example, if a new credential field is added to the SELECT, the bypass path won't know to filter by it.

**Action:** Re-audit each `RLS-BYPASS` site. Confirm the manual filters cover every dimension the Prisma client extension would cover (tenant + ownership + visibility). Consider refactoring to use Prisma typed queries through `prismaDirect.tenant(tenantKey).connectorCredential.findFirst(...)` instead of raw SQL.

### Probability 3 — Queue worker race

The test sets `QUEUE_WORKER_ENABLED=false` (line 76 of the test) specifically to avoid background processing racing with the explicit HTTP `/process` calls. If a recent change made the queue worker partially active even with that flag, both the stub-driven path and an internal worker path could create competing submission rows.

**Action:** Verify `QUEUE_WORKER_ENABLED=false` is honored by both `bullmq` and `memory` backends in `apps/api/src/queue/queue.service.ts`. Recent commit `ac6fa68 fix(queue): respect QUEUE_WORKER_ENABLED for memory backend; fix idempotency test` suggests this was already addressed, but verify it didn't regress.

### Probability 4 — Idempotency key formula changed

The test expects `stableKey = ${jobId}:PUBLISH` (line 456). If the connector framework's `buildIdempotencyKey()` was changed to include the attempt number, the test fails the "no attempt-number-keyed duplicates" assertion.

**Action:** Grep `buildIdempotencyKey` in `apps/api/src/connector-framework/`. Confirm the formula is `{jobId}:{operationType}` and stable across retries.

---

## Suggested closure path

1. **Spike (0.5 day):** Run the test against a fresh local DB. Capture the exact failure stack and which assertion fails.
2. **Diagnose (1 day):** Based on the stack, pinpoint which of the 4 candidates above (or a fifth not yet identified) is the actual failure.
3. **Fix (1–2 days):** Implement the fix. If the issue is in `RLS-BYPASS` paths, prefer the refactor to typed Prisma queries — that closes ST-FK-RUNTIME-003's reopened-reason in the same patch.
4. **Verify (0.5 day):** Run the test twice consecutively against fresh DBs. Both must pass without `allowFailure`.
5. **Close (0.5 day):** Remove `allowFailure: true` from `scripts/run-increment-gates.cjs`. Update ST-FK-RUNTIME-003/004/005 in `INCREMENT_STATE.json` to `completed`. Update ADR-006 to mark the outstanding `allowFailure` item closed.

**Total estimate:** 4 engineering days (1.5 days below my earlier 5–6 day estimate). Reducing the estimate is contingent on the failure mode being one of the four candidates above. If it turns out to be something else, restore the 5-day budget.

---

## What does NOT need to change

- The stub design. The test correctly exercises the retry path.
- The URL fallback in `resolveApiBaseUrl()`. The `${oauthBaseUrl}/sellers` fallback is intentional and the stub matches.
- The idempotency contract itself (stable `{jobId}:{operationType}` key). The contract is the right semantic; the bug is in the implementation that satisfies it.

---

## Followups created by closure

When this lands:

- `ADR-006-allowfailure-sunset-policy.md` outstanding-items table becomes empty. Revisit the ADR — it can graduate to "Reference" status or be retired.
- The gate exit-0 will no longer carry a known-failing footnote, which means PO V5 sign-off can drop the conditional language around Flipkart reliability.
- Sales materials can claim "Flipkart idempotency-safe publish with continuous gate verification" as a proven, not bounded, claim.
