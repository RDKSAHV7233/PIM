# PIM1 Monorepo

India-first PIM SaaS foundation on locked stack:
- Web: Next.js 15 + TypeScript + Tailwind
- API: NestJS (Fastify) + TypeScript
- Database: PostgreSQL + Prisma + JSONB

## Workspace Layout
- `apps/web`: Next.js App Router UI
- `apps/api`: NestJS API services
- `packages/db`: Prisma schema and client generation

## Prerequisites
- Node.js 24+
- Docker Desktop running (for local PostgreSQL, Redis, RabbitMQ)
- PgBouncer required in production. See `docs/runbooks/connection-pool.md`.
- Media CDN baseline (S3 + CloudFront) runbook: `docs/runbooks/media-cdn-baseline.md`.
- Connector credential key rotation runbook: `docs/runbooks/credential-key-rotation.md`.

## Setup
1. Copy `.env.example` to `.env` and set `DATABASE_URL`.
2. Install packages:
   - `npm install`
3. Start local infrastructure (PostgreSQL, Redis, RabbitMQ):
   - `npm run infra:up`
4. Generate Prisma client:
   - `npm run prisma:generate`
5. Create initial schema in DB:
   - `npm run prisma:migrate:init`

## Run
- API:
  - `npm run dev:api`
- Web:
  - `npm run dev:web`
- Infrastructure logs:
  - `npm run infra:logs`
- Stop infrastructure:
  - `npm run infra:down`

## Build Checks
- `npm run lint --workspace @pim1/api`
- `npm run lint --workspace @pim1/web`
- `npm run build --workspace @pim1/api`
- `npm run build --workspace @pim1/web`

## Credential Key Rotation
- Dry-run:
  - `npm run credentials:rotate -- --from 1 --to 2 --dry-run`
- Execute:
  - `npm run credentials:rotate -- --from 1 --to 2 --confirm`
