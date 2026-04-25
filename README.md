# Vexa PIM

Vexa PIM is a multi-tenant product information management workspace for catalog operations, marketplace readiness, connector setup, publishing, media validation, quality review, and admin governance.

The codebase is the source of truth. Use the documentation below for current workflows; older execution notes and imported planning artifacts are retained as history unless they are linked from this README.

## Current Stack

- Web: Next.js 15, React, TypeScript, Tailwind CSS
- API: NestJS on Fastify
- Database: PostgreSQL with Prisma
- Queue/cache: in-memory locally or BullMQ/Redis for staging and production
- Media: Cloudflare R2-compatible object storage
- Connectors: Amazon India, Flipkart, Shopify, and partial Meesho export support

## Quick Start

```bash
cp .env.example .env
npm install
npm run infra:up
npm run prisma:generate
npm run prisma:migrate:deploy
npm run auth:bootstrap-admin
npm run dev:api
npm run dev:web
```

Default local URLs:

- Web app: `http://localhost:3000`
- API: `http://localhost:4000/api/v1`

## Canonical Documentation

- [Getting started](docs/getting-started.md)
- [Installation](docs/installation.md)
- [Configuration](docs/configuration.md)
- [User guide](docs/user-guide.md)
- [Admin guide](docs/admin-guide.md)
- [API guide](docs/api.md)
- [Developer guide](docs/developer-guide.md)
- [Architecture](docs/architecture.md)
- [Troubleshooting](docs/troubleshooting.md)
- [FAQ](docs/faq.md)
- [Documentation audit, 2026-04-25](docs/documentation-audit-2026-04-25.md)

## Important Supporting References

- Product source of truth: `docs/product/PRD.md`
- Increment state: `docs/execution/INCREMENT_STATE.json`
- Runtime state notes: `docs/execution/CURRENT_STATE.md`
- Connector index: `docs/connectors/README.md`
- Generated OpenAPI: `docs/openapi.yaml` and `docs/openapi.json`
- Database package notes: `packages/db/README.md`

## Validation Commands

```bash
npm run lint
npm test
npm run build
npm run openapi:check
```

Run focused integration scripts from `package.json` when changing a specific route, connector, queue, auth, or admin surface.
