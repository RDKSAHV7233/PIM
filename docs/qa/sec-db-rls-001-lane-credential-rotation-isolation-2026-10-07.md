# SEC-DB-RLS-001 lane: the credential-rotation test no longer rewrites other tests' credentials

Date: 2026-10-07
Baseline: `origin/main` at `b2d61b87`
Type: **test and CI tooling only.** No application change, no production access.

## 1. What failed, and the evidence

Two restricted-role-lane failures were unexplained and I did not claim a cause for either:

1. `main` at `ef144449` (a docs-only commit): `credential-rotation.test.cjs` failed; the message was lost (fixed by #1205); a re-run passed.
2. PR #1210 (this week): `shopify-publication-webhook.test.cjs` failed with **`Missing credential encryption key for version 2`**, a test that has nothing to do with #1210's code. #1205's failure-message capture is what made that line readable.

The message is the mechanism. `credential-rotation.test.cjs` calls `rotateKey` from key v1 to key v2 and rotates **every** v1 credential it can see; it also supplies the v2 key only to its **own** API process (`setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V2", ...)`). The restricted-role lane runs six tests at once against one shared database. If another test (here a Shopify test) has just stored a v1 credential, the rotation test rewrites it to v2, and that test's API process, which has no v2 key, cannot decrypt it. The same race also explains the earlier flake of the rotation test itself (it asserts `failed === 0`, and a concurrent test's half-written credential counts).

M1b added five connector tests to the lane that store credentials (including that Shopify test), which raised the chance of the collision. That is an effect of my earlier change on a test that was already hazardous, not a defect in #1210.

**Direct proof (run locally, shared database, a foreign tenant's v1 credential seeded first):**

| Rotation test | Foreign credential before | after | byte-identical |
|---|---|---|---|
| unfixed (from `main`) | v1 | **v2** | no |
| this change | v1 | v1 | **yes** |

## 2. Change

- `credential-rotation.test.cjs` now creates its own throwaway database, migrates it, runs entirely against it (its API process too; `VEXA_RESTRICTED_DATABASE_URL` is cleared so the lane preload does not repoint that API at the shared database), and drops it afterwards. Nothing it rotates can belong to another test. The test body and its assertions are unchanged; it now reports `rotated: 1`, only its own credential.
- The lane registers the two isolated rotation/iteration integration tests that are already on `main` (`tenant-iteration.test.cjs`, `credential-rotation-tenant-iteration.test.cjs`): 28 to 30 tests. The new rotation test already used its own database.

## 3. Evidence

- The old test passes on its own with the change (`status ok`), rotates one credential, and leaves no `credrot_*` database behind.
- Foreign-credential proof above.
- `validate-sec-restricted-lane` and its tests pass for 30 tests, 0 tracked expected failures.
- **Full lane (local PostgreSQL 16, API as `vexa_runtime_ci`): 30 pass, 0 expected failures, 0 unexpected failures, 0 unexpected passes.**

## 4. Limits

- Other tests that touch shared global state (for example anything that iterates every tenant) are not audited here; the two failures seen had this one cause. If another collision appears, the lane's failure messages now show it.
- Creating a database and migrating it adds roughly 10 seconds to that test.
- #1210's failure is not fixed by #1210; re-running its lane after this lands (or after merging this into it) should pass.
