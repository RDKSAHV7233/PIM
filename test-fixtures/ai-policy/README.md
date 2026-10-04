# AI-POL-001 Provider Payload Policy Fixtures

Status: Non-runtime foundation

Owner: Privacy / Security / Backend

Policy version: v1

## What This Is

This directory contains the static AI-001 data classification contract for future provider payload construction.

## What This Is Not

- Not tenant configuration
- Not persisted `AiTenantPolicy`
- Not runtime provider execution
- Not seed data
- Not Product Service authority

## Files

- `provider-payload-policy.v1.json` - v1 field classification and payload examples

## Commands

```powershell
node scripts/validate-ai-pol-provider-payload-policy.cjs
node scripts/validate-ai-pol-provider-payload-policy.test.cjs
```

## Classification Semantics

- `AI_ALLOWED`: may be included in a future provider payload when capability policy permits it.
- `AI_ALLOWED_WITH_REDACTION`: may be included only after transformation and with redaction evidence.
- `AI_BLOCKED`: must not be serialized into provider payloads.
