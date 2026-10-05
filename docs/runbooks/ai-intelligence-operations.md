# VEXA-AI-001 Intelligence Operations Runbook

Status: Draft SRE foundation for AI-SRE-001

Scope: Non-runtime operational contract for VEXA-AI-001

## Core Rule

Provider or Intelligence failures must degrade Intelligence only. Core Vexa PIM must remain available.

```text
AI proposes. Vexa validates. People approve. Product Service mutates.
```

## Kill Switch

The AI kill switch must disable provider execution and new AI job admission without blocking core catalog, approval, validation, import, export, authentication, billing, audit, or existing non-AI jobs.

Required operator behavior:

- Switch state is visible to SRE, Backend, Security, and Support.
- New provider executions are rejected before any provider call.
- Existing in-flight provider work is cancelled or allowed to time out based on the job contract.
- Reviewers can still view existing suggestions and audit evidence.
- Core PIM health checks remain green unless there is an unrelated platform incident.

### Platform control row (AI-PROV-004b-i)

The fast, platform-wide kill switch is the single row `ai_platform_controls` (`id = 'global'`). It is read on every call, at admission and again immediately before dispatch, and an unreadable or missing row denies. It does not need a deploy and does not restart the API.

```sql
-- Stop all provider execution now (idempotent).
UPDATE ai_platform_controls SET kill_switch = true, updated_by = '<operator>', updated_at = NOW() WHERE id = 'global';
```

The seeded state is disabled with the kill switch on, no provider, no model, no allow-listed tenant and a zero request cap. Enabling is a gated change recorded per the AI-PROV-004b design (sections 11 and 12), not a routine operation. The deploy flag `FEATURE_INTELLIGENCE_PROVIDER_ENABLED` is a second, deploy-time gate that is on only for the exact value `true`. See `docs/qa/ai-prov-004b-i-lifecycle-2026-10-05.md`.

## Queue Behavior

Future AI jobs must define:

- Deterministic idempotency key
- Retry policy
- Timeout policy
- Cancellation behavior
- Dead-letter behavior
- Budget/cost guard behavior
- Tenant isolation expectations

The first approved idempotency fingerprint is:

```text
tenant + product + sourceVersion + capability + promptVersion + schemaVersion
```

Retries must reuse the same fingerprint. A retry must not create duplicate suggestion sets unless an explicit operator/product action requests regeneration.

## Provider Outage Behavior

During provider outage:

- Provider execution fails closed.
- New Intelligence generation is unavailable or queued according to policy.
- Existing PIM workflows continue.
- Existing approved Product Service mutations continue only when they do not require provider execution.
- Operator-facing status names the Intelligence degradation.
- Cost capture records no provider cost for calls that did not execute.

## Verification

```powershell
node --check scripts/validate-ai-sre-operations-contract.cjs
node --check scripts/validate-ai-sre-operations-contract.test.cjs
node scripts/validate-ai-sre-operations-contract.test.cjs
node scripts/validate-ai-sre-operations-contract.cjs
git diff --name-only -- apps packages prisma .github docs/openapi.yaml docs/openapi.json docs/vexa-pim.postman_collection.json
```

The final scope command should produce no output.
