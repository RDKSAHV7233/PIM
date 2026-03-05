# Phase 2 Implementation (Compliance and Attribute Intelligence)

## Scope Implemented
- Dynamic attribute engine with category-bound attribute definitions.
- Product-level GST and HSN fields added to canonical product model.
- Compliance rule engine with severity-aware rule evaluation.
- Validation issue persistence and retrieval for operator workflows.
- Validation run on product save/update and via explicit validate endpoint.
- Web UI support for:
  - Creating category attribute definitions.
  - Capturing GST/HSN and attributes on product creation.
  - Viewing open validation issues on product details.
  - Triggering re-validation from UI.

## Stack Used
- Frontend: Next.js 15 App Router + TypeScript + Tailwind.
- Backend: NestJS + Fastify + TypeScript.
- Database: PostgreSQL + Prisma + JSON/JSONB-compatible fields.

## Data Model Additions
- `Product`: `hsnCode`, `gstRate`, `attributes`.
- `AttributeDefinition`: category-scoped dynamic attributes.
- `ComplianceRule`: reusable regulatory/compliance checks.
- `ValidationIssue`: persisted validation outcomes.
- Enums:
  - `AttributeDataType`
  - `AppliesTo`
  - `RuleSeverity`
  - `RuleType`
  - `ValidationIssueStatus`

## API Surface Added
- Taxonomy:
  - `GET /api/taxonomy/categories/:id/attributes`
  - `POST /api/taxonomy/categories/:id/attributes`
  - `PATCH /api/taxonomy/attributes/:id`
  - `DELETE /api/taxonomy/attributes/:id`
- Compliance:
  - `GET /api/compliance/rules`
  - `POST /api/compliance/rules`
  - `PATCH /api/compliance/rules/:id`
  - `DELETE /api/compliance/rules/:id`
  - `POST /api/compliance/products/:id/validate`
  - `GET /api/compliance/products/:id/issues`

## Validation Logic Delivered
- GST/HSN baseline checks:
  - Missing HSN and GST detection.
  - HSN format check for 4/6/8 digit pattern.
  - Uncommon GST rate warning for out-of-band rates.
- Dynamic attribute checks:
  - Required attribute enforcement by category.
  - Attribute data type checks.
  - Allowed-value checks.
- Configurable compliance rule checks:
  - `required_field`
  - `regex_field`
  - `value_in_set`

## Verification Run
- `python tools/phase0/check_phase0.py` -> GO.
- `npm run lint --workspace @pim1/api` -> pass.
- `npm run lint --workspace @pim1/web` -> pass.
- `npm run build --workspace @pim1/api` -> pass.
- `npm run build --workspace @pim1/web` -> pass.
- `tools/phase1/smoke-test.ps1` -> pass (3/3 consecutive).
- `tools/phase2/smoke-test.ps1` -> pass (3/3 consecutive).

## Operational Hardening Applied
- Smoke tests now run API on randomized ports to avoid collisions.
- Smoke tests capture API stdout/stderr and report logs on startup failure.
- Health-check wait upgraded to fail fast if process exits early.

## Exit Criteria Status (Phase 2)
- Compliance validation works: met.
- Category-based attributes dynamic: met.
- GST/HSN errors detectable: met.
