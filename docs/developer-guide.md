# Developer Guide

Status: Canonical
Last reviewed: 2026-06-15

## Common Commands

```bash
npm run dev:api
npm run dev:web
npm run lint
npm test
npm run build
```

Prefer the narrowest relevant script from `package.json` when changing a single surface.

## Code Organization

- `apps/api/src`: NestJS modules, controllers, services, connectors, auth, billing, marketplace, media, and admin domains
- `apps/web/src/app`: Next.js routes and route handlers
- `apps/web/test`: web integration and e2e coverage
- `apps/api/test`: API integration and seam coverage
- `packages/db/prisma`: schema and migrations
- `scripts` and `tools`: QA, release, OpenAPI, auth, tenant, and deployment helpers

## Rules

- Code and tests beat docs.
- Keep generated OpenAPI aligned with controller changes.
- Do not document planned behavior as implemented behavior.
- When changing route behavior, update the corresponding canonical doc in the same pass.

## QA Dataset Commands

```bash
npm run qa:data:generate
npm run qa:data:seed
npm run qa:data:seed:ops
npm run qa:data:seed:control-plane
npm run qa:data:cleanup
npm run test:qa:realistic-data-pack
```

Repo-truth notes:

- `qa:data:seed` creates the core dataset only
- ops-heavy artifacts are opt-in
- control-plane mutations are opt-in
- cleanup is dataset-owned only

## Connector Development

Connector implementations live in `apps/api/src/connectors`.

Important supporting modules:

- `apps/api/src/connector-framework`
- `apps/api/src/connector-installer`
- `apps/api/src/marketplace`
- `apps/web/src/app/connectors`
- `apps/web/src/app/channels`

Use `docs/connectors/README.md` as the connector entry point, but verify capability and launch-stage claims against code before changing docs.

## Release Validation

Recommended broad validation:

```bash
npm run lint
npm test
npm run build
npm run openapi:check
npm run test:qa:realistic-data-pack
```
