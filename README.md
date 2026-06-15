# Vexa PIM

Vexa PIM is a multi-tenant product information management workspace for catalog, quality, channel, operations, media, and admin workflows.

The repo code is the source of truth. Treat dated execution notes, review memos, and imported planning files as historical evidence unless a current canonical doc links to them explicitly.

## Current Stack

- Web: Next.js 15, React 19, TypeScript, Tailwind CSS
- API: NestJS on Express
- Database: PostgreSQL with Prisma
- Queue/cache: local fallback or BullMQ/Redis depending on environment
- Media/object storage: R2-compatible object storage plus local export fallback paths
- Connectors in code: Amazon India, Flipkart, Meesho, Myntra, Nykaa, Shopify, WooCommerce

## Quick Start

```bash
cp .env.example .env
npm install
npm run infra:up
npm run prisma:generate
npm run prisma:migrate:deploy
npm run auth:bootstrap-admin
npm run dev:api
```

In a second terminal:

```bash
npm run dev:web
```

Default local URLs:

- Web app: `http://localhost:3000`
- API: `http://localhost:4000/api/v1`

## Canonical Documentation

- [Documentation structure](docs/STRUCTURE.md)
- [Getting started](docs/getting-started.md)
- [Installation](docs/installation.md)
- [Configuration](docs/configuration.md)
- [User guide](docs/user-guide.md)
- [Admin guide](docs/admin-guide.md)
- [API guide](docs/api.md)
- [Developer guide](docs/developer-guide.md)
- [Architecture](docs/architecture.md)
- [Connector index](docs/connectors/README.md)
- [Current state](docs/execution/CURRENT_STATE.md)
- [QA data pack](qa/realistic-data/README.md)
- [Troubleshooting](docs/troubleshooting.md)
- [FAQ](docs/faq.md)

## Important Supporting References

- Product source reference: `docs/product/PRD.md`
- Increment tracking: `docs/execution/INCREMENT_STATE.json`
- Generated API contract: `docs/openapi.yaml` and `docs/openapi.json`
- Database package notes: `packages/db/README.md`

## Validation Commands

```bash
npm run lint --workspace @pim1/api
npm run build --workspace @pim1/api
npm run lint --workspace @pim1/web
npm run build --workspace @pim1/web
npm run test --workspace @pim1/web
npm run test:qa:realistic-data-pack
npm run openapi:check
git diff --check
```

Run the narrowest relevant integration or e2e script from `package.json` when changing a specific route, auth flow, connector, or admin surface.

## Repo-Truth Summary

- Web route inventory currently contains `69` `page.tsx` routes under `apps/web/src/app`.
- The workspace is organized around Dashboard, Catalog, Quality, Channels, Operations, Admin, Settings, Media, and product detail tabs.
- App roles in code are `admin`, `editor`, `publisher`, `approver`, `channel_manager`, `connector_admin`, `reviewer`, and `viewer`.
- Admin boundary roles in code are `product_admin`, `system_admin`, and `super_admin`.
- Public signup exists in code but is feature-flagged.
- Experimental/internal surfaces such as AI Labs, ONDC, and the internal developer page are environment- and role-gated.
