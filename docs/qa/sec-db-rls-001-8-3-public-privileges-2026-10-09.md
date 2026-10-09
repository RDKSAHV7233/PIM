# SEC-DB-RLS-001 8.3: `PUBLIC` holds nothing, and every identity's access is an explicit grant

Date: 2026-10-09
Baseline: `origin/main` at `d812665d` (8.2 merged)
Issue: #1189. Plan: Sprint 8 (Stage 2, progressive hardening). Closes evidence-record gap G6 (decisions D-012, D-017: "`PUBLIC` holds database, schema, function or enum privileges beyond the minimum; level undecided").
Type: **tooling and rehearsal. No production access, no role, grant, ownership or credential change, no application change.** Nothing happens to production until the (HOLD) cutover runs the new administrator step. Stage 2 does not gate the cutover.

## 1. What `PUBLIC` holds today, and the target

| Object | Production fact (D-012, D-017) | Target |
|---|---|---|
| Database | `PUBLIC`: `CONNECT`, `TEMPORARY` | none; every identity has an explicit `CONNECT`; nobody has `TEMPORARY` |
| Schema `public` | `PUBLIC`: `USAGE` (no `CREATE`) | none; every identity has an explicit `USAGE`; only the migrator has `CREATE` |
| Functions (2, both trigger functions) | `PUBLIC`: `EXECUTE` | none |
| Enum types (31) | `PUBLIC`: `USAGE` | none; and no identity but the owner holds it |

Why it matters: with `PUBLIC` open, any role anyone creates (or any leaked credential for a role nobody remembers) can connect and see the schema, and every identity's access is partly accidental. After this, access is exactly the list in the manifest.

## 2. Two PostgreSQL facts decided the design, and the rehearsal proved both

My first design granted `USAGE` on the enum types to the runtime, ops and the reporter. The rehearsal showed that was wrong, and a smaller model is correct:
- **`USAGE` on a type does not control using its values.** A cast such as `'approved'::"RecordStatus"` works for a role with no `USAGE` (the backup role did it in the rehearsal). `USAGE` only controls creating objects that depend on the type, which the application never does. So `PUBLIC` loses it and **no identity but the owner is given it** (`manifest.public.enumTypeUsage` is empty; the rule is manifest-driven so a reviewed change can widen it).
- **A trigger function needs no `EXECUTE` for the trigger to fire**; only creating the trigger checks it. The rehearsal updates an `ai_suggestions` row as the runtime: the immutability trigger raises its own error, not "permission denied for function", while a direct call of the function is refused.

## 3. What changed

| Piece | Change |
|---|---|
| `identity-model.v1.json` | new `public` section: the target above, with the reasons |
| `scripts/db-identity/lib.cjs` | the verifier gains 18 checks: `PUBLIC` holds nothing on the database and the schema; no function executable and no enum type usable by `PUBLIC`; per identity: can connect and cannot create temporary tables, can use the schema, holds exactly the enum `USAGE` the model gives it. A state without these facts fails closed |
| `scripts/db-identity/tool.cjs` | gathers the facts (a `NULL` ACL is the built-in default, which includes `PUBLIC`, so it is read with `acldefault()` and not as "no grant"). New administrator modes **`narrow-public`** (grants the five identities explicit `CONNECT` and `USAGE`, then revokes `PUBLIC` on the database and the schema; refuses if an identity does not exist) and **`restore-public`** (the rollback). `apply-grants` also revokes `EXECUTE` on functions and `USAGE` on enum types from `PUBLIC` and sets the migrator's default ACL so objects created later are born closed |
| Strict deploy-time `apply-grants` | verifies the function and enum parts (the migrator owns them after the transfer). The database and schema parts can only be changed by the database owner, so there it only warns |
| `rehearse.cjs`, `lib.test.cjs` | see section 4 |
| `sec-db-rls-001-7-11-cutover-design-2026-10-08.md` | the sequence gains `narrow-public` and the rollback gains `restore-public` (content replaced, not annotated) |

The split matters for the deploy: the migrator cannot revoke what the database owner granted, so `narrow-public` is an administrator step at the cutover, while the function and enum closure rides on the `apply-grants` that already runs after every migration.

## 4. Verification

- **Rehearsal on real PostgreSQL, 237 of 237 on 16 and on 18** (was 211), on clusters that already held state from earlier runs (the refusal check was made rerun-safe). New proofs: a role that was never granted anything holds no `PUBLIC` privilege; a stranger role cannot connect; a role that can connect but was never granted the schema cannot read a table; none of the five identities can create a temporary table; the runtime, ops, reporter and backup roles still cast enum values; the immutability trigger still fires for the runtime; a type and a function the migrator creates later are born closed; `restore-public` really restores `PUBLIC` (database, schema, functions, types) and re-applying forward narrows it again; the fresh database is narrowed **before** the migrator builds it, so every migration is proven to need nothing from `PUBLIC`; `narrow-public` refuses while an identity is missing; a database nobody has granted anything on is reported as open to `PUBLIC`.
- **Probe proof 40 of 40 on 16 and 18.** `db-identity/lib.test.cjs` (16 new mutations, the fail-closed case and the widening case), `tool.test.cjs`, the lane guard, the call-site ratchet and the 7.9 tests pass.
- **Mutation check:** **17 of 17 caught.** Library (8, by `lib.test.cjs`): each new check forced to pass, and the strict deploy-time responsibility pattern losing the function and enum checks. Tool (9, by the real rehearsal): `narrow-public` leaving `PUBLIC` on the database or on the schema; `apply-grants` leaving `EXECUTE` on functions or `USAGE` on enum types; no default ACL for later functions or later types; `restore-public` not restoring the functions; a never-touched database ACL read as "no grant"; `narrow-public` no longer refusing when an identity is missing. **One mutant survived at first** (the never-touched ACL: the starting state fails the verifier for other reasons, so nothing exercised that path); I added a rehearsal proof on a database nobody has granted anything on and re-ran the mutant, which is now caught. The original files were restored after each mutant.
- The v2 rehearsal in CI runs the whole API and the restricted-role lane as `vexa_runtime` against the narrowed database; that is the end-to-end proof that nothing the application needs was lost.

## 5. Risks and what remains

- **`narrow-public` removes `CONNECT` from every role that is not one of the five.** The 2026-10-06 probe found only `postgres` and `vexa_app_v2` (both superusers, unaffected). The cutover design reads the role list again immediately before the step. A platform tool that connects as some other role would be cut off, which is why it is an administrator step with a tested rollback.
- Nothing ran against production. The effect applies at the cutover.
- Lane coverage is the lane's; a path no lane test exercises is not proven by it (8.4).
- Sprint 8 remaining: **8.4**, expand the lane and list its untested call sites, and decide row level security or a documented exemption for `AuthIdentity`, `WorkspaceDirectory`, `api_access_keys` and `stripe_webhook_events` (record D-020).
