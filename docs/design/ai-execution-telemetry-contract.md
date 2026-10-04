# AI-CORE-002 Execution Telemetry Contract

Status: Sprint 2 candidate design artifact. Blocked from runtime implementation until Gate A passes.

Owner: Backend / Data-FinOps

Related issue: #1122

## Boundary

This document defines the minimum `AiExecution` telemetry contract before persistence or provider integration work begins.

This first artifact is non-runtime:

- no application code changes
- no schema migration
- no provider dependency
- no production configuration
- no provider call path

## Invariant

Every future provider execution must have an `AiExecution` record before the provider call starts.

When the provider call does not execute because a kill switch, validation failure, tenant policy, or budget limit blocks it, the execution record must still explain why no provider cost exists.

## Required Identity Fields

- `tenant`
- `tenantKey`
- `capability`
- `entityType`
- `entityId`
- `sourceRecordId`
- `sourceVersion`
- `sourceHash`
- `requestFingerprint`
- `promptVersion`
- `schemaVersion`
- `idempotencyFingerprint`

The idempotency fingerprint is derived from:

```text
tenantKey + capability + entityType + entityId + sourceVersion + sourceHash + requestFingerprint + promptVersion + schemaVersion
```

## Required Lifecycle States

- `queued`
- `validating`
- `blocked`
- `running`
- `succeeded`
- `failed`
- `timed_out`
- `budget_blocked`
- `provider_disabled`
- `cancelled`

## Required Usage And Cost Fields

- `providerKey`
- `providerDisplayName`
- `modelKey`
- `providerRegion`
- `startedAt`
- `finishedAt`
- `durationMs`
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `estimatedCostMicros`
- `currency`
- `costSource`

`estimatedCostMicros` must be present for every completed provider execution. Blocked-before-call records must use `estimatedCostMicros = 0`, zero provider tokens, `providerCallAttempted = false`, and a safe failure class explaining why no call executed.

## Forbidden Fields

`AiExecution` must not store:

- provider API keys
- OAuth tokens
- request/response bodies containing raw product text
- credentials
- secrets
- raw cross-tenant payloads

Provider/model fields must be identifiers only. They must never contain API keys, bearer tokens, OAuth tokens, private keys, webhook secrets, credentials, raw prompts, or raw provider responses.

## Reporting Requirements

Data/FinOps must be able to group executions by:

- tenantKey
- capability
- providerKey
- modelKey
- status
- date bucket

## Verification

Run:

```powershell
node --check scripts/validate-ai-core-execution-telemetry.cjs
node --check scripts/validate-ai-core-execution-telemetry.test.cjs
node scripts/validate-ai-core-execution-telemetry.test.cjs
node scripts/validate-ai-core-execution-telemetry.cjs
git status --short -- apps packages prisma .github docs/openapi.yaml docs/openapi.json docs/vexa-pim.postman_collection.json package.json
```
