# P1 Woo App-Auth Credential Persistence Closure

Date: 2026-09-04
Status: Locally fixed after required-team review; pending PR review, CI, staging runtime verification
Baseline: origin/main `d7339b1cf`
Worktree: `/mnt/c/Users/bhoiv/PIM1-origin-main-readiness-20260903-085633`

## Defect

WooCommerce app-auth credential persistence called `tenantExecRaw()` with SQL
that inserted into `connector_credentials` without a `tenant_key` column.
Required-team review then found the companion read risk: stored Woo credentials
were read by `installationId` and `credentialType` without binding
`tenantKey`.

Impact:

- `tenantExecRaw()` rejects SQL without a `tenant_key` reference.
- If that guard were bypassed, the Prisma schema default could assign
  `tenant_key = "default"` instead of the authenticated tenant.
- WooCommerce app-auth onboarding and subsequent validation/publish/webhook
  secret reads could not be considered safe for a controlled pilot.

## Local Fix

`apps/api/src/connectors/woocommerce/woocommerce.connector.ts`

- Requires `ctx.tenantId` before persistence.
- Inserts `tenant_key` explicitly for `consumer_key`.
- Inserts `tenant_key` explicitly for `consumer_secret`.
- On conflict, updates `tenant_key` and `installation_id` from the proposed row.
- Requires tenant context before stored credential reads used by validation and
  publish paths.
- Reads stored credentials by `tenantKey`, `installationId`, and
  `credentialType`.
- Passes webhook tenant context from ingestion into connector parsing so
  per-installation `webhook_secret` lookup is tenant-owned when available.

`apps/api/src/connectors/woocommerce/woocommerce.connector.spec.ts`

- Adds regression coverage that successful app-auth persistence binds the
  expected tenant key for both credential rows.
- Adds regression coverage that missing tenant context rejects before any raw DB
  write.
- Adds regression coverage that stored credential reads include tenant,
  installation, and type.
- Adds regression coverage that missing tenant context rejects before stored
  credential DB access.
- Adds regression coverage that webhook secret reads include tenant when
  provided, and skip per-installation DB lookup when tenant context is absent.

`apps/api/src/connector-framework/connector-webhook-ingestion.service.ts`

- Passes `tenantId` into `parseWebhookEvent()` context for connector-specific
  per-installation webhook secret lookup.

`apps/api/src/connector-framework/connector.interface.ts`

- Extends the optional webhook parse context type to include `tenantId`.

## Local Verification

Commands:

```text
npm run test:unit --workspace @pim1/api -- --runTestsByPath src/connectors/woocommerce/woocommerce.connector.spec.ts --testNamePattern='app-auth credential persistence|stores consumer credentials|denies app-auth persistence' --runInBand --verbose

npm run test:unit --workspace @pim1/api -- --runTestsByPath src/connectors/woocommerce/woocommerce.connector.spec.ts --runInBand

npm run lint --workspace @pim1/api

git diff --check
```

Results:

```text
Full Woo connector spec: PASS, 36 passed
API TypeScript lint: PASS
Whitespace check: PASS
```

Verification note: the isolated worktree did not have its own `node_modules`.
Testing used a temporary symlink to the existing dependency tree at
`/mnt/c/Users/bhoiv/PIM1/node_modules`; the symlink was removed after
verification.

## Remaining Gate

This is not merge or pilot approval.

Required before changing control state:

- PR review by Woo Connector Engineering, Backend, Multi-tenant/Data reviewer,
  QA, and Security.
- CI green on the submitted commit.
- Staging deployed from the same/equivalent SHA.
- Real WooCommerce app-auth onboarding exercise in staging.
- Credential write and read ownership verified by tenant key without exposing
  plaintext credential values.
