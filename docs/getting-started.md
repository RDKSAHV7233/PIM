# Getting Started

Status: Canonical
Last reviewed: 2026-06-15

## Who This Is For

Use this guide when you need a local Vexa PIM workspace for product review, QA, design review, or engineering work.

## Prerequisites

- Node.js compatible with the repo lockfile
- npm
- Docker Desktop or another Docker Compose runtime
- Git

## Start Locally

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

Open:

- Web app: `http://localhost:3000`
- API health: `http://localhost:4000/api/v1/health`

## First Checks

1. Sign in at `/login`.
2. Verify `Dashboard` loads.
3. Verify `Catalog > Products` and a product detail page load.
4. Verify `Channels`, `Operations`, and `Quality` load.
5. Verify `Admin` and `Settings` load for an admin user.

## Local Auth Notes

- Local development can run with `AUTH_MODE=local`.
- Staging and production must use `AUTH_MODE=db`.
- Public signup is feature-gated and may be absent unless `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED=true`, or `FEATURE_PUBLIC_SIGNUP_ENABLED=true` when the public flag is unset.
