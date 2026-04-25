# Architecture

Status: Canonical  
Last reviewed: 2026-04-25

## System Shape

Vexa PIM is a TypeScript monorepo with:

- Next.js web app for product, channel, quality, operations, and admin workflows.
- NestJS API for domain logic, auth, connectors, marketplace publishing, media, queues, and administration.
- PostgreSQL accessed through Prisma.
- Redis/BullMQ for production queue processing.
- R2-compatible object storage for media assets.

## Request Flow

1. User interacts with `apps/web`.
2. Web route handlers and client code call the API.
3. API modules authenticate, resolve tenant context, validate input, and call domain services.
4. Domain services use Prisma and connector framework services.
5. Queue-backed work handles publishing, exports, status sync, and operational jobs.

## Core Domains

- Catalog: products, variants, completeness, workflow state, and purge/delete flows.
- Taxonomy: categories, attributes, mappings, and channel alignment.
- Marketplace: channels, connector mappings, readiness, publish simulation, export jobs, and submissions.
- Connectors: install, credentials, validation, publish, status sync, webhook relay, and capability checks.
- Media: assets, validation, approval metadata, and associations.
- Quality: compliance, issues, approvals, and rejection intelligence.
- Admin: users, API keys, webhooks, plan/commercial controls, audit, and privacy.

## Connector Model

Connectors expose capabilities through a shared interface. UI and API behavior must respect those capabilities:

- Full publish connectors: Amazon India, Flipkart, Shopify.
- Partial connector: Meesho has validation/export-oriented behavior and does not implement direct publish.

## Environment Tiers

- Local: can use local auth and in-memory queue backend.
- Staging/production: must use DB auth, BullMQ, enabled queue worker, configured CORS, production-safe email settings, and commercial ops configuration.

