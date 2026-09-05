# Vexa PIM Connector Index

Status: Canonical
Last reviewed: 2026-09-04

## Read This First

Connector documentation has drifted over time because the repo contains:

- implemented connector code
- launch-stage policy
- dated planning and review files

Use this page first to determine what is current.

## Source-Of-Truth Order

For connector behavior, trust these in order:

1. current code in `apps/api/src/connectors`, `apps/api/src/connector-framework`, and `apps/api/src/marketplace`
2. current web flows in `apps/web/src/app/connectors` and `apps/web/src/app/channels`
3. this index
4. focused setup or schema docs in this folder
5. older detailed connector guides only as supporting reference

## Current Repo-Truth Summary

Current connector implementations present in code:

| Connector | Slug | Implementation status | Launch-stage policy |
|---|---|---|---|
| Amazon India | `amazon-in` | implemented | `under_development` experimental preview |
| Flipkart | `flipkart` | implemented | `live` |
| Meesho | `meesho` | `partial` export-only | `manual` |
| Myntra | `myntra` | implemented | `live` |
| Nykaa | `nykaa` | partial/manual path | `manual` |
| Shopify | `shopify` | implemented | `live` |
| WooCommerce | `woocommerce` | code-complete | `blocker_closure` — no customer app-auth onboarding until P1-1 tenant-owned credential persistence and reads are reviewed, CI-verified, staged, and runtime-verified |

Important nuance:

- implementation status and launch stage are different
- a connector can exist in code while still being preview-only or not broadly surfaced as self-serve live

## Current Workspace Truth

- The marketplace channel shell currently centers on `amazon`, `flipkart`, `meesho`, and `shopify`
- The connector registry also supports additional connector slugs such as `myntra`, `nykaa`, and `woocommerce`
- `under_development` connectors are not production-publish commitments
- `code_complete` connectors can exist in code and be installable while still blocked from GA/public-sellable claims
- The canonical mapping UI path is `/channels/mappings`
- The legacy mapping route under `/connectors/[installationId]/mapping` redirects into `/channels/mappings`

## Current Connector-Specific Docs

- `amazon-india-setup-guide.md`
- `flipkart-setup-guide.md`
- `woocommerce-vexa-meta-schema.md`

## Historical Deep Reference Docs

These remain in the repo, but they are not canonical without revalidation:

- `VEXA_PIM_CONNECTOR_DEVELOPER_GUIDE.md`
- `VEXA_PIM_CONNECTOR_INTERNAL_IMPLEMENTATION_GUIDE.md`
- `VEXA_PIM_CONNECTOR_RECIPES.md`
- dated connector execution plans in this folder

Treat them as supporting material only.
