# ADR-002: Observability Stack — Error Tracking, APM, and Metrics

**Status:** Accepted  
**Date:** 2026-05-04  
**Deciders:** Platform Engineering

---

## Context

Vexa PIM is a multi-tenant SaaS API. Before general availability we need:

1. **Error tracking** — real-time alerting when unhandled exceptions reach production
2. **Distributed tracing / APM** — end-to-end request traces for latency investigations
3. **Infrastructure metrics** — Prometheus-format counters/gauges for Grafana dashboards and SLO burn-rate alerting

The team evaluated three lightweight options with no mandatory on-premise infrastructure.

---

## Decision

### Error tracking → Sentry

- **DSN** supplied via `SENTRY_DSN` environment variable (absent = SDK never loads)
- Loaded at startup via dynamic `import("@sentry/node")` so the binary has zero overhead when the DSN is unset
- `tracesSampleRate` is `0.1` in production to cap ingestion cost; `1.0` in staging/development
- `APP_ENV` is forwarded as the Sentry environment tag so alerts link to the correct deployment

### Distributed tracing → OpenTelemetry (OTLP)

- Exporter endpoint supplied via `OTEL_EXPORTER_OTLP_ENDPOINT` (absent = no spans exported)
- Vendor-agnostic: Grafana Tempo, Honeycomb, or any OTLP-compatible collector accepted without code changes
- When the endpoint is set in staging, route OTLP traffic through the collector sidecar; in development the variable is left unset

### In-process Prometheus metrics → `ObservabilityService`

- Zero-dependency in-memory counter/gauge/histogram store in `apps/api/src/common/observability/observability.service.ts`
- Exposed at `GET /api/v1/health/metrics` (admin-only, Prometheus text format, content-type `text/plain; version=0.0.4`)
- Metrics tracked out of the box:
  - `pim_api_requests_total` (counter)
  - `pim_api_errors_total` (counter)
  - `pim_queue_jobs_enqueued_total`, `_completed_total`, `_failed_total` (counters)
  - `pim_process_uptime_seconds` (gauge)
  - `pim_api_request_duration_ms` (histogram, buckets 10–5000 ms)
- Grafana Cloud scrapes `/health/metrics` via the remote-write agent; no Prometheus server required on the host

---

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| Datadog APM | Agent licence cost not yet budgeted; OTLP export to Datadog is supported when budget approves |
| New Relic | Same cost concern; OTLP collector swap is trivial when needed |
| AWS CloudWatch | Vendor lock-in; OTLP preferred for portability |
| Rollbar / Bugsnag | Team already familiar with Sentry; switching cost not justified |
| Embedded `prom-client` | Brings 12+ transitive dependencies; in-process store is sufficient for Phase 1 volume |

---

## Consequences

- **Positive:** No new runtime dependencies unless `SENTRY_DSN` is actually set; metrics endpoint works on day one with zero external dependencies
- **Positive:** Sentry SDK choice is revocable without code changes — just remove the env var
- **Positive:** OTLP exporter endpoint is vendor-neutral; switching from Grafana Tempo to Honeycomb requires only an env var change
- **Negative:** In-process metrics reset on pod restart — absolute totals require Prometheus remote-write aggregation or a persistent Prometheus scrape target
- **Negative:** `@sentry/node` must be added as an `optionalDependency` (or installed when `SENTRY_DSN` is set) — dynamic import will silently no-op if the package is absent, which is the intended behaviour

---

## Implementation Notes

- `SENTRY_DSN` and `OTEL_EXPORTER_OTLP_ENDPOINT` are optional in `ValidatedEnv` and validated as URLs when present
- `ObservabilityModule` is `@Global()` so any future service can inject `ObservabilityService` for custom metric increments without additional module imports
- See `apps/web/test/integration/apm-vendor-decision.test.cjs` for contract evidence
