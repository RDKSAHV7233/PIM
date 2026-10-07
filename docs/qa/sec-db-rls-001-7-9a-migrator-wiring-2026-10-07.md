# SEC-DB-RLS-001 7.9a: opt-in migrator wiring for the deploy path

Date: 2026-10-07
Baseline: `origin/main` at `e377520f`
Issue: #1189. Design: `sec-db-rls-001-stage1-remediation-design-2026-10-07.md` section 8. Identity model: #1198, #1217.
Type: **tooling and rehearsal. No production access, no role, grant, ownership, RLS or credential change, no application change.** Nothing happens until a person creates the migrator credential and stores it where this section says.

## 1. What changed

| Piece | Before | After |
|---|---|---|
| `scripts/prisma-migrate-deploy.cjs` (the runner: Railway `preDeployCommand`, `npm run prisma:migrate:deploy`, the staging deploy workflow) | migrates with `DATABASE_URL_DIRECT`, then `DATABASE_URL` | **unchanged by default.** When `MIGRATION_DATABASE_URL` is set it migrates as that identity, then applies the explicit grants as the same identity, and fails the deploy if either step fails. A blank value (an unset secret mapped into a workflow) is not the opt-in |
| `scripts/db-identity/tool.cjs` `apply-grants` | refuses any non-local host | still refuses by default. The runner alone can ask for **strict** `apply-grants` (flag `DB_IDENTITY_ALLOW_REMOTE_APPLY_GRANTS=1`), which may run on a remote host and is then checked the same way on every host |
| `scripts/prepare-railway-api-package.cjs` | packages the runner | also packages the grants tool, its library and the manifest at the paths the tool resolves, so the packaged deploy layout can honour the opt-in |
| `.github/workflows/deploy-staging.yml` | no migration identity | maps `STAGING_MIGRATION_DATABASE_URL` into the migration step (empty while the secret is unset) |

### Why the grants step is part of the deploy
A table added by a migration is unreachable by the runtime role and unreadable by the backup role until the grants are applied (I1 finding F3). A deploy that migrated but did not grant would leave new tables failing closed for the application and loudly for backups. So, in the opt-in mode, migrate then grant, as the same identity, and fail the deploy if either fails.

### Strict `apply-grants` refuses before it changes a single grant unless
1. the connection is `vexa_migrator` and not a superuser;
2. every table, enum type and function in `public` is already owned by the migrator (the ownership transfer is done);
3. the other four identities exist (they are created at the cutover, never by a deploy);
4. every table is classified in the manifest. `apply-grants` revokes first and re-grants after, and skips a table the manifest does not list, so without this check a migration that adds an unclassified table would revoke access the still-running application depends on and grant nothing back.

After the grants it re-verifies what the grants are responsible for (privileges, classification, ownership, `PUBLIC`) and fails if any is wrong. Role-attribute findings are printed as warnings: they are the cutover's concern, not a reason to block a deploy.

## 2. Activation (human steps, none of them done here)

1. At the cutover, an administrator creates the five roles and transfers ownership (`create-roles`, `apply-ownership`, local tooling today; the production procedure is the cutover design, 7.11).
2. A person creates the `vexa_migrator` credential and stores it as the GitHub secret `STAGING_MIGRATION_DATABASE_URL` (the workflow reads it from there).
3. **Do not** put `MIGRATION_DATABASE_URL` in the Railway API service's variables. Railway shares service variables between the pre-deploy command and the running API process, so doing so would put the migrator credential (BYPASSRLS, owner of every table) inside the API process, which the model forbids. The runner refuses this configuration: inside a Railway service (`RAILWAY_SERVICE_ID` set) the opt-in is refused before anything runs, unless the service is a dedicated migration service and says so with `MIGRATION_ALLOW_ON_RAILWAY_SERVICE=1`. The default mode on Railway is untouched.
4. **The Railway `preDeployCommand` has to change at the cutover.** After the transfer the runtime role cannot read `_prisma_migrations`, so a pre-deploy that still migrates with the runtime credential fails (the rehearsal proves it). The GitHub deploy workflow already applies the migrations before it deploys, so the intended end state is that migrations run there as the migrator and the Railway pre-deploy is removed or reduced to a no-op. That change belongs to the cutover, not to this PR.

## 3. Evidence

- **`prisma-migrate-deploy.test.cjs`**: pure rules, then the real runner end to end with a fake `npx` that records which identity it was given, a stub grants tool and a local listener. Default behavior unchanged (direct, then pooled); a blank migration variable is not the opt-in; the migration identity wins over both runtime URLs; opt-in runs migrate then grants, both as the migrator and never as the runtime credential; no grants after a failed migration; a failing grants step fails the deploy with its own exit code; a layout without the grants tool fails closed with a clear message; no password is ever printed; the credential never appears on a command line.
- **`db-identity/tool.test.cjs`**: the host guard, which the always-local rehearsal cannot show. Against an address outside the tool's local list: every write mode is refused without the flag; with the flag only `apply-grants` gets past the guard; only the exact value `1` opens it; read-only modes are unaffected; nothing prints a password.
- **Rehearsal on real PostgreSQL, 125 of 125 on 16 and on 18** (was 114). New stage R9c runs the actual runner against the transferred database: a deploy that still migrates with the runtime credential **fails**; the opt-in deploy succeeds as the migrator even with a runtime URL present, never prints a password, and the runtime still reaches a newly classified table; a deploy whose migration added an unclassified table **fails, and refused before changing any grant** (the running application still reaches the table); strict `apply-grants` refuses as the runtime role, as a superuser, and before the ownership transfer is complete, none of which changed a grant; without the flag the tool behaves exactly as before.
- **Mutation check: 20 of 20 caught.** Runner (9): the migration identity not winning, a blank value counted as set, grants in the default mode, grants after a failed migration, a failing grants step not failing the deploy, a missing tool skipped, the credential on the command line, the strict flag not passed, the runtime URL still used. Host guard (4): the flag no longer opening `apply-grants`, the flag opening every write mode, any truthy value opening it, remote writes allowed without the flag. Strict refusals, run through the real rehearsal (3): no migrator-identity requirement, no ownership requirement, no classification requirement. Railway guard (4): removed, any override value, also blocking the default mode, the refusal ignored. The original files were restored after each.
- **CI on GitHub Actions, first complete run (head `f385b16f`, re-run after the account's billing block cleared).** `detect-changes`, `connector-network-transport` on Node 22 and 24, `db-identity-rehearsal` on PostgreSQL 16 and 18 (which now includes the R9c stage that runs the real runner) and `restricted-role-lane` all passed. `build` stopped at the PR scope guard: the PR edits two workflow files (`ci.yml`, `deploy-staging.yml`), which the guard treats as required-team files, so it needs a person to apply `cto-required-team-approved`. That is a governance gate and not a defect; the label has since been applied, and this note was updated on the same branch to produce the fresh event the guard needs (it reads labels from the pull-request event). The package contract test, lint, the OpenAPI check and the remaining DevOps contract tests run in `build` after that guard, so their CI result is on the PR for the new head.
- `deploy-staging.yml` and its validator, the staging config test, `railway-deploy.test.cjs` and the call-site and lane guards pass. The packaged layout was prepared and inspected (the runner resolves a tool that exists; the manifest is where the packaged tool looks). The package contract test cannot complete on this Windows machine because creating a symlink needs a privilege (`EPERM`, in a step this change does not touch); it runs in CI on Linux.

## 4. Limits

- Nothing was run against a production host and no credential exists. The remote-host path is proven by the host-guard test and by running the same strict code locally; the first real remote run is a cutover step.
- **Not verified:** that Railway exposes `RAILWAY_SERVICE_ID` to the pre-deploy command (it does to the running service; the guard's unit and end-to-end tests set it themselves). If it did not, the guard would not fire for the pre-deploy path, which is why step 3 above is also a human rule and not only a check.
- `ci.yml`'s own `prisma migrate deploy` steps run on throwaway admin-owned databases, not through the runner, and are unchanged on purpose.
- The observability database has its own migrations (`@pim1/observability-db`) and is outside this slice.
- The backup (7.9b) and reporter/ops (7.9c) wiring are separate PRs.

## 5. Rollback

Revert the PR. With `MIGRATION_DATABASE_URL` unset the behavior was already the previous behavior, so reverting changes nothing in production.
