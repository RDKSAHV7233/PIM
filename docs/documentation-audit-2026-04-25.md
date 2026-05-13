# Documentation Audit Report

Status: Canonical audit record  
Review date: 2026-04-25  
Project: Vexa PIM

## Executive Summary

The repository contains 351 tracked files under `docs/` plus root and package README-style files. The codebase shows an implemented Next.js/NestJS PIM with catalog, quality, channels, connectors, media, operations, admin, auth, billing, signup, notifications, metrics, and platform tenant surfaces.

The primary documentation risk is too many overlapping documents with mixed dates, brands, generated evidence, execution snapshots, and imported historical material. Current canonical docs have been added at the root of `docs/` and should be treated as the product-facing documentation entry points.

No documentation files were deleted in this audit.

## Documentation Inventory

| Area | Count/Scope | Status |
|---|---:|---|
| Tracked files under `docs/` | 351 | Needs rationalization |
| Tracked documentation-like files overall | 362 | Includes root/package docs and unused archive docs |
| Tracked markdown files checked for relative links | 280 | No broken relative links found |
| Root README | 1 | Updated |
| Package README files | `packages/db/README.md` and package-local docs | Keep |
| Generated API docs | `docs/openapi.yaml`, `docs/openapi.json` | Keep generated |
| Connector docs | `docs/connectors/**` | Keep with targeted updates |
| Product/execution docs | `docs/product/**`, `docs/execution/**` | Keep canonical state; archive stale snapshots |
| Historical transfer/import docs | `docs/ports/**`, imported enterprise docs | Archive recommended |
| New canonical docs | 10 topic guides plus this audit | Keep |

## Second-Pass Review Findings

| Check | Result | Risk |
|---|---:|---|
| Broken relative markdown links | 0 | Low |
| Files with legacy/high-risk markers such as `Vexa PIM`, `PIM1`, `RabbitMQ`, old user-guide links, or placeholder wording | 169 | High until archive boundaries are enforced |
| Generated placeholder lines reading `Information not available in Vexa PIM project` | 374 | Medium; mostly in generated product/transfer guide fragments |
| Documentation-like files under `unused/` | 79 | Medium; should remain outside canonical docs |
| Historical transfer files under `docs/ports/` | 55 | High if users treat them as current implementation truth |

Current-facing files cleaned during the second pass:

- `docs/admin-setup-checklist.md`
- `docs/pim-user-guide.md`
- `docs/legal/data-retention-policy.md`
- `docs/legal/dpa.md`
- `docs/legal/privacy-policy.md`
- `docs/legal/terms-of-service.md`
- `docs/architecture/security-threat-model.md`
- `docs/strategy/VEXA_PIM_PRODUCT_TEST_STRATEGY.md`
- `packages/db/README.md`

## Codebase Evidence Used

| Evidence source | Findings |
|---|---|
| `apps/web/src/app/**` | Implemented routes include admin, catalog, channels, connectors, dashboard, operations, products, quality, rejection, settings, signup, and API proxy routes. |
| `apps/api/src/**/*.controller.ts` | Controllers cover auth, signup, catalog, taxonomy, compliance, issues, connectors, marketplace, submissions, media, bulk import/edit, billing, admin, dashboard, metrics, notifications, ONDC, rejection intelligence, and platform tenants. |
| `apps/api/src/common/env-validation.ts` | Staging/production require DB auth, BullMQ queue backend, queue worker enabled, CORS, commercial ops config, and production-safe email provider settings. |
| `.env.example` | Local setup documents PostgreSQL, Redis, R2, JWT, auth, feature flags, commercial ops, and connector credential variables. |
| `package.json` | Provides canonical scripts for dev, build, lint, tests, Prisma, auth bootstrap, OpenAPI, infrastructure, staging checks, and product QA gates. |
| `apps/api/src/connectors/**` | Amazon India, Flipkart, and Shopify are full publish connectors; Meesho is partial and does not implement direct publish. |

## Audit Report

| Document path | Purpose | Status | Issue summary | Severity | Evidence from codebase | Recommended action |
|---|---|---|---|---|---|---|
| `README.md` | Main repo entry | Keep | Needed concise current structure and canonical doc links. | High | Current scripts and env validation are defined in `package.json` and `env-validation.ts`. | Updated. |
| `docs/STRUCTURE.md` | Documentation map | Update | Did not include the new requested canonical topic docs. | Medium | New docs now exist at `docs/*.md`. | Updated. |
| `docs/getting-started.md` | First-run guide | Keep | Missing before audit. | High | Setup requires infra, Prisma, admin bootstrap, API, and web scripts. | Added. |
| `docs/installation.md` | Install/deployment basics | Keep | Missing before audit. | High | `.env.example`, scripts, and env validation define current install requirements. | Added. |
| `docs/configuration.md` | Env and feature flags | Keep | Missing before audit. | Critical | API startup rejects invalid staging/production auth, queue, CORS, email, and commercial config. | Added. |
| `docs/user-guide.md` | Operator workflows | Keep | Existing user guide material is spread across multiple docs. | High | Web routes and route-contract tests show current workflows. | Added as canonical; merge useful old guide content later. |
| `docs/admin-guide.md` | Admin workflows | Keep | Admin docs are spread across route evidence and execution files. | High | Admin controllers and web routes exist for users, API keys, webhooks, plan, privacy, audit, and connectors. | Added. |
| `docs/api.md` | API overview | Keep | OpenAPI exists but needed a human-readable endpoint family guide. | Medium | Controllers and OpenAPI scripts exist. | Added. |
| `docs/developer-guide.md` | Dev workflow | Keep | Scripts and validation commands were scattered. | Medium | Root `package.json` is the command source. | Added. |
| `docs/architecture.md` | System architecture | Keep | Older architecture docs may reference legacy names and dates. | High | Current repo is Next.js + NestJS + Prisma + queues + R2 + connectors. | Added. |
| `docs/troubleshooting.md` | Support guide | Keep | Missing central troubleshooting entry. | Medium | Common failures are enforced by env validation and scripts. | Added. |
| `docs/faq.md` | Common questions | Keep | Missing central FAQ. | Low | Common uncertainty exists around source of truth, connectors, and queues. | Added. |
| `docs/connectors/README.md` | Connector doc index | Update | Still references TEJ naming and older date; mostly useful but should use Vexa terminology. | Medium | Connector code uses current slugs and implementation statuses. | Update in a focused connector-doc pass. |
| `docs/connectors/VEXA_PIM_CONNECTOR_DEVELOPER_GUIDE.md` | Connector developer guide | Keep/update | Likely useful but brand and route claims need current verification. | High | Connector routes exist but capability status changed over time. | Keep as detailed connector doc; audit before release. |
| `docs/product/PRD.md` | Product source document | Keep | Important product reference but must not override code behavior. | Medium | README and connector index already use it as supporting product truth. | Keep; reconcile feature claims against code in future pass. |
| `docs/execution/CURRENT_STATE.md` | Runtime/project state | Keep | Useful, but date-based execution state ages quickly. | Medium | Current implementation must be verified by routes/tests. | Keep with review date discipline. |
| `docs/execution/INCREMENT_STATE.json` | Increment state machine | Keep | Useful release state artifact. | Medium | Referenced by existing docs and release process. | Keep. |
| `docs/openapi.yaml`, `docs/openapi.json` | Generated API contract | Keep generated | Must not be hand-edited. | High | `npm run openapi:check` regenerates and diffs these files. | Keep generated; update only through script. |
| `docs/product/user-guide/**` | Detailed product/user guide fragments | Merge | Overlaps with canonical user guide and may contain stale route names. | Medium | Current route truth is `apps/web/src/app`. | Preserve useful detail into `docs/user-guide.md`; archive older fragments after review. |
| `docs/ports/**` | Transfer/import historical docs | Archive | Historical transfer evidence is not current product documentation. | High | Current app/API routes and scripts are elsewhere. | Move to `docs/archive/ports/` in a cleanup task. |
| Imported enterprise/strategy documents | Planning reference | Archive | Not reliable as implementation documentation. | Medium | Code and tests define current behavior. | Archive with provenance notes. |
| Date-stamped execution/gate/evidence docs | Release evidence | Archive selectively | Valuable evidence but clutters current-doc discovery. | Medium | Current release checks live in scripts and tests. | Keep latest state docs; archive superseded snapshots. |

## Duplicate And Overlapping Documentation

| Canonical document to keep | Merge candidates | Archive/delete recommendation | Reason |
|---|---|---|---|
| `docs/user-guide.md` | `docs/pim-user-guide.md`, `docs/product/user-guide/**` | Archive merged fragments after content review | One operator guide should own day-to-day workflows. |
| `docs/admin-guide.md` | admin checklist and admin route evidence notes | Archive stale checklist copies after preserving setup steps | Admin behavior is implemented across current admin routes and APIs. |
| `docs/configuration.md` | environment/deployment fragments in execution docs | Archive old environment notes after preserving live vars | `env-validation.ts` and `.env.example` are authoritative. |
| `docs/api.md` | handwritten endpoint notes | Keep generated OpenAPI; archive conflicting manual endpoint lists | API controllers and generated OpenAPI own the contract. |
| `docs/developer-guide.md` | scattered setup/test command notes | Archive stale command references | `package.json` is the script source of truth. |
| `docs/architecture.md` | older architecture/strategy imports | Archive old branded/dated architecture docs | Current architecture should describe implemented app/API/db/queue/media surfaces. |

## Documents To Keep

- `README.md`
- `docs/STRUCTURE.md`
- `docs/getting-started.md`
- `docs/installation.md`
- `docs/configuration.md`
- `docs/user-guide.md`
- `docs/admin-guide.md`
- `docs/api.md`
- `docs/developer-guide.md`
- `docs/architecture.md`
- `docs/troubleshooting.md`
- `docs/faq.md`
- `docs/documentation-audit-2026-04-25.md`
- `docs/openapi.yaml`
- `docs/openapi.json`
- `docs/product/PRD.md`
- `docs/execution/CURRENT_STATE.md`
- `docs/execution/INCREMENT_STATE.json`
- `docs/connectors/README.md` and connector detailed guides, after focused brand/current-state cleanup

## Documents To Update

- `docs/STRUCTURE.md`
- `docs/connectors/README.md`
- Connector detailed guides under `docs/connectors/**`
- Existing product/user-guide fragments after extracting unique workflow details into `docs/user-guide.md`
- Existing admin/setup/checklist docs after extracting unique setup details into `docs/admin-guide.md` or `docs/installation.md`

## Documents To Merge

- Merge user workflow fragments into `docs/user-guide.md`.
- Merge setup and local-development fragments into `docs/getting-started.md` and `docs/installation.md`.
- Merge env/configuration fragments into `docs/configuration.md`.
- Merge admin workflow fragments into `docs/admin-guide.md`.
- Merge endpoint summaries into `docs/api.md` only when they match generated OpenAPI.

## Recommended For Archive Or Deletion

Do not delete these immediately. Archive first, then delete only after owners confirm no unique content remains:

- `docs/ports/**`: historical transfer content.
- Superseded date-stamped execution evidence snapshots except the current state files.
- Imported enterprise/strategy documents that do not map to implemented routes, APIs, or scripts.
- Duplicate generated page/playbook fragments after their unique instructions are merged into canonical docs.

## Final Recommended Documentation Structure

```text
README.md
docs/getting-started.md
docs/installation.md
docs/configuration.md
docs/user-guide.md
docs/admin-guide.md
docs/api.md
docs/developer-guide.md
docs/architecture.md
docs/troubleshooting.md
docs/faq.md
docs/documentation-audit-2026-04-25.md
docs/openapi.yaml
docs/openapi.json
docs/connectors/
docs/product/
docs/execution/
docs/archive/
```

## Remaining Uncertainties

- Some older documents use TEJ naming while the current product name is Vexa PIM.
- Some connector documents may still describe planned behavior; each claim should be checked against `apps/api/src/connectors`, connector framework services, and marketplace tests.
- User role behavior should be verified against guards and route tests before expanding role documentation.
- Public marketplace behavior can change; external connector documentation should be web-verified during marketplace-specific release reviews.

## Follow-Up Tasks

1. Update `docs/connectors/README.md` and detailed connector guides to use Vexa naming and current connector statuses.
2. Review `docs/product/user-guide/**` and merge unique current workflow detail into `docs/user-guide.md`.
3. Move historical transfer/import docs into `docs/archive/` in a dedicated cleanup commit.
4. Run a link checker after archive moves.
5. Add a lightweight docs freshness check to release review: root README, canonical docs, OpenAPI, connector docs, and current state.
