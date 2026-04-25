# Installation

Status: Canonical  
Last reviewed: 2026-04-25

## Repository Layout

- `apps/web`: Next.js web app
- `apps/api`: NestJS API
- `packages/db`: Prisma schema, migrations, and database package
- `docs`: product, operations, API, architecture, and historical documentation
- `scripts`, `tools`: automation, gates, setup, release, and test helpers

## Local Installation

```bash
cp .env.example .env
npm install
npm run infra:up
npm run prisma:generate
npm run prisma:migrate:deploy
npm run auth:bootstrap-admin
```

Then run the services:

```bash
npm run dev:api
npm run dev:web
```

`npm run dev` starts the API only. Start the web app separately with `npm run dev:web`.

## Database

The API expects `DATABASE_URL_POOLED` and `DATABASE_URL_DIRECT`. Local `.env.example` points both at the Docker Compose PostgreSQL service.

Useful commands:

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:studio
npm run tenant:verify-rls
```

## Infrastructure

```bash
npm run infra:up
npm run infra:logs
npm run infra:down
```

The local stack uses Docker Compose for PostgreSQL and Redis-compatible infrastructure where configured.

## Production-Like Requirements

For `APP_ENV=staging` or `APP_ENV=production`, startup validation requires:

- `AUTH_MODE=db`
- `QUEUE_BACKEND=bullmq`
- `QUEUE_WORKER_ENABLED=true`
- valid `CORS_ORIGIN`
- commercial contact configuration
- `PIM_COMMERCIAL_OPS_TOKEN`
- production email provider requirements as described in [Configuration](configuration.md)

