# Architecture

Status: Canonical
Last reviewed: 2026-06-15

## System Shape

Vexa PIM is a TypeScript monorepo with:

- Next.js web routes for dashboard, catalog, channels, quality, operations, admin, settings, media, and internal tools
- NestJS API modules for auth, catalog, taxonomy, marketplace, connectors, media, billing, admin, and notifications
- PostgreSQL through Prisma
- queue-backed async processing for imports, publishing, exports, and recovery work
- object storage integration for media and some export flows

## High-Level Flow

1. Users interact with the Next.js app in `apps/web`.
2. The web app calls API endpoints or internal route handlers.
3. The API authenticates, resolves tenant context, validates input, and calls domain services.
4. Domain services use Prisma, connector services, and queue backends.
5. Long-running work is processed through queue-backed jobs where required.

## Core Domains

- Catalog: products, variants, relationships, workflow, and activity
- Taxonomy: categories and attribute definitions
- Quality: issues, completeness, approvals, and rejection intelligence
- Channels and marketplace: mappings, readiness, submissions, and channel-specific workflows
- Connectors: install, credentials, publish/export behavior, webhook handling, status sync, and recovery
- Media: upload, validation, governance metadata, and associations
- Admin and commercial: users, API keys, webhooks, auth policy, privacy, plan, and commercial operations

## Connector Model

Connectors implement a shared capability interface and are then filtered by launch-stage policy.

Current repo-truth examples (verified 2026-09-17 against `connector-framework/connector-launch-policy.ts`):

- live launch-stage: Flipkart, Myntra (unconditional GA); Shopify (GA, but managed OAuth/webhooks unverified)
- controlled-pilot launch-stage: WooCommerce (CTO/PO-approved 2026-09-03, capped at 2 Enterprise tenants — not GA)
- manual launch-stage: Meesho, Nykaa (export-only, no direct API publish)
- under-development / preview posture: Amazon India (experimental, not recommended for production catalogues)

Implementation status and launch stage are separate concerns. A connector can exist in code while still being treated as preview or early-access in the UI and documentation.

## Environment Tiers

- Local: can use local auth and fallback queue behavior
- The one live environment (internally named "staging" in Railway; this is what actually serves `app.vexapim.com`, including real pilot-customer traffic — see `docs/operations/CURRENT_PRODUCTION_ARCHITECTURE.md`): requires DB auth, BullMQ, queue worker enablement, valid CORS, production-safe email config, and commercial ops config

Confirmed 2026-09-17: there is currently no second, separate "production" environment. The
`APP_ENV` validator (`env-validation.ts`) accepts `"production"` as a value and a handful of code
paths branch on it (Sentry sampling, email-provider requirement, hiding internal tooling), but no
runbook, health-check log, or GitHub Actions run shows `APP_ENV=production` ever having actually
been fed to a running instance — it's a defined, ready branch, not an exercised one.
