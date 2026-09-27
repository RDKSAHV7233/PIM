# ADR-001 — Vexa Observability Authority

**Status:** ACCEPTED  
**Date:** 2026-09-27  
**Decided by:** CTO / Architecture  
**Team approvals:** Backend ✅ · SRE ✅ · Security ✅ · QA ✅

---

## Context

Issue #920 exposed that the API had no automatic error ingestion, while a capable
`Error Authority` system already existed in Vexa (issue grouping, occurrences,
sanitized tenant/actor context, admin investigation UI, stack traces, release and
environment correlation). The original plan to close #920 by wiring Sentry was
superseded by this discovery.

---

## Decision

**Vexa Error Authority is the canonical application-error authority for all Vexa
runtimes.** External observability vendors (Sentry, Datadog, New Relic, etc.) are
optional sinks only.

> External integration ≠ system authority.
>
> Failure, absence, outage, or removal of an external observability provider must
> not reduce Vexa's ability to operate, diagnose, or recover the platform.

---

## Architecture

```
Application Runtime
   │
   ├── API              (global exception filter → ErrorCaptureService)
   ├── Web / Next.js    (instrumentation.ts → /error-authority/ingest/next-server)
   ├── Browser          (BrowserErrorCapture → /error-authority/ingest/browser)
   ├── Workers          (worker error classifier → ErrorCaptureService)
   └── [future: webhooks, connector jobs, AI jobs]
          │
          ▼
     Vexa Error Authority (observability-db)
          │
          ├── error_issues       (fingerprint-grouped)
          ├── error_occurrences  (one per event)
          ├── Severity: p0–p3
          ├── Sanitized context  (safe_tenant_ref, safe_actor_ref, safe_message)
          ├── Release + environment correlation
          └── Recovery/state (open → acknowledged → resolved)
                 │
                 ├── /internal/ops/errors     (investigation UI)
                 └── InternalOpsAlertsService (P0/P1 proactive signal)
```

---

## Failure Hierarchy

```
PRIMARY:   Error Authority persistence (observability-db)
    ↓ failure
FALLBACK:  Structured application log (LoggerService)
    ↓
RECOVERY:  Operator diagnoses persistence outage from logs
```

The global exception filter MUST implement this as:

```typescript
void captureUnexpected({...}).catch((err) => {
  logger?.warn("Error Authority capture boundary failed open.", {...});
});
super.catch(exception, host); // response always sent
```

Capture failure must never become a new production failure source.

---

## PII / Safety Invariants

The filter must never forward:
- `Authorization` / `Cookie` / `Set-Cookie` headers
- Raw request body
- Connector credentials, API keys, passwords, tokens
- Raw tenant identifiers

All tenant and actor identifiers are hashed/redacted by `ErrorCaptureService`
via `normalizeErrorEvent` before persistence.

---

## Scope of This Decision

**In scope (required):**
- API global exception filter → `ErrorCaptureService` (done: PR #972 + this PR)
- Web Next.js server errors (existing, done)
- Browser errors (existing, done)

**Deferred (separate issues):**
- Worker / queue job error ingestion
- Webhook and connector job error ingestion
- `/internal/ops/alerts` UI for proactive P0/P1 incident surfacing
- Internal trace model / correlation ID propagation across services

**Explicitly out of scope:**
- Sentry DSN provisioning
- External OTel collector
- Slack/email alert adapters (may be added as optional sinks later)

---

## Consequences

- Vexa operates and diagnoses production failures without any external dependency.
- The `SENTRY_DSN` env var and Sentry SDK remain in code as an optional,
  zero-overhead no-op when unset. No removal required.
- `#920` closes when API error ingestion is verified end-to-end in production.
- A follow-up issue should be created for `/internal/ops/alerts` UI and
  P0/P1 proactive notification if the dashboard-pull model is insufficient.
