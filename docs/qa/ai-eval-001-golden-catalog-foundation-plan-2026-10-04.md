# AI-EVAL-001 Golden Catalog Foundation Plan

Status: Draft for QA/AI Evaluation owner approval

Scope: Non-runtime static evaluation foundation for VEXA-AI-001

## Goal

Create a versioned Golden Catalog fixture set for future AI evaluation without adding schema, provider, API, database, UI, connector, or model runtime behavior.

The fixture set exists to separate technical validity from semantic quality before any model output is trusted. It supports future measurement of schema validity, evidence coverage, factual precision, correction rate, and safety policy outcomes.

## Explicit Non-Goals

- No Prisma or schema changes
- No provider or model SDK integration
- No API route or application runtime read path
- No seeding into tenants
- No OpenAPI or Postman changes
- No production AI claim
- No generated suggestion persistence
- No canonical Product Service mutation

## Fixture Principles

- Synthetic, deterministic, non-customer data only
- Channel-neutral product facts
- Evaluation targets are facts and rubrics, not model outputs
- Stable IDs, versioned catalog, unique SKUs
- Edge cases cover completeness, ambiguity, safety, Unicode, long text, and missing data
- Provenance and "no source, no fact" expectations are explicit
- Fixture data must not contain provider, tenant, connector, endpoint, model, or database binding keys

## Acceptance Criteria

- Fixture validates with a static script
- All fixture IDs and SKUs are unique
- Evaluation axis weights sum to 100
- Runtime/provider binding keys are rejected anywhere in the fixture
- Every item includes input, expected facts, allowed inferences, disallowed claims, and quality signals
- README documents ownership and allowed usage
- PR touches only docs, test fixtures, and static validation scripts

## Initial Coverage

The v1 fixture starts with eight synthetic products:

| ID | Scenario | Purpose |
| --- | --- | --- |
| AI-GC-APP-001 | complete_apparel_product | Baseline complete product facts |
| AI-GC-APP-002 | variant_rich_apparel | Size/color variant extraction |
| AI-GC-HOME-001 | missing_material_and_dimensions | Missing-data handling |
| AI-GC-ELEC-001 | ambiguous_category | Category ambiguity without overclaiming |
| AI-GC-BOOK-001 | unicode_rtl_title | Unicode and multilingual text handling |
| AI-GC-BEAUTY-001 | long_description_noise | Long text with real and irrelevant facts |
| AI-GC-HEALTH-001 | unsafe_claim_guard | Safety claim rejection |
| AI-GC-TOOLS-001 | no_source_hallucination_guard | No-source hallucination guard |

## Owner Review Checklist

- QA confirms fixture scenarios are representative enough for a first baseline.
- PIM SME confirms expected facts are product-domain appropriate.
- Security confirms no runtime/provider binding keys are present.
- PO confirms the fixture supports AI-001 only and does not imply Supplier, Channel, Copilot, or Agent scope.

## Verification

Run:

```powershell
node --check scripts/validate-ai-eval-golden-catalog.cjs
node --check scripts/validate-ai-eval-golden-catalog.test.cjs
node scripts/validate-ai-eval-golden-catalog.test.cjs
node scripts/validate-ai-eval-golden-catalog.cjs
git diff --name-only -- apps packages prisma .github docs/openapi.yaml docs/openapi.json docs/vexa-pim.postman_collection.json
```

The final command should produce no output.
