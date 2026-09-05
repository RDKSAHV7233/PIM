---
title: P1 Woo/Auth Technical Proof
status: local-proof-complete-staging-pending
owner: CTO / PO / Security / QA / SRE
last_updated: 2026-09-05
---

# P1 Woo/Auth Technical Proof - 2026-09-05

This record captures local technical proof for the integrated P1 Woo/Auth
release candidate. It is not production approval.

## Integrated Candidate

Base: `origin/main d7dbd8bf26e1`

Branch: `proof/p1-woo-auth-technical-proof-20260905-a`

Latest locally verified candidate SHA before this document refresh:
`5162b7e2e4cb`.

Included workstreams:

- P1-1 Woo app-auth tenant ownership.
- P1-2 auth revocation failure policy.
- P1-3 Woo customer setup/install hold.
- Security tightening: degraded revocation reads require an explicit allowlist.
- QA fix: Meesho reconnect skips live validation while RD-MEESHO-1 is deferred.

## Local Proof Completed

| Area | Command | Result |
| --- | --- | --- |
| Dependency install | `npm ci --ignore-scripts --no-audit --no-fund` | Passed in `/tmp` worktree |
| Prisma client | `npm run prisma:generate` | Passed |
| Hygiene | `git diff --check` and `git show --check` | Passed |
| P1 targeted unit | `npm run test:unit --workspace @pim1/api -- --runTestsByPath src/auth/jwt-auth.guard.spec.ts src/auth/auth.service.spec.ts src/auth/jwt-blocklist.service.spec.ts src/connectors/woocommerce/woocommerce.connector.spec.ts src/connector-framework/connector-launch-policy.spec.ts --runInBand` | Passed: 4 suites, 98 tests |
| Connector installer unit | `npm run test:unit --workspace @pim1/api -- --runTestsByPath src/connector-installer/connector-installer.service.spec.ts --runInBand` | Passed: 1 suite, 63 tests |
| API build | `npm run build --workspace @pim1/api` | Passed |
| Web build | `npm run build --workspace @pim1/web` | Passed |
| Woo customer hold copy | `node apps/web/test/integration/woocommerce-launch-copy-consistency.test.cjs` | Passed |
| JWT blocklist contract | `npm run test:integration:jwt-blocklist-contract` | Passed |
| Auth revocation integration | `DATABASE_URL=... npm run test:integration:auth-revocation` | Passed |
| Marketplace capability gating | `DATABASE_URL=... npm run test:integration:marketplace-capability-gating` | Passed |
| Credential rotation | `DATABASE_URL=... npm run test:integration:credential-rotation` | Passed on fresh proof DB |
| Connector access entitlements | `DATABASE_URL=... npm run test:integration:connector-access-entitlements` | Passed on fresh proof DB |
| Connector action matrix UI gating | `npm run test:integration:connector-action-matrix-ui-gating` | Passed |
| Marketplace capability UI gating | `npm run test:integration:marketplace-capability-ui-gating` | Passed |
| Admin connectors route contract | `npm run test:integration:admin-connectors-route-contract` | Passed |
| Staging workflow static validation | `node scripts/validate-deploy-staging-workflow.cjs` | Passed |
| Production promotion workflow static validation | `node scripts/validate-promote-stage3-workflow.cjs` | Passed |

Fresh local proof database:

- `pim1_p1_proof_20260905_0518`
- 94 migrations applied successfully.

After `origin/main` advanced to `d7dbd8bf26e1`, the proof branch merged the new
main commit and reran the compact proof set on `5162b7e2e4cb`:

- hygiene and `git show --check`: passed;
- P1 targeted unit: passed, 4 suites and 98 tests;
- Woo customer hold copy and stale-claim check: passed;
- staging and production workflow static validators: passed;
- API build plus auth-revocation integration: passed.

## Security Proof

Auth revocation behavior now fails closed by default:

- Mutating requests deny when revocation authority fails.
- Admin, step-up, and admin-boundary requests deny.
- Refresh returns invalid-token behavior when JTI or credential-revocation
  lookup fails.
- Generic self-service reads deny unless explicitly approved.
- `public_safe` routes and `taxonomy_safe_metadata` are the only current
  degraded-read allowlist entries.

The explicit degraded-read inventory is recorded in
`AUTH_REVOCATION_DEGRADED_READ_ROUTE_INVENTORY_2026-09-05.md`.

## PO Proof

WooCommerce remains treated as working internally, but customer onboarding is
held:

- Woo launch policy is `p1_blocker_hold`.
- Customer setup/install lanes hide or block Woo.
- Public/customer copy no longer says approved, available now, GA, or
  public-sellable.
- Admin/internal pipeline may show P1 blocker-closure status.

## Remaining Before Staging Or Live Signoff

- Exact-SHA CI on the pushed integrated proof branch.
- Staging deploy from the reviewed SHA only.
- Real Woo app-auth onboarding in staging.
- Tenant-owned Woo credential-row proof without plaintext secrets.
- Redis-backed outage probes in staging with live Redis.
- `STAGING_DEPLOY_POSTCHECK` gate artifact with live GitHub Actions URL.
- Controlled rollout snapshot showing health ok and no controlled pending
  blockers.
- Fresh named CTO, PO, Security, QA, and SRE approval.

Production/live promotion remains blocked until the staging proof and approvals
above are complete.
