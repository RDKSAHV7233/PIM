# User Guide

Status: Canonical
Last reviewed: 2026-06-15

## Workspace Areas

The implemented web app is organized around these route groups:

- Auth and public: `/login`, `/login/reset`, `/login/locked`, `/login/mfa`, `/login/enroll`, `/signup`, `/signup/verify`, `/consent`, `/account-suspended`
- Core workspace: `/dashboard`, `/search`, `/notifications`
- Catalog: `/catalog/products`, `/catalog/categories`, `/catalog/attributes`, `/catalog/media`, `/products/[id]`
- Quality: `/quality`, `/quality/issues`, `/quality/validation`, `/quality/completeness`, `/quality/approvals`, `/rejection`
- Channels: `/channels`, `/channels/connectors/*`, `/channels/health`, `/channels/mappings`, `/channels/submissions*`
- Legacy connector routes: `/connectors`, `/connectors/setup`, `/connectors/[installationId]/mapping`
- Operations: `/operations`, `/operations/imports`, `/operations/bulk-edit`, `/operations/jobs`, `/operations/repair`
- Admin and settings: `/admin/*`, `/settings*`
- Internal and experimental: `/ai`, `/internal/developer`, `/ondc`, `/media`

Current route inventory from source: `69` `page.tsx` routes.

## Login

Human users sign in at `/login` with:

- `Workspace`
- `User ID`
- `Password`

Public signup exists in code but is feature-flagged. Some environments will not expose `/signup`.

## Roles In Code

App roles:

- `admin`
- `editor`
- `publisher`
- `approver`
- `channel_manager`
- `connector_admin`
- `reviewer`
- `viewer`

Important note:

- customer-facing invite and shell flows are simpler than the full RBAC model
- some specialist roles exist in the API and seeded/test environments even when they are not the default UI invite path

## Main Product Workflow

1. Create or import products.
2. Complete category, attributes, variants, pricing, and tax fields.
3. Review quality, completeness, and approval state.
4. Attach or validate media.
5. Configure channel mappings and connector setup.
6. Submit, publish, or export where the connector capability allows it.
7. Monitor submissions, jobs, and recovery flows.

## Product Detail

`/products/[id]` is the product detail workbench. Current tabs are driven by the `tab` query value and include:

- overview
- content
- attributes
- variants
- media
- pricing
- relationships
- quality
- channels
- activity

## Redirects And Legacy Paths

Current redirect-style behavior in code includes:

- `/` routes by tab/query into the main workspace
- `/catalog` redirects to `/catalog/products`
- `/reports` redirects to `/dashboard`
- `/products` redirects to `/catalog/products`
- `/settings/plan` redirects to `/admin/plan`
- `/settings/connectors` redirects to `/admin/connectors`
- `/settings/privacy` redirects to `/admin/privacy`
- `/connectors/[installationId]/mapping` resolves installation context and then redirects to `/channels/mappings`

## Connectors

There are three separate truths to keep straight:

1. Connector implementation in API code
2. Launch stage and UI surfacing policy
3. What is safe to present as live in normal customer flows

Current repo-truth summary:

| Connector | Slug | Implementation | Launch stage policy |
|---|---|---|---|
| Amazon India | `amazon-in` | implemented | `planned` / experimental preview |
| Flipkart | `flipkart` | implemented | live |
| Meesho | `meesho` | partial export-only | manual |
| Myntra | `myntra` | implemented | live |
| Nykaa | `nykaa` | partial/manual export path | manual |
| Shopify | `shopify` | implemented | live |
| WooCommerce | `woocommerce` | partial implementation | planned / early-access posture |

The `Channels` workspace shell currently centers on the marketplace channel set `amazon`, `flipkart`, `meesho`, and `shopify`, while the connector registry also supports additional connector slugs.

## Operations

Operations pages cover imports, jobs, bulk edit, and repair.

Current large-import boundary in code and docs:

- standard mode: up to `10,000` rows
- large mode: `10,001` to `30,000` rows
- over `30,000` rows: not supported

## Internal And Experimental Surfaces

- `/ai` is admin-only, non-production, and blocks `TRIAL` and `STARTER`
- `/ondc` is admin-only, non-production, and requires `FEATURE_ONDC_ENABLED=true`
- `/internal/developer` is non-production only and requires the `admin` app role plus one of `product_admin`, `system_admin`, or `super_admin`
- `/media` is an authenticated route and is also linked from internal workflows
