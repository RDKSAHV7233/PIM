# Vexa PIM Controlled Release Checklist

- Source: `docs/product/PRD.md` (sections 12, 13, 15)
- Execution source of truth: `docs/execution/INCREMENT_STATE.json`
- Purpose: Explicit launch blockers and promotion criteria for controlled and broad rollout.
- Last updated: 2026-05-01

## 1. Blockers (Must Be Closed Before Broad Rollout)

### Security Blockers
1. Tenant isolation tests pass with zero cross-tenant leakage under concurrent load.
2. JWT revocation (`jti` blocklist) enforced and validated by integration tests.
3. Connector credentials are encrypted at rest and key-rotation dry-run is proven on staging.
4. Unsafe raw SQL guard (`guard:unsafe-raw`) passes in CI.

### Operations Blockers
1. Staging gate runner passes (`npm run gate:run:increment`) with artifacted run URL.
2. Queue backpressure/circuit breaker behavior verified for connector submission lane.
3. Health endpoint reports DB pool and queue depth.
4. Payload governance enforcement (`governance:enforce`) tested with retention/redaction evidence.

### Compliance Blockers
1. Consent capture, account export, account deletion, and privacy status APIs are active and tested.
2. Test data is hidden by default in seller flows and purge process is documented.
3. Rejection messaging remains seller-readable (no raw channel error codes).
4. Audit records exclude secret/token payload values.

## 2. Controlled Rollout Criteria

Controlled rollout targets a limited tenant set (internal + pilot sellers), with rollback readiness.

1. All E1-E9 stories are complete with execution evidence.
2. E10 gate automation (`ST-QA-001`) and metrics instrumentation (`ST-QA-002`) are complete.
3. Last two consecutive staging gate runs pass with no flaky failures.
4. KPI trends endpoint shows non-empty series for:
   - readiness accuracy,
   - throughput,
   - rejection rate,
   - reliability duplicate prevention rate.
5. At least one pilot tenant completes end-to-end flow:
   - create/import product,
   - pass readiness checks,
   - queue connector submission/export,
   - resolve rejection using repair workflow.

## 3. Broad Rollout Criteria

Broad rollout is allowed only after controlled rollout stays stable through a full observation window.

1. Controlled rollout remains stable for 14 consecutive days.
2. No Sev-1 security incident and no unresolved Sev-2 tenant isolation incident.
3. Duplicate submission prevention remains effective (no duplicate external submissions in trend window).
4. Rejection-rate trend is stable or improving for active connectors.
5. Operational SLOs are met:
   - health endpoint availability >= 99.9%,
   - no sustained queue backlog growth,
   - gate suite pass rate >= 95% over last 20 runs.

## 4. Rollback Trigger Conditions

Any trigger below moves release status back to controlled mode until mitigated:

1. Tenant isolation failure in integration or production telemetry.
2. Repeated connector submission duplication due to idempotency regression.
3. Credential handling regression (decryption/rotation failures).
4. Sustained queue failure spikes with dead-letter growth and no recovery.

## 5. Current Status Snapshot (2026-05-01)

### Completed now
1. Historical E10 gate runs have recorded consecutive pass artifacts (`RUN1` through `RUN5`) with staging-format metadata.
2. Staging signoff artifacts are recorded with required shape (`environment`, `tenantId`, `date`, `gitTag`, `runUrl`).
3. Pilot tenant end-to-end workflow: completed (import, dead-letter, repair, bulk edit).
4. Payload governance enforcement executed with policy evidence artifact (90-day redaction, 365-day purge).
5. Daily rollout snapshot automation is available via `npm run rollout:snapshot` (artifacts under `docs/execution/rollout/`).
6. Web production build now enforces real type/lint gate behavior; Next.js ignore-bypass settings are removed.

### Remaining for controlled rollout
1. No remaining controlled-rollout blockers in the latest checked-in snapshot.

### Remaining for broad rollout
1. The latest live rollout snapshot still reports `Controlled rollout observation window covers 13 of 14 required days.`
