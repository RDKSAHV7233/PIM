---
title: Shopify vNext Mutation #2 — Pre-Authorization Engineering Evidence
status: awaiting_cto_authorization
prepared_at: 2026-10-02T10:09:11Z
head_sha: f5d73bb
owner: engineering
---

# Shopify vNext Mutation #2 — Pre-Authorization Engineering Evidence

This document records the engineering gate evidence required by
`VNEXT_MUTATION_CONTROLLED_EXPANSION_CHECKLIST.md §Authorization Packet` before
mutation #2 may be authorized.

It does **not** constitute authorization. Authorization requires a fresh CTO
decision on a deployed production SHA: `AUTHORIZE SECOND CONTROLLED MUTATION`.

---

## 1. Head Commit Under Review

```
commit: f5d73bb
message: fix(shopify): explicit pre-write outbound payload scope gate + mutation payload checksum (#1026)
```

This is the tip of `main` as of 2026-10-02T10:09:11Z, incorporating 15 commits
since mutation #1 (7a461521). All 15 commits are Shopify vNext canary execution
fixes authored on main branch.

---

## 2. Gate Suite Results (required by checklist)

### 2a. Focused vNext Gate Suite

```
Test Suites: 2 passed, 2 total
Tests:       36 passed, 36 total
Time:        6.177 s
```

Command: `npx jest --config jest.config.js --testPathPatterns "shopify.*vnext|vnext.*shopify|controlled.mutation" --runInBand --no-coverage`

### 2b. Env-Validation Integration Tests

```
Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
Time:        5.521 s
```

Command: `npx jest --config jest.config.js --testPathPatterns "env-validation|vnext.env" --runInBand --no-coverage`

### 2c. Full API Unit Test Suite

```
Test Suites: all passed
Tests:       2376 passed, 18 skipped, 0 failed
```

Command: `npm run test:unit --workspace @pim1/api -- --runInBand --no-coverage`

Note: 18 skipped tests are Redis-dependent and expected to be skipped without a live Redis instance.

### 2d. API TypeScript Type Check

```
Result: 0 errors
```

Command: `npx tsc --noEmit --project apps/api/tsconfig.json`

---

## 3. Connector Inventory (no new blockers)

```
- ERROR (architecture invariant violation — CI blocks): 0
- WARNING (incomplete/unverified state — CI reports): 0
- INFO (schema-template-stale): 3 (Meesho/Myntra/Nykaa — expected, tracked under INC-62)
```

The 3 INFO findings are expected and tracked under INC-62 (blocked on PO/partner
template re-verification). They do not block mutation #2.

---

## 4. New Capabilities in f5d73bb vs Mutation #1 (7a461521)

The 15 commits between mutation #1 and current HEAD add the following to the
controlled mutation execution path:

| Commit category | Change |
| --- | --- |
| Pre-write outbound scope gate | Explicit `outbound_payload_not_image_only` gate after `detectUnauthorizedShopifyVnextFieldDiffs` — blocks if any non-image field slips through |
| Mutation payload checksum | SHA-256 computed over narrowed `files` input; recorded in authorization evidence and audit |
| `this`-binding fix | `attemptShopifyControlledMutation` bound correctly; previously could silently use wrong context |
| Re-throw propagation | `ShopifyControlledMutationError` now re-thrown instead of being swallowed |
| Queue-native terminal detection | Authoritative BullMQ drain proof replaces timing-based terminal detection |
| CategoryId bypass fail-closed | `categoryId` absent in vNext path now fails closed instead of falling through to legacy path |
| Railway old-instance race guard | Prevents stale Railway instances from executing after new deploy |

These changes strengthen the safety envelope of the controlled mutation path.
Mutation #1 ran without these fixes; mutation #2 benefits from all of them.

---

## 5. Items Still Required for Full Authorization Packet

The following items require production/CTO-level access and cannot be
generated from this repository alone:

- [ ] One tenant, connector, installation, product, and Shopify product GID (from production)
- [ ] Deployed release SHA matching `RAILWAY_GIT_COMMIT_SHA` on staging/production
- [ ] `VNEXT_MUTATION_APPROVED_RELEASE_SHA` value for mutation #2 window
- [ ] Fresh `captureRollbackSnapshot` output from the deployed version
- [ ] Staging configuration matrix run (all 9 rows in checklist table)
- [ ] Read-only fixture matrix evidence (12 cases in checklist table)
- [ ] Payload checksum for the exact narrowed `files` mutation input
- [ ] Authorization window expiration time
- [ ] CTO authorization: `AUTHORIZE SECOND CONTROLLED MUTATION`

---

## 6. Gate Status (Engineering)

| Gate | Status |
| --- | --- |
| vNext gate suite (36 tests) | ✅ PASS |
| Env-validation integration (9 tests) | ✅ PASS |
| Full API unit suite (2376 tests) | ✅ PASS |
| API typecheck | ✅ CLEAN |
| Connector inventory (no new blockers) | ✅ CLEAN |
| Staging config matrix | ⏳ Requires deploy + CTO |
| Production authorization packet | ⏳ Requires CTO sign-off |

---

_Engineering gates satisfied on commit f5d73bb at 2026-10-02T10:09:11Z._
_Full authorization requires CTO to issue `AUTHORIZE SECOND CONTROLLED MUTATION`_
_with a populated production authorization packet per the expansion checklist._

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_019Y4jS6bJx3tJS3w3MxQTUG
