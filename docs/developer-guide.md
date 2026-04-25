# Developer Guide

Status: Canonical  
Last reviewed: 2026-04-25

## Common Commands

```bash
npm run dev:api
npm run dev:web
npm run lint
npm test
npm run build
```

Focused scripts are listed in `package.json`. Prefer the narrowest relevant integration or e2e script when changing a single surface.

## Code Organization

- `apps/api/src`: NestJS modules, controllers, services, connector implementations, queues, auth, marketplace, catalog, media, and admin surfaces.
- `apps/web/src/app`: Next.js app routes and route handlers.
- `apps/web/test`: route contract and e2e tests.
- `apps/api/test`: API integration tests.
- `packages/db/prisma`: Prisma schema and migrations.
- `scripts` and `tools`: release, gates, OpenAPI, auth, tenant, and QA helpers.

## Development Rules

- Treat code and tests as the source of truth.
- Keep generated OpenAPI files aligned with controller changes.
- Add focused tests for connector capability gating, auth/tenant behavior, queue jobs, and user-visible route contracts.
- Do not document planned features as implemented.

## Connector Development

Current connector code lives in `apps/api/src/connectors` and connector orchestration lives in connector framework, installer, marketplace, and channel mapping modules.

Use `docs/connectors/README.md` for connector-specific references, but verify against code before updating capability claims.

## Database Development

Use Prisma commands from the root package scripts. RLS and tenant isolation have dedicated verification scripts and integration tests; run them when changing tenant-sensitive queries or raw SQL.

## Release Validation

Recommended broad validation before release:

```bash
npm run lint
npm test
npm run build
npm run openapi:check
npm run test:e2e:critical
```

Run staging checks from `package.json` for deployment validation.

