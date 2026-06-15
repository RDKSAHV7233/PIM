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

Current repo-truth examples:

- live launch-stage: Flipkart, Shopify, Myntra
- manual launch-stage: Meesho, Nykaa
- planned or preview posture: Amazon India, WooCommerce

Implementation status and launch stage are separate concerns. A connector can exist in code while still being treated as preview or early-access in the UI and documentation.

## Environment Tiers

- Local: can use local auth and fallback queue behavior
- Staging and production: require DB auth, BullMQ, queue worker enablement, valid CORS, production-safe email config, and commercial ops config
