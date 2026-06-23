# Installation

Status: Canonical
Last reviewed: 2026-06-15

## Repository Layout

- `apps/web`: Next.js web app
- `apps/api`: NestJS API
- `packages/db`: Prisma schema, migrations, and DB package
- `docs`: canonical docs plus historical evidence and review material
- `scripts` and `tools`: setup, QA, release, and validation helpers

## Local Install

```bash
cp .env.example .env
npm install
npm run infra:up
npm run prisma:generate
npm run prisma:migrate:deploy
npm run auth:bootstrap-admin
```

Then run:

```bash
npm run dev:api
npm run dev:web
```

Notes:

- `npm run dev` starts only the API.
- The web app is started separately with `npm run dev:web`.
- On Windows `cmd.exe`, you can also use `scripts\\start-vexa-local.cmd` to start and `scripts\\stop-vexa-local.cmd` to stop the local stack.

## Database And Infra

Useful commands:

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:studio
npm run tenant:verify-rls
npm run infra:logs
npm run infra:down
```

Local `.env.example` points the database URLs at the Docker Compose PostgreSQL service.

## Production-Like Requirements

For `APP_ENV=staging` or `APP_ENV=production`, API startup validation requires at least:

- `AUTH_MODE=db`
- `QUEUE_BACKEND=bullmq`
- `QUEUE_WORKER_ENABLED=true`
- valid `CORS_ORIGIN`
- production-safe email configuration
- commercial ops configuration

See [Configuration](configuration.md) for the env-level details.
