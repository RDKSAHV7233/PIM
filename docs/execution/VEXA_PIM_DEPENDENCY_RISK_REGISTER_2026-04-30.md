# Vexa PIM Dependency Risk Register

Date: 2026-04-30
Scope: Production dependency audit, `npm audit --omit=dev --audit-level=high`
Status: P0 dependency audit high gate closed after Express migration.

## Summary

The Fastify P0 was not waived as the main solution. The execution path was:

1. Attempt the exact CTO-preferred root override: `overrides.fastify = "5.8.5"`.
2. Confirm npm still resolved `@nestjs/platform-fastify -> fastify@5.8.4` and the high audit still failed.
3. Attempt parent-scoped/version-scoped override forms and a direct API `fastify@5.8.5` dependency.
4. Confirm npm either left Nest on vulnerable `5.8.4` or installed a second safe Fastify copy while Nest still used vulnerable `5.8.4`.
5. Migrate API runtime adapter from Fastify to Express as the fallback remediation.

After migration, `npm audit --omit=dev --audit-level=high` passes. `npm audit --omit=dev --json` still reports 2 moderate findings for nested Next/PostCSS.

## Fixed High Vulnerabilities

| Package | Installed version | Advisory | Former affected path | Exposure in Vexa | Decision | Owner | Status |
|---|---:|---|---|---|---|---|---|
| `fastify` via `@nestjs/platform-fastify` | Removed | GHSA-247c-9743-5963 | `apps/api` HTTP adapter | Was runtime API adapter. | Replaced Fastify adapter with Express adapter after override failed. | Backend Platform Owner / Security Owner | Fixed |
| `@nestjs/platform-fastify` | Removed | GHSA-247c-9743-5963 via Fastify | Direct API dependency | Was runtime API adapter package. | Removed from production dependency tree. | Backend Platform Owner / Security Owner | Fixed |
| `xlsx` | Removed | GHSA-4r6h-8v6p-xvw6; GHSA-5pgg-2g8v-p4x9 | `apps/api/src/bulk-import/bulk-import.service.ts` | Was reachable from authenticated user-uploaded `.xlsx` / `.xls` bulk import files. | Dependency/parser removed; CSV/JSON remain supported. | Data Import Owner / Security Owner | Fixed |

## Moderate Vulnerabilities Remaining

| Package | Severity | Affected path | Notes |
|---|---|---|---|
| `postcss` via `next` | Moderate | `next@15.5.15 -> postcss@8.4.31` | Next still embeds vulnerable PostCSS. Npm suggests a breaking downgrade to `next@9.3.3`, which is not acceptable. Track for Next patch release. |

## Validation Evidence

- `npm audit --omit=dev --audit-level=high`: passes; no high or critical production advisories remain.
- `npm audit --omit=dev --json`: 2 moderate production findings remain: `next` and nested `postcss`.
- `npm ls xlsx fastify @nestjs/platform-fastify @nestjs/platform-express ajv postcss next lodash prisma effect path-to-regexp`: confirms no production `xlsx`, no production `fastify`, no `@nestjs/platform-fastify`, and `@nestjs/platform-express@11.1.19 -> express@5.2.1`.
- `npm run lint --workspace @pim1/api`: passes.
- `npm run build --workspace @pim1/api`: passes.
- `npm run lint --workspace @pim1/web`: passes.
- `npm run build --workspace @pim1/web`: passes.
- `node apps/api/test/integration/auth-account-privacy-authz.test.cjs`: passes.
- `node apps/api/test/integration/access-policy-remediation.test.cjs`: passes.
- `node apps/api/test/integration/internal-token-hardening-static.test.cjs`: passes.
- `node apps/api/test/integration/billing-commercial-control.test.cjs`: passes.
- `node apps/api/test/integration/platform-tenant-provisioning.test.cjs`: passes.
- `node apps/api/test/integration/amazon-webhook-relay-controller.test.cjs`: passes.
- `node apps/api/test/integration/bulk-import-tenant-boundary.test.cjs`: passes.
- `node apps/api/test/integration/bulk-import-spreadsheet-disabled.test.cjs`: passes.
- `node apps/api/test/integration/media-tenant-boundary.test.cjs`: passes.
- `node apps/api/test/integration/media-ssrf-guard.test.cjs`: passes.
- `node apps/api/test/integration/env-validation.test.cjs`: passes.

## Release Gate Impact

- Staging: allowed.
- Controlled demo with test data: allowed.
- Pilot with test data: allowed.
- Pilot with real customer data: allowed from dependency P0 perspective.
- Production: allowed from dependency P0 perspective.
- Enterprise release: follow-up required for nested Next/PostCSS moderate finding and enterprise scanner evidence.
