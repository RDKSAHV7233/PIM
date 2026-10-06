# SEC-DB-RLS-001: production database identity evidence record

> **STATUS: RAW COMPLETE and VALIDATED for all three evidence sets (main, observability, service identity).** RAW observations are in the companion register `SEC-DB-RLS-001-production-identity-raw-register-2026-10-06.md` (R-001 to R-432). Validation done: each output ends `RESULT: COMPLETE`, no section is `unavailable`, the secret scan is clean, the SHA-256 values are recorded in section 21. DERIVED lines are written only after this point and each cites RAW ids.

Issue #1189. Decision pack #1188. Call-site classification #1193. Identity model #1198. Probe #1190 / #1199 (runbook: `sec-db-rls-001-extended-probe-runbook-2026-10-06.md`).

## How to read this record

Four rules keep it auditable.

1. **Raw observation and derived conclusion are always separate.** A line is either `RAW` (copied from a probe section, with its id) or `DERIVED` (a conclusion that cites the RAW ids it rests on). A DERIVED line with no RAW citation is invalid.
2. **Every statement carries one of these states and never mixes them:**

| State | Meaning | Allowed source |
|---|---|---|
| `CURRENT PRODUCTION FACT` | observed in production by the probe | a RAW line from the COMPLETE outputs |
| `PROPOSED TARGET STATE` | what the remediation intends | the identity model / design; **not proven** |
| `VERIFICATION REQUIRED` | something that must be shown before it is claimed | names the check that would show it |
| `GOVERNANCE DECISION` | a decision recorded by the owner about what the evidence means for the target model; not an observation | the owner's recorded instruction, with its date |
| `REMEDIATION REQUIRED` | work that must be done before the gate can close; not proof that anything is done, and it does not prescribe the fix | a `GOVERNANCE DECISION` or a gap in the exit criteria |

3. **Repo facts are labeled `REPO FACT` with a commit.** They describe code and manifests, not production (for example the call-site classification). They never stand in for a production fact.
4. **Work in this order, never the reverse:** (a) enter RAW lines from the evidence; (b) validate completeness, the secret scan and the file hashes (section 3); (c) only then write DERIVED lines. A conclusion is never drafted first and matched to evidence afterwards.

RAW line format (one per fact, ids are sequential and never reused):

```
R-014  main  "connected identity"  rolsuper = [ ]   (probe-main.json: sections["connected identity"].rolsuper)
```

DERIVED line format:

```
D-006  [CURRENT PRODUCTION FACT | PROPOSED TARGET STATE | VERIFICATION REQUIRED]  <conclusion>   cites: R-014, R-015
```

---

## 1. Purpose

Why this record exists: to state, from observed production evidence, whether tenant isolation by row-level security is enforced for the ordinary runtime identity, what changing that would break, and what must be proven before SEC-DB-RLS-001 closes.

## 2. Scope and non-goals

In scope: the main database (`Postgres`) and the observability database (`Postgres-MSwk`), as seen by the probe; the application, workers, migrations, backups and operator workflows that use them.

Non-goals (this record authorizes none of these): creating or altering any role, grant, ownership, RLS setting, `DATABASE_URL` or credential; running any write mode of `scripts/db-identity/tool.cjs` against production; unblocking publication-target (5.1d) exposure or enforcement.

Objective being tested (owner, 2026-10-06): *the ordinary Vexa runtime identity must be unable to bypass database tenant isolation accidentally or implicitly; cross-tenant access must require an explicit, separately governed privileged path.* This record does **not** claim RLS alone makes cross-tenant access impossible against a fully compromised API, because tenant context is supplied by the client through the connection option `app.tenant_key`.

## 3. Evidence provenance

| Field | Main database | Observability database | Service identity (`probe-identity`) |
|---|---|---|---|
| Repo commit the probe ran from | `9454c30d` | `9454c30d` (deployment `c43e41e4`) | `9454c30d` |
| Probe version (`probeVersion` in the JSON) | 2 (R-311) | 2 (E-4) | not recorded in the output |
| Execution timestamps (`startedAt` / `finishedAt`) | 2026-10-06T17:48:48.778Z / 2026-10-06T17:49:30.096Z (R-311) | 2026-10-06T18:33:27.024Z / 2026-10-06T18:33:27.308Z (E-4; second run, see the register) | not in the output; run the same session, 2026-10-06 |
| Operator (role, not credentials) | Claude Code session using the authorized Railway CLI login, read-only | the CTO / Product Owner, in the API service's Railway Console | Claude Code session, same login |
| Connection source (`PROBE_DATABASE_URL_FROM` / `PROBE_ENV_VARS` variable names) | `DATABASE_URL_DIRECT` | `OBSERVABILITY_DATABASE_URL` (private-network host, run from inside Railway) | `DATABASE_URL`, `DATABASE_URL_DIRECT`, `DATABASE_URL_POOLED`, `OBSERVABILITY_DATABASE_URL` |
| Database name and server major version | `railway`, PostgreSQL 18 (R-011 to R-013) | `railway`, PostgreSQL 18 (R-327 to R-329) | n/a |
| Final line `RESULT: COMPLETE` | yes | yes in the `.txt` (R-432) and `result` = `COMPLETE` in the `.json` | yes (R-316) |
| Sections marked `unavailable` | none (`sectionsUnavailable` is empty) | none (`sectionsUnavailable` is empty in both files, R-402) | none |
| Secret scan of the attached files (`postgres://`, `postgresql://`, the password) | clean | clean (`.txt` and `.json`) | clean |
| Evidence files attached (name, SHA-256) | E-1, E-2 (section 21) | E-3 and E-4 verified (section 21) | E-5 (section 21) |

**Completeness gate (all three outputs, not only the two database probes).**
- If a database output is not `COMPLETE`, or any of its sections is `unavailable`, the sections that depend on it (5 to 12, and 14 to 15 where they cite it) are marked `INCOMPLETE` for that database, and nothing is concluded from the missing part.
- Sections that depend on `service-identity` (section 4, and every DERIVED line that cites it) remain **`INCOMPLETE` unless `probe-identity` is present, secret-clean, hashed, and its execution completed successfully** (`RESULT: COMPLETE`). Two complete database probes do not make section 4 complete.

## 4. Production service identity resolution

Source: `service-identity` probe (user, database, host kind, fingerprint; never the URL).
**Gate:** this section stays `INCOMPLETE` unless `probe-identity` meets the completeness gate in section 3 (present, secret-clean, hashed, completed successfully), regardless of the state of the two database probes.

| Variable | Database user | Database | Host kind | Host fingerprint | `sslmode` present |
|---|---|---|---|---|---|
| `DATABASE_URL` | `vexa_app_v2` | `railway` | public-proxy | `8591c6edb877` | no |
| `DATABASE_URL_DIRECT` | `vexa_app_v2` | `railway` | public-proxy | `8591c6edb877` | no |
| `DATABASE_URL_POOLED` | `vexa_app_v2` | `railway` | public-proxy | `8591c6edb877` | no |
| `OBSERVABILITY_DATABASE_URL` | `postgres` | `railway` | private-network | `80143b8054c0` | no |

RAW: R-312 to R-316 (`probe-identity.txt`, `RESULT: COMPLETE`, secret-clean, hashed E-5). Gate state: the identity evidence meets the completeness gate; the observability database probe is now present (`.txt`, hash-verified).
DERIVED:
- D-001  [CURRENT PRODUCTION FACT]  `DATABASE_URL`, `DATABASE_URL_DIRECT` and `DATABASE_URL_POOLED` resolve to the same role (`vexa_app_v2`), database (`railway`), host kind (public-proxy) and host fingerprint (`8591c6edb877`); the pooled variable is not a separate endpoint.   cites: R-312, R-313, R-314
- D-002  [CURRENT PRODUCTION FACT]  All three API variables resolve over the public proxy; none uses the private network.   cites: R-312, R-313, R-314
- D-003  [CURRENT PRODUCTION FACT]  The observability variable uses a different role (`postgres`), a different host (fingerprint `80143b8054c0`) and the private network. Its one observed session is `postgres` from application `vexa-error-authority`, which agrees.   cites: R-315, R-393
- D-004  [CURRENT PRODUCTION FACT]  None of the four variables carries an `sslmode` parameter; both servers report `ssl = on`. Whether the clients negotiate TLS is not shown by the probe: [VERIFICATION REQUIRED] (section 18).   cites: R-312, R-313, R-314, R-315, R-273, R-394
- D-005  [CURRENT PRODUCTION FACT]  When the probe ran, all 10 sessions on the main database were `vexa_app_v2` (6 application `vexa-pim-api`, 4 without an application name); no other user was connected. This is a single point-in-time sample.   cites: R-271 to R-272

## 5. Role attributes

Source sections: `connected identity`, `roles (...)`, `role memberships`, `role and database settings`.

| Role | LOGIN | SUPERUSER | BYPASSRLS | INHERIT | CREATEROLE | CREATEDB | Conn. limit | Has expiry |
|---|---|---|---|---|---|---|---|---|
| `postgres` (main) | true | true | true | true | true | true | -1 | false |
| `vexa_app_v2` (main; the connected role) | true | true | false | true | false | false | -1 | false |
| `postgres` (observability; the connected role) | true | true | true | true | true | true | -1 | false |

Memberships (role, member, admin / inherit / set options): `pg_read_all_settings`/`pg_read_all_stats`/`pg_stat_scan_tables` granted to member `pg_monitor`, admin false, inherit true, set true (main R-016 to R-018; observability R-331 to R-333, identical). No membership has `vexa_app_v2` as a member or as a role.
Per-role and per-database settings (keys; allow-listed values): none (main R-019; observability R-334).

RAW: main R-001 to R-019 (identity, roles, memberships, settings); observability R-317 to R-334. Role flags below are copied from R-003/R-004 and R-014/R-015 (main) and R-319/R-320 and R-330 (observability).
DERIVED:
- D-006  [CURRENT PRODUCTION FACT]  The connected role on main, `vexa_app_v2`, is SUPERUSER with `rolbypassrls` false. A superuser bypasses RLS whatever that flag says, and the probe's effective-privilege section reports `bypasses_row_level_security` true. Effective bypass: yes.   cites: R-003, R-004, R-251
- D-007  [CURRENT PRODUCTION FACT]  The connected role on observability, `postgres`, is SUPERUSER and BYPASSRLS; effective bypass: yes.   cites: R-319, R-320, R-373
- D-008  [CURRENT PRODUCTION FACT]  Main has two non-internal roles (`postgres`, `vexa_app_v2`) and observability has one (`postgres`). None of the target identities `vexa_runtime`, `vexa_migrator`, `vexa_backup`, `vexa_reporter`, `vexa_ops` exists in either database.   cites: R-015, R-014, R-330
- D-009  [CURRENT PRODUCTION FACT]  The only memberships on either database grant the three predefined monitoring roles to `pg_monitor`. `vexa_app_v2` is neither a member nor a granted role in any membership, so the set of roles reachable from it through membership is empty. Because it is itself SUPERUSER it already holds every privilege and can assume any role, so membership is not the boundary today.   cites: R-016 to R-018, R-331 to R-333, R-003
- D-010  [VERIFICATION REQUIRED]  Whether `vexa_runtime` ([PROPOSED TARGET STATE]) has any membership or `SET ROLE` path to `vexa_reporter`, `vexa_backup`, `vexa_migrator`, `vexa_ops` or any BYPASSRLS role: those roles do not exist yet (D-008), so this is shown only by running the probe and a `SET ROLE` test as the candidate role in the rehearsal.   cites: R-015, R-014
- D-011  [CURRENT PRODUCTION FACT]  No per-role or per-database setting exists on either database, so no `search_path` or RLS-affecting setting is attached to a role or database.   cites: R-019, R-334

**Privilege-escalation check (membership and `SET ROLE`), computed from the RAW membership rows only:**
- the transitive set of roles reachable from `vexa_app_v2` through membership: empty beyond itself (D-009); the options are present in the RAW rows (PostgreSQL 18)
- whether that set contains any `SUPERUSER` or `BYPASSRLS` role: no (it is empty); the connected role is itself SUPERUSER (D-006)
- whether `vexa_runtime` (target) has any path to `vexa_reporter`, `vexa_backup`, `vexa_migrator`, `vexa_ops` or any `BYPASSRLS` role: [VERIFICATION REQUIRED] (D-010)
Cites: R-016 to R-018, R-331 to R-333, R-003.

## 6. Database and schema privileges

Source sections: `database privileges (ACL ...)`, `schemas`, `schema privileges (ACL ...)`.

| Object | Grantee | Privilege | Grantable |
|---|---|---|---|
| database | `PUBLIC` | CONNECT, TEMPORARY | false |
| database | `postgres` | CONNECT, CREATE, TEMPORARY | false |
| schema `public` (owner `pg_database_owner`, `public_can_create` = false) | `PUBLIC` | USAGE | false |
| schema `public` | `pg_database_owner` | CREATE, USAGE | false |

RAW: main R-020 to R-028; observability R-335 to R-343 (identical rows in both databases).
DERIVED:
- D-012  [CURRENT PRODUCTION FACT]  On both databases `PUBLIC` holds CONNECT and TEMPORARY on the database, so any role can connect and create temporary tables. `PUBLIC` holds USAGE but not CREATE on schema `public` (`public_can_create` false); schema CREATE and USAGE belong to `pg_database_owner`, which is the database owner `postgres`.   cites: R-020 to R-024, R-026 to R-028, R-300, R-421

## 7. Object ownership

Source sections: `object ownership ... (counts)`, `function and type ownership (counts)`, `objects NOT owned by the database owner (names only)`, `views and materialized views`.

| Kind | Owner | Count | Names not owned by the database owner |
|---|---|---|---|
| table (main) | `postgres` 63, `vexa_app_v2` 15 | 78 | the 15 tables owned by `vexa_app_v2`: `MarketplaceBulkPublishRun`, `MarketplaceBulkPublishRunItem`, `ai_executions`, `ai_platform_budget_periods`, `ai_platform_controls`, `ai_provider_budget_charges`, `ai_provider_budget_policies`, `ai_provider_budget_reservations`, `ai_suggestions`, `ai_tenant_policies`, `connector_tenant_entitlements`, `media_integrity_scan_checkpoints`, `media_integrity_scan_runs`, `ops_alert_states`, `stripe_webhook_events` (R-045 to R-059) |
| table (observability) | `postgres` 4 | 4 | none (R-346) |
| view / materialized view | none | 0 | main R-060; observability R-347 |
| sequence | none | 0 | `sequences = 0` in the effective-privileges section (main R-251 to R-270; observability R-373 to R-392) |
| function / procedure (main) | `vexa_app_v2` 2 | 2 | `ai_suggestions_reject_generated_field_update`, `connector_tenant_entitlements_guard` (R-043, R-044) |
| function / procedure (observability) | none | 0 | R-369 |
| enum type (main) | `postgres` 22, `vexa_app_v2` 9 | 31 | the 9 owned by `vexa_app_v2`: `AiDataClassification`, `AiExecutionCostSource`, `AiExecutionFailureClass`, `AiExecutionStatus`, `AiSuggestionReviewDecision`, `AiSuggestionStatus`, `AiTenantPolicyStatus`, `MarketplaceBulkPublishItemStatus`, `MarketplaceBulkPublishRunStatus` (R-034 to R-042) |
| enum type (observability) | `postgres` 4 | 4 | none (R-346) |

REPO FACT (for comparison only, not a production fact): `packages/db/identity/production-ownership-split.v1.json` recorded 15 tables, 2 functions, 9 enum types owned by `vexa_app_v2` and the rest by `postgres` on 2026-10-06. The comparison is DERIVED below.

RAW: main R-029 to R-060; observability R-344 to R-347. Per-object names not owned by the database owner: main R-034 to R-059 (listed in the table).
DERIVED:
- D-013  [CURRENT PRODUCTION FACT]  Main ownership: tables `postgres` 63 and `vexa_app_v2` 15; functions `vexa_app_v2` 2; enum types `postgres` 22 and `vexa_app_v2` 9; no sequence and no view.   cites: R-029 to R-030, R-031 to R-033, R-060
- D-014  [CURRENT PRODUCTION FACT]  The ownership fixture matches production exactly: the 15 table names, 2 function names and 9 enum type names in `production-ownership-split.v1.json` (REPO FACT, commit `9454c30d`) are the same sets as the 15 + 2 + 9 objects the probe lists as not owned by the database owner. Nothing was added to or moved from the runtime owner between the fixture observation and this probe (both 2026-10-06). The comparison was done name by name.   cites: R-034 to R-059
- D-015  [CURRENT PRODUCTION FACT]  Observability: 4 tables and 4 enum types, all owned by `postgres`; no function, view or sequence.   cites: R-344, R-345, R-346, R-347

## 8. Object ACLs

Source sections: `relation privileges held by roles other than the owner`, `relations that carry a non-owner privilege`, `functions and procedures (... EXECUTE)`, `enum types: privileges ...`, `explicit table grants by grantee`.

| Object class | Grantee (non-owner) | Privilege | Count / names | `PUBLIC`? |
|---|---|---|---|---|
| tables | none (main R-244, R-245; observability R-367, R-368: zero rows); the only explicit table grants are to the owners, `postgres` on 63 tables and `vexa_app_v2` on 15 tables, each with DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE (main R-230 to R-243); on observability `postgres` on 4 tables (R-360 to R-366) | | | not on tables |
| sequences | none (no sequence exists: main and observability `sequences = 0`) | | | no |
| views | none (no view exists: main R-060; observability R-347) | | | no |
| functions (EXECUTE) | main: `PUBLIC` and `vexa_app_v2` on both functions, both `security_definer = false`, both `plpgsql`, owner `vexa_app_v2` (R-246, R-247); observability: no function (R-369) | EXECUTE | 2 (main), 0 (observability) | yes, on both main functions |
| enum types (USAGE) | `PUBLIC` (main R-248: 31 types; observability R-370: 4 types) | USAGE | 31 (main), 4 (observability) | yes |

RAW: main R-230 to R-248; observability R-360 to R-370.
DERIVED:
- D-016  [CURRENT PRODUCTION FACT]  No role other than the owner holds any table, sequence or view privilege on either database. The only explicit table grants are the owners' own: `postgres` on 63 tables and `vexa_app_v2` on 15. `vexa_app_v2` holds no explicit grant on the 63 tables `postgres` owns; its access to them comes from being a superuser (the effective-privilege section reports every privilege, including TRUNCATE, on 78 of 78 tables).   cites: R-244, R-245, R-367, R-368, R-306, R-427, R-230 to R-243, R-360 to R-366, R-251 to R-270
- D-017  [CURRENT PRODUCTION FACT]  Main has two functions, both trigger functions in `plpgsql`, both `security_definer` false, `EXECUTE` held by `PUBLIC` and the owner. `PUBLIC` holds USAGE on all 31 enum types. Observability has no function and `PUBLIC` holds USAGE on its 4 enum types. Only `PUBLIC` and the owner appear in these ACLs.   cites: R-246 to R-247, R-248, R-369, R-370

**Privilege-escalation check (`SECURITY DEFINER` functions):** for every function the probe lists with `security_definer = true`:
- owner: not applicable, no `SECURITY DEFINER` function exists
- who may `EXECUTE` it: not applicable
- whether it reads or writes tenant-keyed data: not applicable
Result: **none exist.**
- D-018  [CURRENT PRODUCTION FACT]  No `SECURITY DEFINER` function exists on either database, so there is no function-mediated indirect bypass today, and the section 18 gap on function configuration (`search_path`, bodies) has nothing to review.   cites: R-304, R-425, R-246 to R-247, R-369
REPO FACT (commit `9454c30d`, searched `packages/db/prisma/migrations`, no match): no migration declares a `SECURITY DEFINER` function; the two functions the migrations create are trigger functions (`ai_suggestions_reject_generated_field_update`, `connector_tenant_entitlements_guard`). This says nothing about functions created outside migrations, which is why the production listing above governs.

## 9. Default privileges

Source: `default privileges`, `event triggers`.

RAW: none on either database (main R-249, R-250; observability R-371, R-372: zero default-privilege rows and zero event triggers).
DERIVED:
- D-019  [CURRENT PRODUCTION FACT]  No default privileges and no event triggers exist on either database, so objects created in future by any role receive only PostgreSQL's built-in defaults (owner access; `PUBLIC` EXECUTE on functions and USAGE on types) until explicit grants are applied. [PROPOSED TARGET STATE]: the I1 `apply-grants` step sets them explicitly.   cites: R-249, R-250, R-371, R-372

## 10. RLS posture

Source sections: `row level security coverage`, `row level security per table`, `RLS enabled but NOT forced`, `tenant-keyed tables with NO RLS`, `RLS policies (every policy ...)`, `distinct policy expressions (grouped)`, `server settings` (`row_security`).

| Table | Owner | `relrowsecurity` | `relforcerowsecurity` | Policies | Tenant key |
|---|---|---|---|---|---|
| main: 78 tables, one row each at R-064 to R-141 (owners `postgres` and `vexa_app_v2`) | see R-064 to R-141 | RLS enabled on 64 | RLS forced on 54 | 64 tables have at least one policy | 68 tables have a tenant key (R-061 to R-063, R-064 to R-141) |
| observability: `_prisma_migrations`, `error_issue_tenant_impacts`, `error_issues`, `error_occurrences` (R-351 to R-354) | `postgres` | false on all 4 | false on all 4 | 0 on all 4 | `has_tenant_key` false on all 4 |

Policy inventory (every policy): main has 67 policies, 63 `ALL` and 4 `SELECT` (R-156, R-157), each one row at R-158 to R-224; observability has none (R-357, R-358).
Coverage as the probe counts it (excludes `_prisma_migrations`, REPO FACT `9454c30d` `scripts/sec-db-rls-001-probe-lib.cjs` line 96): main tables 77, enabled 64, forced 54 (R-061 to R-063); observability tables 3, enabled 0, forced 0 (R-348 to R-350).
Tables with RLS enabled but not forced (main, 10, R-142 to R-151): `AccessScopeAssignment`, `ConnectorPermission`, `PlanUsage`, `TenantPlanProfile`, `connector_credentials`, `connector_installations`, `connector_mapping_events`, `connector_mapping_versions`, `connector_submissions`, `connector_webhook_events`. Observability: none (R-355).
Tenant-keyed tables with no RLS (main, 4, R-152 to R-155): `AuthIdentity`, `WorkspaceDirectory`, `api_access_keys`, `stripe_webhook_events`. Observability: none (R-356).
Distinct expressions and how many policies share each (main R-225 to R-229): five groups, all `PERMISSIVE` and role `{public}`. (1) `ALL`, `USING` and `WITH CHECK` both `("tenantKey" = COALESCE(NULLIF(current_setting('app.tenant_key'::text, true), ''::text), 'default'::text))`, 30 policies; (2) `ALL`, both `(tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key'::text, true), ''::text), 'default'::text))`, 30 policies; (3) `ALL`, the same `"tenantKey"` expression as `USING` and no `WITH CHECK`, 3 policies; (4) `SELECT`, `(current_setting('app.ai_maintenance'::text, true) = 'on'::text)`, 3 policies; (5) `SELECT`, the `tenant_key` expression as `USING`, 1 policy. Observability: none (R-359).
`row_security` server setting: `on` on both (main R-274; observability R-395).

RAW: main R-061 to R-063, R-064 to R-141, R-142 to R-157, R-158 to R-229, R-274; observability R-348 to R-359, R-395.
DERIVED (each cites RAW):
- D-020  [CURRENT PRODUCTION FACT]  Main: RLS is enabled on 64 tables, forced on 54, and 64 tables have at least one policy; no table has RLS enabled without a policy and none has policies with RLS disabled. Of 68 tenant-keyed tables, 64 have RLS and 4 have none (`AuthIdentity`, `WorkspaceDirectory`, `api_access_keys`, `stripe_webhook_events`); every RLS table is tenant-keyed (64 of 64). In total 14 of the 78 tables have no RLS: those 4 and 10 that are not tenant-keyed (`PlanLimits`, `PublicSignupRequest`, `_prisma_migrations`, `ai_platform_budget_periods`, `ai_platform_controls`, `connector_definitions`, `media_integrity_scan_checkpoints`, `media_integrity_scan_runs`, `ops_alert_states`, `tax_regimes`). The probe counts 77 tables because its coverage query excludes `_prisma_migrations` (REPO FACT).   cites: R-061 to R-063, R-288, R-289, R-290, R-291, R-292, R-293, R-152 to R-155, R-064 to R-141
- D-021  [CURRENT PRODUCTION FACT]  All 67 policies apply to role `{public}`, so they apply to every role that is not exempt. 63 are `ALL` and 4 are `SELECT`. 64 of the 67 test `"tenantKey"` or `tenant_key` against `COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default')`: the tenant is whatever the connection sets, and `default` when unset. 3 policies have no `WITH CHECK`; all 3 are `ALL` policies (`BulkImportRun`, `MarketplaceBulkPublishRun`, `MarketplaceBulkPublishRunItem`), and PostgreSQL applies `USING` to new rows when `WITH CHECK` is absent, so writes are still constrained; the 4 `SELECT` policies need none.   cites: R-294, R-295, R-296, R-156 to R-157, R-225 to R-229, R-165, R-174, R-175
- D-022  [CURRENT PRODUCTION FACT]  Three `SELECT` policies (on `ai_provider_budget_charges`, `ai_provider_budget_policies`, `ai_provider_budget_reservations`) pass when `current_setting('app.ai_maintenance', true) = 'on'`, with no tenant condition. Any session that can set that custom setting can therefore read those three tables across tenants (SELECT only), and the application's own connection can set it. The application sets it transaction-locally in `apps/api/src/intelligence/intelligence-reservation-maintenance.service.ts` line 135 (REPO FACT, commit `9454c30d`; created by migration `20261005120000_ai_provider_budget_lifecycle`).   cites: R-190, R-192, R-194, R-228
  - [GOVERNANCE DECISION]  (CTO and Product Owner, recorded 2026-10-07 from the owner's instruction in chat)  This mechanism does not satisfy the "explicit, separately governed privileged path" requirement of the target isolation model, because the ordinary application identity can activate the setting. It is deliberate and read-only, but it is a privilege path inside the ordinary runtime identity, not one reached through a separately governed identity.
  - [REMEDIATION REQUIRED]  Remove the ordinary-runtime cross-tenant path before SEC-DB-RLS-001 can close. The fix is not prescribed in this record; it belongs to the remediation design. A general BYPASSRLS maintenance role created only to preserve the existing shortcut is excluded.
- D-023  [CURRENT PRODUCTION FACT]  The 10 tables with RLS enabled but not forced are all owned by `postgres`, not by `vexa_app_v2`. The probe's `ownedTablesWhereRlsIsEnabledButNotForced` = 10 and `tablesOwnedByConnectedRoleOrItsRoles` = 78 count every table because a superuser holds every role, so those figures describe the superuser and not ownership. The connected role is therefore not the owner of those 10 and passes their RLS only because it is a superuser. The 9 RLS tables `vexa_app_v2` owns are all forced. [PROPOSED TARGET STATE]: a non-superuser, non-owner runtime would be subject to RLS on all 64 tables, and the 10 not-forced tables would be exempt only for their owner.   cites: R-142 to R-151, R-287, R-286, R-064 to R-141
- D-024  [CURRENT PRODUCTION FACT]  The connected role bypasses all of the above: it is SUPERUSER and the effective-privilege section reports `bypasses_row_level_security` true. `row_security` is `on`, which does not restrict a superuser (PostgreSQL behavior).   cites: R-003, R-251, R-274
- D-025  [CURRENT PRODUCTION FACT]  Observability: RLS is off on all 4 tables, there is no policy, and no table is tenant-keyed.   cites: R-348 to R-350, R-351 to R-354, R-358, R-409

## 11. Main database: derived findings

The probe's `derived findings` section is recorded verbatim as RAW: main R-281 to R-310, observability R-402 to R-431. The values below are those probe-computed values (RAW). The Reading column is DERIVED and cites the D-lines above.

| Finding (from the probe) | Value | Reading |
|---|---|---|
| `connectedRoleIsSuperuser` | main true (R-282); observability true (R-403) | true on both: D-006, D-007 |
| `connectedRoleBypassesRls` | main true; observability true | true on both: D-006, D-007, D-024 |
| `tablesOwnedByConnectedRoleOrItsRoles` | main 78; observability 4 | main 78 is every table (a superuser holds every role); actual owners are 63 `postgres` and 15 `vexa_app_v2`: D-013, D-023 |
| `ownedTablesWhereRlsIsEnabledButNotForced` | main 10; observability 0 | main 10, all owned by `postgres`, not by the runtime role: D-023 |
| `tenantKeyedTables` / `...WithRlsEnabled` / `...WithRlsForced` / `...WithAtLeastOnePolicy` | main 68 / 64 / 54 / 64; observability 0 / 0 / 0 / 0 | main: 4 tenant-keyed tables have no RLS: D-020; observability has no tenant-keyed table: D-025 |
| `tenantKeyedTablesWithRlsEnabledButNoPolicy` | main `[]`; observability `[]` | none on either database: D-020 |
| `policiesTotal` / `policiesWithoutWithCheckExpression` / `policiesApplyingToPublicRole` | main 67 / 3 / 67; observability 0 / 0 / 0 | 67 policies, all apply to `PUBLIC`; the 3 without `WITH CHECK` are `ALL` policies: D-021 |
| `publicCanConnectToDatabase` / `publicCanCreateTemporaryTables` / `publicCanCreateInPublicSchema` | main true / true / false; observability true / true / false | `PUBLIC` can connect and create temporary tables, cannot create in `public`: D-012 |
| `functionsExecutableByPublic` / `securityDefinerFunctions` / `enumTypesUsableByPublic` | main 2 / 0 / 31; observability 0 / 0 / 4 | 2 public-executable trigger functions, no `SECURITY DEFINER`, 31 public-usable enum types on main: D-017, D-018 |
| `relationsWithANonOwnerPrivilege` / `relationPrivilegeHoldersOtherThanOwner` | main 0 / `[]`; observability 0 / `[]` | none on either database: D-016 |
| `sequencesPresent` / `viewsPresent` / `eventTriggersPresent` | main 0 / 0 / 0; observability 0 / 0 / 0 | none present on either database; no default privileges: D-016, D-019 |
| `sectionsUnavailable` | main `[]`; observability `[]` | none on either database; completeness gate met (section 3) |

Worked example of the format (illustrative only, not a result):
```
RAW:
  R-0xx  rolsuper = [value]
  R-0xx  table owner of connector_credentials = [value]
  R-0xx  relforcerowsecurity (connector_credentials) = [value]
DERIVED:
  D-0xx  [CURRENT PRODUCTION FACT]  <what that means for the ordinary runtime on that table>   cites: R-0xx, R-0xx, R-0xx
```

## 12. Observability database: derived findings

Same table as section 11, for `Postgres-MSwk`. Expected shape to **verify, not assume**: one role, a small number of tables, no RLS, no tenant-keyed tables.

Values: see section 11 (observability values and R-402 to R-431). Observed shape (RAW): one role `postgres` (R-330), 4 tables and 4 enum types all owned by `postgres` (R-344, R-345), no function, no policy, RLS off on all 4 tables, `has_tenant_key` false on all 4 (R-351 to R-354), zero tenant-keyed tables (`tenantKeyedTables` = 0, R-409), one session as `postgres` from application `vexa-error-authority` (R-393), migration state 2 applied, latest `20260813000000_error_authority_ops_indexes` (R-399 to R-401).
DERIVED:
- D-026  [CURRENT PRODUCTION FACT]  The expected shape is confirmed: the observability database has one role (`postgres`, SUPERUSER and BYPASSRLS), 4 tables and 4 enum types owned by `postgres`, no tenant-keyed table, no RLS, no policy and no function. By this section's own test it carries lower tenant risk. It is still reached with a SUPERUSER credential.   cites: R-330, R-319, R-320, R-409, R-315
- D-027  [CURRENT PRODUCTION FACT]  The only observed observability session is `postgres` from application `vexa-error-authority`; migration state is 2 applied, 0 unfinished.   cites: R-393, R-399 to R-401

## 13. Application and workflow classification

States: `REPO FACT` rows below are from the repository at commit `9454c30d`. They classify code and workflows; they say nothing about production until joined to sections 5 to 11.

| Component | Today's identity (inferred) | Cross-tenant? | DDL? | Future identity | State |
|---|---|---|---|---|---|
| API runtime and web | `DATABASE_URL*` role (section 4); the web service has no database variables | No | No | `vexa_runtime` | REPO FACT + PROPOSED TARGET STATE |
| Schedulers and queue workers | in the API process (about 12 `setInterval` jobs with advisory locks, plus BullMQ workers); no separate worker service | sweepers: yes (classes A and A2) | No | `vexa_runtime` with tenant iteration | REPO FACT + PROPOSED TARGET STATE |
| Advisory-lock client | same URL as the API, own `PrismaClient` | No | No | `vexa_runtime` | REPO FACT |
| Migrations: Railway `preDeployCommand` | the service's runtime credential | all tenants | yes | `vexa_migrator` | REPO FACT + PROPOSED TARGET STATE |
| Migrations: deploy workflow | `STAGING_DATABASE_URL(_DIRECT)` secret | all tenants | yes | `vexa_migrator` | REPO FACT + PROPOSED TARGET STATE |
| Main backup (`backup-r2-daily`) | `STAGING_DATABASE_URL_DIRECT` | all tenants | No | `vexa_backup` | REPO FACT + PROPOSED TARGET STATE |
| Observability backup | `OBSERVABILITY_DATABASE_URL` | n/a | No | its own `vexa_backup` | REPO FACT + PROPOSED TARGET STATE |
| Sellable-SKU audit report; media-integrity read-only report | `STAGE3_DATABASE_URL`, standalone client, no tenant context | **yes, by design (reads)** | No | **`vexa_reporter`** (read-only, BYPASSRLS, never reachable by the API) | REPO FACT + PROPOSED TARGET STATE |
| Sellable-SKU backfill | `STAGE3_DATABASE_URL`, standalone client | **yes (writes across tenants today)** | No | **`vexa_ops`, NOBYPASSRLS, explicit tenant iteration, narrow DML** | REPO FACT + PROPOSED TARGET STATE |
| Tax seed, smoke-identity reset, hash-coverage check, lookup smoke, staging acceptance workflows | staging secrets | mostly unscoped tables | No | [ ] decide per script | REPO FACT; **VERIFICATION REQUIRED** |
| Platform controls (kill switch, budget periods) | runtime today | No | No | `vexa_ops` | REPO FACT + PROPOSED TARGET STATE |
| Observability service | `OBSERVABILITY_DATABASE_URL` | No | No | split like the main database | REPO FACT + PROPOSED TARGET STATE |

Which GitHub secret holds which role is **not established** (see section 18).

Application call sites (REPO FACT, `sec-db-rls-001-call-sites.v1.json`, #1193): 32 files use the context-free client, plus 81 raw-SQL sites in 20 files. By class: cross-tenant discovery (A) 10 files; cross-tenant raw scans with no tenant argument (A2) 3; tenant known but the direct client used (B) 18; pre-tenant bootstrap (C) 3; request-scoped raw SQL (R) 3; already on an approved path (D) 1. Class A and A2 fail **silently** under a non-bypass role; class B fails loudly.

## 14. Confirmed privilege gaps

Each gap is a DERIVED line that cites RAW ids and names the production fact. Gaps confirmed or rejected against the evidence:

| # | Candidate gap | Needs from the evidence | Result |
|---|---|---|---|
| G1 | The ordinary runtime role is a superuser | `connected identity` | **Confirmed.** D-006 |
| G2 | The runtime role owns tables that carry RLS | ownership + RLS per table | **Confirmed.** `vexa_app_v2` owns 15 tables; 9 carry RLS (all forced) and 6 carry none (D-023, D-020) |
| G3 | Tables with RLS enabled but not forced are exempt for their owner | RLS per table + owner | **Confirmed, with a correction.** 10 tables are not forced, but all are owned by `postgres`, not by the runtime (D-023) |
| G4 | Tenant-keyed tables with no RLS | `tenant-keyed tables with NO RLS` | **Confirmed.** 4 tables (D-020) |
| G5 | The API's database variables resolve to a public endpoint | section 4 | **Confirmed.** All three variables (D-001, D-002) |
| G6 | `PUBLIC` holds database, schema, function or enum privileges beyond the minimum | sections 6 and 8 | **Observed; level undecided.** `PUBLIC` holds CONNECT/TEMPORARY, schema USAGE, EXECUTE on 2 functions and USAGE on 31 enum types, and no schema CREATE (D-012, D-017); whether that exceeds the minimum is a Stage 2 decision |
| G7 | Non-owner grants exist on tables | section 8 | **Rejected.** No non-owner table grant exists (D-016) |
| G8 | Policies lack `WITH CHECK` on write commands, or apply to `PUBLIC` | section 10 | **Partly confirmed.** All 67 apply to `PUBLIC`; the 3 without `WITH CHECK` are `ALL` policies, not a write gap; 3 `SELECT` policies depend on a setting the ordinary runtime can set; decided not to satisfy the target model, remediation required (D-021, D-022) |
| G9 | Role-level settings alter RLS or search path | section 5 | **Rejected.** No role or database setting exists (D-011) |
| G10 | The runtime can write control-plane tables it only reads (`connector_definitions`, `tax_regimes`, `connector_tenant_entitlements`) | **repo scan, then restricted-role lane** | VERIFICATION REQUIRED |
| G11 | Append-only tables (`audit_logs`, `account_consent_events`, `kpi_metric_events`, `approval_comments`, `connector_mapping_events`) are writable by UPDATE and DELETE | lifecycle proof + lane | VERIFICATION REQUIRED |
| G12 | The ordinary runtime can reach a `SUPERUSER`/`BYPASSRLS` role through membership or `SET ROLE`, or can execute a `SECURITY DEFINER` function that bypasses tenant isolation | section 5 membership closure; section 8 `SECURITY DEFINER` listing | **Not present today:** no membership path and no `SECURITY DEFINER` function (D-009, D-018). For the target `vexa_runtime`: [VERIFICATION REQUIRED] (D-010) |

G10 and G11 are about the **target grant set**, not about a production fact, and are resolved in Stage 2, not here.

## 15. Blast radius of removing superuser and runtime ownership

Joins the REPO FACT classification to the production facts. Each line is `PROPOSED TARGET STATE` or `VERIFICATION REQUIRED`; nothing here is a measured production outcome.

| Change | What would break (REPO FACT: dry run #1188, classification #1193) | Evidence that confirms it in production | Mitigation / proof required |
|---|---|---|---|
| Runtime becomes NOSUPERUSER NOBYPASSRLS | Class A and A2 jobs silently see only the `default` tenant (heartbeat, sweepers, reconciliation, billing escalation, ops dashboards); class B writes fail (connector credentials, Shopify install returned HTTP 500); tenant provisioning seeds fail silently | Production fact: the runtime is SUPERUSER and 64 tables carry RLS (D-006, D-020), so RLS is bypassed today and the change would activate those policies. The measured production effect is not available: [VERIFICATION REQUIRED]. | tenant iteration helper; positive-result assertions; restricted-role lane |
| Ownership moves away from the runtime | migrations fail while `preDeployCommand` still uses the runtime credential; two migration paths exist | Production fact: the runtime owns exactly 15 tables, 2 functions and 9 enum types, matching the fixture (D-013, D-014). Which credential `preDeployCommand` uses is REPO FACT. | `vexa_migrator`; `apply-grants` immediately after `migrate deploy`; two-credential Railway change (human action) |
| Backup identity changes | `pg_dump` as a restricted role fails or silently dumps only visible rows | Not shown by the probe: which credential the backup workflows use (section 18). [VERIFICATION REQUIRED]. | `vexa_backup` with BYPASSRLS; restore test |
| Cross-tenant operator workflows | silently cover only `default` | Not shown by the probe: which role the `STAGE3_DATABASE_URL` secret holds (section 18). [VERIFICATION REQUIRED]. | `vexa_reporter` (reads); `vexa_ops` + tenant iteration (backfill) |
| Public database endpoint | a superuser credential is reachable over a public proxy today | [CURRENT PRODUCTION FACT]: all three API database variables resolve to a public-proxy host for a SUPERUSER role (D-001, D-002, D-006). | private network address (SRE) |

Rollback requirement (REPO FACT, I1 rehearsal 88/88 on PostgreSQL 16 and 18): ownership rollback from a before-snapshot; credential rollback by pointing `DATABASE_URL` back while `vexa_app_v2` is left untouched. **VERIFICATION REQUIRED** against production-shaped data before any cutover.

## 16. Current guarantees

Only statements the evidence supports, each `CURRENT PRODUCTION FACT` with RAW citations. Leave blank until completed; a guarantee with no citation is struck.

- G-1  [CURRENT PRODUCTION FACT]  Where RLS is enabled it is backed by a policy: 64 tables have RLS enabled, 64 have at least one policy, none has RLS enabled without a policy and none has policies with RLS disabled. RLS is defined consistently; it is not enforced for the runtime (N-1).   cites: R-289, R-291, R-292, R-293
- G-2  [CURRENT PRODUCTION FACT]  No role other than the owners holds a table, sequence or view privilege on either database.   cites: R-306, R-427, R-244, R-245, R-367, R-368
- G-3  [CURRENT PRODUCTION FACT]  No `SECURITY DEFINER` function, view or sequence exists on either database, so there is no function- or view-mediated bypass path.   cites: R-304, R-425, R-309, R-308
- G-4  [CURRENT PRODUCTION FACT]  `PUBLIC` cannot create objects in schema `public` on either database.   cites: R-300, R-421
- G-5  [CURRENT PRODUCTION FACT]  No default privileges and no event triggers exist on either database.   cites: R-249, R-250, R-371, R-372
- G-6  [CURRENT PRODUCTION FACT]  Only the roles listed in D-008 exist: no unexpected login role exists on either database.   cites: R-015, R-014, R-330
- G-7  [CURRENT PRODUCTION FACT]  The observability database holds no tenant-keyed data.   cites: R-409

## 17. Current non-guarantees

Only statements the evidence supports, each with RAW citations.

- N-1  [CURRENT PRODUCTION FACT]  Tenant isolation by RLS is not enforced for the ordinary runtime identity today: it is SUPERUSER, so all 64 RLS-enabled tables' policies are bypassed.   cites: R-003, R-251, R-289
- N-2  [CURRENT PRODUCTION FACT]  Even for a restricted role, tenant context is connection-supplied: the policies read `app.tenant_key`, so RLS protects against application filter bugs and not against a compromised API.   cites: R-225 to R-229
- N-3  [CURRENT PRODUCTION FACT]  4 tenant-keyed tables have no RLS, so their isolation depends on application filtering alone.   cites: R-152 to R-155
- N-4  [CURRENT PRODUCTION FACT]  10 tables have RLS enabled but not forced and are owned by `postgres`, so they are exempt for their owner.   cites: R-142 to R-151, R-064 to R-141
- N-5  [CURRENT PRODUCTION FACT]  Three AI budget tables can be read across tenants by any session that sets `app.ai_maintenance`, including the application's own; this path is not behind a separate identity, and the owner has decided it does not satisfy the target model (D-022).   cites: R-190, R-192, R-194
- N-6  [CURRENT PRODUCTION FACT]  The credential the application uses is a SUPERUSER credential reached over a public proxy, with no `sslmode` in the URL; client TLS use is not shown.   cites: R-312, R-313, R-314, R-003
- N-7  [CURRENT PRODUCTION FACT]  Which credential the backup, report and operator workflows use is not shown by the probe, so nothing is stated about their identity or blast radius from production evidence.   cites: section 18
- N-8  [CURRENT PRODUCTION FACT]  The probe is a point-in-time sample (10 sessions on main when it ran); it cannot show other consumers over time.   cites: R-271 to R-272

## 18. Evidence gaps

Open until closed by a named source.

| Gap | Why it matters | Closed by |
|---|---|---|
| Which GitHub secret holds which role (`STAGING_DATABASE_URL*`, `STAGE3_DATABASE_URL`, `OBSERVABILITY_DATABASE_URL`) | the role inventory implies every working credential is a superuser | a person reading the secret names against `service-identity` output |
| Client-side TLS use (`sslmode` absent from the client URLs) | a superuser credential over a public proxy | SRE |
| Production data behavior under a restricted role | the dry run used synthetic data | pre-production rehearsal |
| Integration tests not in the restricted-role lane (23 of 186 in the lane) | most call sites are certified by classification only | lane expansion |
| `SECURITY DEFINER` function hardening: the probe reports owner, `EXECUTE` holders and the `SECURITY DEFINER` flag, but **not function-level configuration** (`proconfig`, for example a pinned `search_path`) or function bodies | a `SECURITY DEFINER` function without a pinned `search_path` can be hijacked by an object the caller controls, and one owned by a superuser runs with a bypass | **Closed 2026-10-06:** no `SECURITY DEFINER` function exists on either database (D-018), so there is nothing to review; reopen only if one appears |
| Whether any external consumer uses the database credential | a role swap could break it | SRE inventory of connections (counts by user and application name are in the probe) |
| Which replacement closes the `app.ai_maintenance` path (D-022) | the mechanism is decided not to satisfy the target model; the replacement is not yet chosen | **Decided 2026-10-07:** removal is required. The replacement (per-tenant iteration under `vexa_runtime` or `vexa_ops`, or a narrowly scoped separate identity the API cannot assume) is chosen in the remediation design |
| Whether the trigger functions are attached to their tables (`connector_tenant_entitlements_guard`, `ai_suggestions_reject_generated_field_update`); the probe lists the functions but not triggers | the claim that CHECKs and triggers bind a superuser is not evidenced in production | a read-only `pg_trigger` listing, added to the probe by a reviewed change |
| Other consumers over time (the probe saw 10 sessions, all `vexa_app_v2`) | backups, reports or external tools may use other credentials | SRE inventory of connections over time |

## 19. Required remediation

`PROPOSED TARGET STATE`. Nothing below is proven or authorized.

**Stage 1: identity separation (makes RLS real).**
`vexa_runtime` non-superuser, `NOBYPASSRLS`, owns nothing; `vexa_migrator` owns objects and runs migrations; `vexa_backup` read-only with BYPASSRLS; `vexa_reporter` read-only cross-tenant for the audit and media reports only; `vexa_ops` NOBYPASSRLS for platform control tables and the backfill with explicit tenant iteration; class A, A2, B, C and R call sites migrated (M1 to M6); production-equivalent rehearsal; rollback proven; two credentials and a private database address in Railway (human actions).

**Stage 2: least-privilege tightening (after Stage 1, under the restricted-role lane).**
`SELECT` only for `connector_definitions`, `tax_regimes`, `connector_tenant_entitlements`; `SELECT+INSERT` only for append-only tables whose lifecycle proves no supported update or delete; narrow `PUBLIC` function, enum and schema grants; restricted-role lane expanded toward the full integration suite.

Stage 1 also removes or replaces the ordinary-runtime cross-tenant path `app.ai_maintenance` (D-022), by a mechanism the remediation design chooses; no general BYPASSRLS maintenance role is created to preserve it.

The I1 grants are an **upper bound**, not the final minimum. Stage 1 does not wait for Stage 2.

Root cause the remediation targets (`DERIVED`, from the evidence): the runtime passes every RLS policy because `vexa_app_v2` is a SUPERUSER, not because it owns the tables. The 10 tables with RLS enabled but not forced are owned by `postgres`, so they are not an owner-bypass problem for the runtime (D-006, D-023; cites: R-003, R-251, R-142 to R-151).

## 20. Exit criteria for SEC-DB-RLS-001

The issue is **not** closed because new roles exist. It closes only when **all** hold, each with a named piece of evidence:

1. the deployed runtime identity is non-superuser, non-owner and `NOBYPASSRLS` (probe run as the deployed role, `derived findings`);
2. production RLS behavior is verified with that identity: tenant A cannot read or modify tenant B, and cross-tenant jobs return non-empty results;
3. no ordinary identity can bypass RLS implicitly; every cross-tenant path is an explicit, separately governed identity (`vexa_reporter`, `vexa_ops`, `vexa_backup`, `vexa_migrator`), and **the ordinary runtime can neither obtain nor assume those identities**:
   - their credentials are unavailable to the API process, **and**
   - there is no role membership or `SET ROLE` path from `vexa_runtime` to `vexa_reporter`, `vexa_backup`, `vexa_migrator`, `vexa_ops`, or any `BYPASSRLS` or `SUPERUSER` role (proved by the membership closure in section 5 and by running the probe as `vexa_runtime`), **and**
   - no session setting that the ordinary runtime can activate grants cross-tenant access: the `app.ai_maintenance` `SELECT` path on the three AI budget tables (D-022) is removed or replaced, and a re-run of the production probe shows no policy that depends on such a setting without a tenant condition;
4. the ordinary runtime cannot reach a `SUPERUSER` or `BYPASSRLS` role through membership or `SET ROLE`, **and** cannot invoke a `SECURITY DEFINER` function that provides an unintended tenant-isolation bypass (the section 8 listing shows no such function is executable by the runtime, or each one found has been reviewed and recorded, including its owner and pinned `search_path`; see the section 18 gap on function configuration);
5. migrations, backups and operator workflows run under their own identities and each has been exercised after cutover (including a restore);
6. rollback has been rehearsed on production-shaped data and the previous credential remains valid through the verification window;
7. Security and SRE have each signed off on this evidence and the cutover record, by name and date.

Until then, publication-target (5.1d) shadow exposure and enforcement stay blocked.

## 21. Raw evidence references

| Ref | File | SHA-256 | Database | Result |
|---|---|---|---|---|
| E-1 | `probe-main.txt` | `3c08aef019ff3ca24625480378b93eb52559c4b0b2e916572225d47af5c86bc3` | main | `RESULT: COMPLETE` |
| E-2 | `probe-main.json` | `55fcf5712b03f445a756fa9a7f540803a6a1e4c49c8ef8ac0275f65a656e3f4c` | main | `result: COMPLETE` |
| E-3 | `probe-observability.txt` | `4cd181aeba1a1c29bf331ca818b4de587ed27b577719c172fddacf73a20a3b86` (reconstructed byte-exact from the operator's paste; equals the hash printed in the container) | observability | `RESULT: COMPLETE` |
| E-4 | `probe-observability.json` | `cf939379be56398c9b2e695d24c8d1b4b412e7de57d1d0bfb1ec737bf0d759d8` (reconstructed byte-exact from the operator's paste; equals the hash printed in the container; its 32 sections equal the `.txt` row for row) | observability | `result: COMPLETE` |
| E-5 | `probe-identity.txt` | `9fce8c509a6f17bbdbbf86e61ed0158ec831054ef4da2b0986606aad12d3d1d1` | both | `RESULT: COMPLETE` |

RAW index: `SEC-DB-RLS-001-production-identity-raw-register-2026-10-06.md`. R-001 to R-311 are `main`, R-312 to R-316 are `service-identity`, R-317 to R-432 are `observability` (from the `.txt`). The 77 vs 78 and 3 vs 4 table counts are reconciled there against the probe code (REPO FACT).

---

## Completion checklist (delete this block when the record is final)

- [x] **all three** outputs (`probe-main`, `probe-observability`, `probe-identity`) end `RESULT: COMPLETE`, are secret-clean and hashed; section 4 stays `INCOMPLETE` otherwise; no `unavailable` section is hidden
- [x] RAW entered first, validated (completeness, secret scan, hashes), and only then DERIVED written
- [x] section 5 membership closure and section 8 `SECURITY DEFINER` result filled from RAW; G12 answered or left `VERIFICATION REQUIRED`
- [x] secret scan done and recorded in section 3
- [x] every DERIVED line cites RAW ids; every statement carries one state label
- [x] section 7 compares against the ownership fixture and records the difference
- [x] sections 16 and 17 contain only cited statements
- [x] section 14 results filled for G1 to G9 and G12; G10 and G11 left `VERIFICATION REQUIRED`
- [x] no future remediation is written as proven
- [ ] Security and SRE reviewers named for section 20
