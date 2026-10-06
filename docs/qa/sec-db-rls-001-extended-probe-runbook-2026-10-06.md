# SEC-DB-RLS-001: running the extended read-only production probe

Date: 2026-10-06
Issue: #1189. Decision pack: #1188. Call-site classification: #1193. Identity model: #1198.
Type: **runbook for a human-authorized, read-only production probe. Nothing here changes a grant, owner, role, RLS setting, credential or connection.**

## 1. Why a second probe run

The first production probe (#1190, recorded in `sec-db-rls-001-investigation-2026-10-06.md` section 8) established who the runtime role is, who owns what, and RLS coverage. The remediation design also needs facts it did not capture. The extended probe answers all of them in one run:

| Question | Probe section |
|---|---|
| Role flags: superuser, BYPASSRLS, inherit, login, connection limit, expiry | `connected identity`, `roles (...)` |
| Role memberships, with admin / inherit / set options | `role memberships` |
| Per-role and per-database settings that could change RLS or the search path (keys; values only for an allow-list) | `role and database settings (...)` |
| Database `CONNECT` / `TEMPORARY` / `CREATE`, including the implicit defaults | `database privileges (ACL, ...)` |
| Schema `USAGE` / `CREATE`, including the implicit defaults | `schemas`, `schema privileges (ACL, ...)` |
| Table, view and sequence ownership and ACLs | `object ownership ...`, `relation privileges held by roles other than the owner ...`, `relations that carry a non-owner privilege` |
| Function and procedure ownership, security-definer, and who may `EXECUTE` | `functions and procedures (...)` |
| Enum type usage | `enum types: privileges held by roles other than the owner` |
| Default privileges, event triggers, views | `default privileges`, `event triggers`, `views and materialized views` |
| RLS enabled / forced per table, and the tenant-key column | `row level security per table (...)` |
| **Every RLS policy: roles, command, USING, WITH CHECK** | `RLS policies (every policy ...)`, `distinct policy expressions (grouped)` |
| What the connected role can actually do (counts by privilege) | `effective privileges of the connected role` |
| Plain facts for the evidence record | `derived findings (...)` |

## 2. What it is allowed to do

- It runs inside a **READ ONLY transaction**; the database itself rejects any write. It also sets a 30 s statement timeout and a 5 s lock timeout so a slow catalog scan cannot hold anything on production.
- It sends only the statements listed in `scripts/sec-db-rls-001-probe-lib.cjs`. `scripts/sec-db-rls-001-probe.test.cjs` pins every one: each must be a `SELECT`, with no write or DDL keyword, no second statement, and no secret-bearing catalog (`pg_authid` is never read, so password hashes are never touched). A mutation of any statement into a write is detected.
- Output is role names, object names, ACLs, policy expressions, counts and booleans. A guard **refuses to print** any connection string or any secret taken from the connection URL. If a catalog cannot be read by the connected role, that one section is marked `{"unavailable": true, "reason": ...}` and the probe continues.
- It never prints, stores or transmits the connection URL.

## 3. How to run it (a person with production access)

Run from a checkout at the merged commit, after `npm ci` and `npx prisma generate`. Run it **once per database**, with the same role the application uses (so it reports production as the application sees it).

Main database, using the deployed environment's own variable (the probe reads the named variable; it never guesses):

```bash
PROBE_DATABASE_URL_FROM=DATABASE_URL_DIRECT PROBE_OUT=probe-main.json node scripts/sec-db-rls-001-probe.cjs database > probe-main.txt
```

Observability database:

```bash
PROBE_DATABASE_URL_FROM=OBSERVABILITY_DATABASE_URL PROBE_OUT=probe-observability.json node scripts/sec-db-rls-001-probe.cjs database > probe-observability.txt
```

What each service resolves to (user, database, host kind, fingerprint; never the URL):

```bash
PROBE_ENV_VARS=DATABASE_URL,DATABASE_URL_DIRECT,DATABASE_URL_POOLED,OBSERVABILITY_DATABASE_URL node scripts/sec-db-rls-001-probe.cjs service-identity > probe-identity.txt
```

The last line of each output must be `RESULT: COMPLETE`. Attach `probe-main.txt`, `probe-observability.txt`, `probe-identity.txt` and the `.json` files to the evidence record. Before attaching, search them for `postgres://`, `postgresql://` and the password (the guard makes a match impossible, but check).

## 4. What not to do

- Do not run it with any variable other than the four it allows.
- Do not edit the script to "also print" anything. If a fact is missing, extend the lib and the test in a reviewed change.
- Do not run any write mode of `scripts/db-identity/tool.cjs` against production. Those modes refuse any non-local host; this runbook never needs them.
- This probe authorizes nothing else: no role creation, grant, ownership transfer, `DATABASE_URL` change or RLS change.

## 5. After the run

The evidence record (`docs/qa`) will quote the `derived findings` section, so each claim is traceable to a raw section above it. The remediation sequence is designed afterwards around the merged I1 tooling, with no production credential or ownership change until separately authorized.

## 6. How the probe itself was verified (before it is trusted on production)

`scripts/sec-db-rls-001-probe-proof.cjs` builds a **local** production-shaped database (all migrations, then a superuser that owns exactly the 15 tables, 2 functions and 9 enum types observed in production), runs the probe as that superuser, applies the I1 target model, and runs the same probe as each target identity. Every claim is cross-checked against an independent catalog query. It refuses any non-local host.
