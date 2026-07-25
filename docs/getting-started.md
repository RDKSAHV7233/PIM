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
- `.env.example` ships `PIM_AUTH_IDENTITIES_JSON=""` on purpose — it's gitignored, per-developer state, not something the repo can seed for you. To sign in as a role other than the bootstrap admin (e.g. to manually QA viewer/editor/approver/publisher/connector_admin/reviewer/channel_manager restrictions), add one entry per role to your local `.env`:

  ```
  PIM_AUTH_IDENTITIES_JSON={"admin@vexa-pim.local":{"tenantId":"default","workspaceSlug":"default","role":"admin"},"editor@vexa-pim.local":{"tenantId":"default","workspaceSlug":"default","role":"editor"},"viewer@vexa-pim.local":{"tenantId":"default","workspaceSlug":"default","role":"viewer"}}
  ```

  Add the remaining roles (`publisher`, `approver`, `connector_admin`, `reviewer`, `channel_manager`) the same way as you need them — see `AppRole` in `apps/api/src/common/rbac/roles.ts` for the full list. All identities share `PIM_AUTH_PASSWORD`. For automated Playwright E2E instead of manual QA, the equivalent identities already live in the tracked `.env.playwright`.
