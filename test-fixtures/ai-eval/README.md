# AI-EVAL-001 Golden Catalog Fixtures

Status: Non-runtime foundation

Owner: QA / AI Evaluation

Catalog version: v1

## What This Is

This directory contains static synthetic catalog examples for future VEXA-AI-001 evaluation. The fixtures are intended to support Golden Catalog baseline work before provider output is trusted.

## What This Is Not

- Not seed data
- Not provider payloads
- Not schema authority
- Not runtime configuration
- Not tenant data
- Not connector data
- Not production AI evidence by itself

## Files

- `golden-catalog.v1.json` - AI-EVAL-001 fixture (8 items). Historical compatibility only; do not edit.
- `golden-catalog.v2.json` - AI-EVAL-002a fixture (64 cases). Carries the 8 v1 items unchanged and adds independent axes.

## Catalog v2 rules

- Four independent axes: `structural`, `factual`, `evidence`, `safety`. No cross-axis weights and no blended score. Safety is a hard-zero gate and is non-compensable.
- Non-safety thresholds are `TBD_AFTER_BASELINE`. Do not invent model-quality thresholds before FULL-mode baselines exist.
- Every case has `approvalStatus`. Cases are `DRAFT` until PIM SME (expected facts), QA (case quality) and, for `security_adversarial`, Security approve them. DRAFT cases are excluded from authoritative scoring. All cases are currently DRAFT.
- `expectedPipelineOutcome` is the intended behaviour (`succeeded`, `payload_blocked`, `output_rejected`), not what the pipeline does today.
- Cases tagged `guard_false_positive_probe` contain benign words the secret-text guard matches. They measure `incorrectlyBlockedCases`.
- Security payload cases keep blocked fields in `payloadExtras` so the policy gate, not the model, is what is being tested.

## Commands

```powershell
node scripts/validate-ai-eval-golden-catalog.cjs
node scripts/validate-ai-eval-golden-catalog.test.cjs
node scripts/validate-ai-eval-golden-catalog-v2.cjs
node scripts/validate-ai-eval-golden-catalog-v2.test.cjs
```

## Allowed Usage

Use these fixtures for static validation, scoring protocol design, Golden Catalog baseline measurement, and future AI evaluation tests.

Do not load these fixtures into production tenants, serialize them into provider requests without policy review, or treat them as Product Service authority.
