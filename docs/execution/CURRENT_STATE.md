# Vexa PIM Current State

Last reviewed: 2026-06-15

This file is the stable current-state summary. It replaces the older additive "Vx addendum" style status notes as the main documentation entry point.

## Code-Truth Snapshot

- Web route inventory: `69` `page.tsx` routes under `apps/web/src/app`
- Primary route groups: auth/public, dashboard, catalog, quality, channels, operations, admin, settings, media, product detail, and internal/experimental surfaces
- App roles: `admin`, `editor`, `publisher`, `approver`, `channel_manager`, `connector_admin`, `reviewer`, and `viewer`
- Admin boundary roles: `product_admin`, `system_admin`, and `super_admin`
- QA dataset scripts: core seed, ops seed, control-plane opt-in seed, cleanup, and isolation tests all exist in root `package.json`

## Current Route Reality

Current page routes include:

- public/auth: `/login*`, `/signup*`, `/consent`, `/account-suspended`
- workspace: `/dashboard`, `/search`, `/notifications`
- catalog: `/catalog/*`, `/products/[id]`
- quality: `/quality*`, `/rejection`
- channels: `/channels*`, `/connectors*`
- operations: `/operations*`
- admin/settings: `/admin*`, `/settings*`
- internal or experimental: `/ai`, `/internal/developer`, `/ondc`, `/media`

Current redirect-style paths include:

- `/`
- `/catalog`
- `/reports`
- `/products`
- `/settings/plan`
- `/settings/connectors`
- `/settings/privacy`
- `/connectors/[installationId]/mapping`

## Current Connector Reality

Connectors present in code:

- `amazon-in`
- `flipkart`
- `meesho`
- `myntra`
- `nykaa`
- `shopify`
- `woocommerce`

Important launch-stage distinctions:

- live: Flipkart, Shopify, Myntra
- manual: Meesho, Nykaa
- planned or preview posture: Amazon India, WooCommerce

Marketplace channel routing currently centers on:

- `amazon`
- `flipkart`
- `meesho`
- `shopify`

## Current Feature-Gate Reality

- Public signup is feature-flagged.
- `/ai` is admin-only, non-production, and blocks `TRIAL` and `STARTER`.
- `/ondc` is admin-only, non-production, and requires `FEATURE_ONDC_ENABLED=true`.
- `/admin/commercial` requires admin app role, system-level boundary access, and a configured commercial ops token.

## Documentation Rule

If a dated execution note, review memo, or signoff document disagrees with code:

1. trust code
2. update the canonical docs
3. leave the dated file as historical evidence unless there is a clear reason to delete it
