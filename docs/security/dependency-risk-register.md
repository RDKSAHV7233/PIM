# Vexa PIM Dependency Risk Register

Date: 2026-04-30
Scope: Production dependency audit, `npm audit --omit=dev --audit-level=high`
Status: P0 dependency audit high gate closed after Express migration.

## Audit Summary

| Command | Result | Evidence |
|---|---|---|
| `npm audit --omit=dev --audit-level=high` | Pass | No high or critical production advisories remain. |
| `npm audit --omit=dev --json` | Fail on moderate only | 2 production moderate findings remain: `next` via nested `postcss`. |
| `npm ls xlsx fastify @nestjs/platform-fastify @nestjs/platform-express ajv postcss next lodash prisma effect path-to-regexp` | Evidence captured | Confirms no production `xlsx`, no `@nestjs/platform-fastify`, no production `fastify`; API now uses `@nestjs/platform-express@11.1.19 -> express@5.2.1`. |

## Risk Register

| Package | Version | Severity | Advisory | Dependency path | Exposure | Decision | Owner | Expiry date | Compensating control | Next action |
|---|---:|---|---|---|---|---|---|---|---|---|
| `xlsx` | Removed | High before fix | GHSA-4r6h-8v6p-xvw6; GHSA-5pgg-2g8v-p4x9 | Was direct in `apps/api` | Was reachable from authenticated bulk import jobs parsing user-uploaded `.xls/.xlsx`. | Fixed | Data Import Owner / Security Owner | N/A | Spreadsheet parsing removed; API and web now accept CSV/JSON only. | Choose maintained parser or isolated worker before restoring spreadsheet support. |
| `fastify` | Removed from production tree | High before fix | GHSA-247c-9743-5963 | Was `@pim1/api -> @nestjs/platform-fastify@11.1.19 -> fastify@5.8.4` | Was runtime API HTTP adapter. | Fixed by Express migration | Backend Platform Owner / Security Owner | N/A | API now boots with `@nestjs/platform-express`; exact root `overrides.fastify = "5.8.5"` was tried first and still left Nest resolving `fastify@5.8.4`. | Monitor API regression after deployment; no Fastify waiver required for production. |
| `@nestjs/platform-fastify` | Removed | High via `fastify` before fix | GHSA-247c-9743-5963 | Was direct dependency of `apps/api` | Was runtime API adapter. | Fixed by Express migration | Backend Platform Owner / Security Owner | N/A | Replaced with `@nestjs/platform-express@11.1.19`. | Keep Express adapter unless a future Fastify reintroduction clears audit and regression. |
| `postcss` | 8.4.31 nested in Next | Moderate | GHSA-qx2v-qp2m-jg93 | `@pim1/web -> next@15.5.15 -> postcss@8.4.31` | Build/render tooling path; exploit requires unsafe CSS stringify output. No user CSS authoring path is enabled for production customers. | Follow-up | Frontend Platform Owner | 2026-05-30 | Direct workspace `postcss` is patched at 8.5.12; nested Next pin remains. | Track Next release that updates nested PostCSS; do not downgrade to `next@9.3.3`. |

## PO Validation Tickets

| Priority | Ticket | Customer impact | Business risk | Acceptance criteria | Evidence required | Status | Release gate impact |
|---|---|---|---|---|---|---|---|
| P0 | DEP-P0-001 Remove vulnerable `xlsx` parser from production import path | Spreadsheet uploads are temporarily unavailable; CSV/JSON imports remain available. | Prevents malicious spreadsheet parsing from blocking production. | `xlsx` absent from production dependency tree; `.xls/.xlsx` rejected; CSV/JSON still build and typecheck. | `npm ls xlsx`; API/web build; bulk import UI/server action evidence. | Fixed | Removes `xlsx` production blocker. |
| P0 | DEP-P0-002 Attempt Fastify 5.8.5 override before migration | No feature loss if override works; otherwise migration required. | Prevents waiver from becoming the main release path. | Exact root override must install `fastify@5.8.5`, clear high audit, and pass regression. | `npm ls fastify`; audit output. | Failed safely | Triggered Express migration. |
| P0 | DEP-P0-003 Migrate API adapter from Fastify to Express | No intended customer-facing behavior change. | Removes vulnerable Fastify adapter dependency from production. | No production Fastify dependency; high audit passes; API/web builds and targeted adapter-risk tests pass. | `npm audit --omit=dev --audit-level=high`; `npm ls`; API/web lint/build; auth/RBAC, internal-token, billing, provisioning, webhook, bulk import, and media tests. | Fixed | Production high gate closed. |
| P1 | DEP-P1-004 Resolve nested Next/PostCSS moderate XSS finding | No current customer impact identified. | Enterprise scanners may flag nested vulnerable PostCSS. | Next nested PostCSS is patched or documented as non-runtime user-input path. | `npm audit --omit=dev --json`; `npm ls postcss next`; web build. | Follow-up | Does not block production; may block enterprise. |

## CTO Decision Notes

- `xlsx` was risky because it parsed user-controlled spreadsheets and had no npm fix. Removing the dependency and disabling spreadsheet import closes that P0.
- Fastify override was tried first, including the exact CTO-preferred root form `overrides.fastify = "5.8.5"`, plus parent-scoped/version-scoped forms and a direct `fastify@5.8.5` API dependency. All left Nest resolving `@nestjs/platform-fastify -> fastify@5.8.4`, so they did not clear audit.
- Express migration removes `@nestjs/platform-fastify`, `@fastify/static`, and production Fastify from the API dependency tree. The API now boots with `@nestjs/platform-express@11.1.19`.
- Express regression validation passed after a list-only media tenant-scope adjustment: cross-tenant asset listing by foreign variant ID returns an empty list instead of a 404 existence signal.
- `postcss` remains moderate under Next. It is tracked as a follow-up because the npm-proposed fix is a major downgrade to `next@9.3.3`, which is not an acceptable production mitigation.
