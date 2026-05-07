# Vexa PIM Staging DB Secret Remediation

- Date: 2026-05-07
- Audience: CTO, DevOps, release owner, staging environment owner
- Scope: post-push staging deployment failure on the Large Import Mode MVP follow-up chain

## Summary

The pushed Large Import Mode MVP follow-up chain is green in repository CI, but the staging deploy workflow failed before application deploy because the staging database credentials used for migrations are not valid.

This is an environment/secret issue, not a confirmed product-code regression.

## Affected pushed tip

- pushed tip: `4919c1b6c25da348fff41514ce3f44fcd6aaa44b`
- branch: `main`

Related pushed commits in this slice:
- `53d00f1` `fix(imports): wire large-run workflow and policy parity`
- `e09085b` `test(imports): add browser proof and align large-import docs`
- `0ab64a2` `docs(imports): add large-import rollout guidance`
- `60f9787` `docs(imports): correct admin import setup limits`
- `2e6a814` `docs(review): add large-import mvp handoff package`
- `4919c1b` `docs(imports): add large-import rollout handoff`

## Observed GitHub Actions status

### Passed
- `CI` run `25487251526`

### Failed
- `Deploy Staging` run `25487251996`

Failure step:
- `Apply migrations`

Failure snippet:

```text
Error: P1000: Authentication failed against database server, the provided database credentials for `postgres` are not valid.
```

Workflow context from the failed step:
- `DATABASE_URL_DIRECT` was present
- Prisma attempted to connect to:
  - `autorack.proxy.rlwy.net:10034`
- failure occurred before:
  - API build
  - web build
  - Railway deploy
  - staging smoke
  - post-deploy verification
  - public signup smoke
  - E2E smoke

## Classification

- Type: environment issue
- Not currently classified as a product regression
- Likely owner: DevOps / Railway environment owner / GitHub Actions secret owner

## Likely cause

One of these is likely true:

1. `STAGING_DATABASE_URL_DIRECT` points to the correct host but contains stale or rotated credentials.
2. The underlying Railway/Postgres user password changed, but the GitHub Actions environment secret was not updated.
3. The secret value was malformed when stored, for example bad escaping, truncation, or wrong user/database pair.

## Exact configuration path to verify

Workflow file:
- `.github/workflows/deploy-staging.yml`

Migration script:
- `scripts/prisma-migrate-deploy.cjs`

Current migration behavior:
- `Apply migrations` prefers `DATABASE_URL_DIRECT`
- falls back to `DATABASE_URL`
- then runs:
  - `npm run prisma:migrate:deploy`

The failing workflow currently sources:
- `DATABASE_URL_DIRECT: ${{ secrets.STAGING_DATABASE_URL_DIRECT }}`
- `DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}`

## Remediation checklist

1. Open GitHub repository settings for Actions environment/secret management.
2. Verify the `staging` environment secret values for:
   - `STAGING_DATABASE_URL_DIRECT`
   - `STAGING_DATABASE_URL`
3. Open the Railway staging database/service configuration.
4. Confirm the real direct Postgres connection string and current database password.
5. Compare the Railway connection string against the GitHub secret currently in use.
6. If credentials drifted, update:
   - `STAGING_DATABASE_URL_DIRECT`
   - and optionally `STAGING_DATABASE_URL` if it is intended as a fallback
7. Re-run `Deploy Staging` for run `25487251996`, or trigger a new `deploy-staging.yml` workflow run.
8. Confirm the job now passes:
   - `Apply migrations`
   - `Build API`
   - `Build Web`
   - `Deploy to staging`
   - `Staging smoke test`
   - `Staging post-deploy verification (auth + trust boundary)`
   - `Public signup smoke check`
   - `E2E smoke - post-deploy verification`
9. After the rerun, refresh rollout evidence if needed.

## What not to infer from this failure

Do not infer:
- that Large Import Mode code is broken
- that the current pushed chain failed repository CI
- that staging runtime smoke failed
- that Railway deployment itself failed

Those later phases were never reached in the failed workflow.

## Safe execution conclusion

Current conclusion:

`The Large Import Mode MVP follow-up chain is code-green in repository CI. Staging deploy is blocked by invalid staging database credentials at the migration step and requires environment-secret remediation before rollout evidence can be refreshed.`
