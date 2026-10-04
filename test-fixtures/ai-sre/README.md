# AI-SRE-001 Intelligence Operations Fixtures

Status: Non-runtime foundation

Owner: SRE / Backend / Data-FinOps

Contract version: v1

## What This Is

This directory contains the static operational contract for VEXA-AI-001 kill switch, queue behavior, idempotency, timeout, cancellation, DLQ, and provider outage degradation.

## What This Is Not

- Not a queue worker
- Not provider execution code
- Not feature-flag runtime configuration
- Not tenant policy persistence
- Not a Product Service mutation path

## Files

- `operations-contract.v1.json` - versioned operational contract fixture

## Commands

```powershell
node scripts/validate-ai-sre-operations-contract.cjs
node scripts/validate-ai-sre-operations-contract.test.cjs
```
