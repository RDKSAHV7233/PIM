# Vexa PIM Monorepo

Product naming note:
- Product brand: `Vexa PIM`
- Company/internal working references: `TEJ`
- Legacy technical codename retained in package names, env prefixes, and repo history: `PIM1`

India-first PIM SaaS foundation on locked stack:
- Web: Next.js 15 + TypeScript + Tailwind
- API: NestJS (Fastify) + TypeScript
- Database: PostgreSQL + Prisma + JSONB

Current repo state:
- Canonical product baseline: `docs/product/PRD.md`
- Current execution snapshot: `docs/execution/CURRENT_STATE.md`
- Increment source of truth: `docs/execution/INCREMENT_STATE.json`
- Canonical connector documentation entry point: `docs/connectors/README.md`
- Public signup is implemented behind:
  - `FEATURE_PUBLIC_SIGNUP_ENABLED`
  - `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED`

## Workspace Layout
- `apps/web`: Next.js App Router UI
- `apps/api`: NestJS API services
- `packages/db`: Prisma schema and client generation

## Prerequisites
- Node.js 24+
- Docker Desktop running (for local PostgreSQL, Redis, RabbitMQ)
- Connector credential key rotation runbook: `docs/runbooks/credential-key-rotation.md`
- Auth bootstrap runbook: `docs/runbooks/auth-bootstrap-admin.md`
- Test-data governance runbook: `docs/runbooks/test-data-governance.md`
- Public signup production rollout runbook: `docs/runbooks/public-signup-production-rollout.md`

## Setup
1. Copy `.env.example` to `.env`.
2. Install packages:
   - `npm install`
3. Start local infrastructure (PostgreSQL, Redis, RabbitMQ):
   - `npm run infra:up`
4. Generate Prisma client:
   - `npm run prisma:generate`
5. Apply the tracked schema to the local database:
   - `npm run prisma:migrate:deploy`
6. Bootstrap a local admin identity when required:
   - `npm run auth:bootstrap-admin`

## Run
- API:
  - `npm run dev:api`
- Web:
  - `npm run dev:web`
- If the local Next.js runtime serves stale chunks:
  - `tools/dev/recover-web-runtime.ps1`
- If the staging URL is not reachable in Chrome (Railway domain DNS not resolving on Windows):
  - Set `STAGING_BASE_URL` and `STAGING_WEB_URL` (and optionally `STAGING_RESOLVE_IP`) in your `.env` or shell
  - Run as Administrator: `tools/dev/patch-browser-dns.ps1`
  - This writes the required hosts-file entries so all browsers resolve Railway domains to the correct IP
  - Run `ipconfig /flushdns` afterwards if the change is not picked up immediately
  - To undo: `tools/dev/patch-browser-dns.ps1 -Remove`
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

## Canonical Docs
- Product requirements: `docs/product/PRD.md`
- Product source index: `docs/product/PRD_SOURCES.md`
- Current implementation/execution snapshot: `docs/execution/CURRENT_STATE.md`
- Backlog: `docs/execution/PRD_TO_ENGINEERING_BACKLOG.md`
- Consolidated user guide: `docs/pim-user-guide.md`
- Admin setup checklist: `docs/admin-setup-checklist.md`
- Tenant login and signup model: `docs/auth/TEJ_PIM_TENANT_LOGIN_SPEC.md`
- Public signup production rollout: `docs/runbooks/public-signup-production-rollout.md`
- Connector docs SSOT: `docs/connectors/README.md`
- Connector current-state baseline: `docs/connectors/TEJ_PIM_CONNECTOR_CURRENT_STATE_2026-03-08.md`
- User guides: `docs/product/user-guide/` (supporting operational guides, not sole implementation truth)
- OpenAPI references: `docs/openapi.yaml`, `docs/openapi.json` (supporting contract references, not sole implementation truth)
