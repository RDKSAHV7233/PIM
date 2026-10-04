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

- `golden-catalog.v1.json` - versioned synthetic evaluation fixture

## Commands

```powershell
node scripts/validate-ai-eval-golden-catalog.cjs
node scripts/validate-ai-eval-golden-catalog.test.cjs
```

## Allowed Usage

Use these fixtures for static validation, scoring protocol design, Golden Catalog baseline measurement, and future AI evaluation tests.

Do not load these fixtures into production tenants, serialize them into provider requests without policy review, or treat them as Product Service authority.
