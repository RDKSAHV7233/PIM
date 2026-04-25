# Getting Started

Status: Canonical  
Last reviewed: 2026-04-25

## Who This Is For

Use this guide when you need a local Vexa PIM workspace running for product, QA, design, or development review.

## Prerequisites

- Node.js compatible with the repo lockfile and workspace packages
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

## First Workflow To Verify

1. Sign in with the bootstrapped admin account.
2. Open Dashboard and confirm aggregate catalog and quality widgets load.
3. Open Catalog or Products and verify product lists/detail pages load.
4. Open Channels and Connectors to verify connector definitions and installation health.
5. Open Operations to verify imports, jobs, bulk edit, and repair pages.
6. Open Admin to verify users, API keys, webhooks, plan, and privacy pages.

## Local Auth Notes

Local development can use `AUTH_MODE=local` with credentials from `.env`. Staging and production must use `AUTH_MODE=db`; this is enforced by API startup validation.

