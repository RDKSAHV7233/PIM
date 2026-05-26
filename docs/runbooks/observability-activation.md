---
title: Observability Activation Guide
audience: internal-eng
status: active
last_updated: 2026-05-25
owner: Engineering
---

Use this guide to enable Sentry error tracking, OpenTelemetry distributed tracing, and Prometheus metrics scraping for a Vexa PIM deployment.

Design decision reference: [`docs/architecture/ADR-002-observability-stack.md`](../architecture/ADR-002-observability-stack.md)

## 1. Overview

Vexa PIM has three observability layers, all activation-gated via environment variables:

| Layer | Tool | Env var | Default |
|-------|------|---------|---------|
| Error tracking | Sentry | `SENTRY_DSN` | Disabled (absent = SDK never loads) |
| Distributed tracing | OpenTelemetry (OTLP) | `OTEL_EXPORTER_OTLP_ENDPOINT` | Disabled |
| Metrics | Prometheus (in-process) | Always active | Exposed at `/api/v1/health/metrics` |

All three can be active simultaneously with no conflicts.

---

## 2. Enable Sentry Error Tracking

### 2.1 Prerequisites

- A Sentry project. Recommended: create a project named `vexa-pim-api` in your Sentry organization.
- `@sentry/node` and `@opentelemetry/sdk-node` are bundled in `apps/api` and ship with every deployment — no extra install step needed.

### 2.2 Configure

Set `SENTRY_DSN` in Railway Variables for the `pim1-api` service:

```
SENTRY_DSN=https://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx@o123456.ingest.sentry.io/7654321
```

On next deploy, the startup log includes:
```
Sentry initialized: dsn=https://xxxx@...ingest.sentry.io/...
```

### 2.3 Verify

1. Trigger a known error in staging (e.g., call an endpoint with invalid input that reaches an unhandled path).
2. Check the Sentry dashboard — the error should appear within 30 seconds.
3. Confirm the environment tag matches `APP_ENV` (e.g., `staging` or `production`).

### 2.4 Sampling rates

The `tracesSampleRate` is set automatically:
- `production`: 0.1 (10% of transactions traced — controls ingestion cost)
- All other environments: 1.0 (100% — full traces in staging and dev)

Adjust by deploying a code change to `apps/api/src/main.ts` if needed.

---

## 3. Enable OpenTelemetry Distributed Tracing

### 3.1 Supported backends

Any OTLP-compatible collector:
- Grafana Tempo
- Honeycomb
- Jaeger (with OTLP receiver)
- AWS X-Ray (via OTLP adapter)
- Datadog (via OTLP ingest)

### 3.2 Configure

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to your collector's gRPC or HTTP endpoint:

```
# gRPC (recommended)
OTEL_EXPORTER_OTLP_ENDPOINT=grpc://tempo.internal:4317

# HTTP
OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo.internal:4318
```

### 3.3 Verify

1. Make a request to any API endpoint.
2. Check the collector or Grafana Tempo UI for a trace with service name `vexa-pim-api`.
3. Confirm spans appear for HTTP requests and database queries.

If no traces appear:
- Check that the endpoint is reachable from the Railway network.
- Check Railway logs for OTLP export errors.

---

## 4. Prometheus Metrics

### 4.1 Metrics endpoint

Metrics are always available (no extra config required):

```bash
curl -H "x-pim-ops-token: $PIM_COMMERCIAL_OPS_TOKEN" \
  https://app.vexapim.com/api/v1/health/metrics
```

The response is Prometheus text format (`Content-Type: text/plain; version=0.0.4`).

### 4.2 Available metrics

| Metric | Type | Description |
|--------|------|-------------|
| `pim_api_requests_total` | Counter | Total HTTP requests by route and status |
| `pim_api_errors_total` | Counter | Errors by type |
| `pim_queue_jobs_enqueued_total` | Counter | Jobs added to queue by queue name |
| `pim_queue_jobs_completed_total` | Counter | Jobs completed |
| `pim_queue_jobs_failed_total` | Counter | Jobs failed |
| `pim_process_uptime_seconds` | Gauge | Process uptime |
| `pim_api_request_duration_ms` | Histogram | Request duration (buckets: 10, 50, 100, 250, 500, 1000, 2500, 5000 ms) |

### 4.3 Configure Grafana scraping

For Grafana Cloud remote-write agent, add to the agent config:

```yaml
integrations:
  prometheus_remote_write:
    - url: https://prometheus-prod-xx.grafana.net/api/prom/push
      basic_auth:
        username: <grafana-cloud-id>
        password: <grafana-cloud-api-key>

metrics:
  global:
    scrape_interval: 60s
  configs:
    - name: vexa-pim
      scrape_configs:
        - job_name: vexa-pim-api
          metrics_path: /api/v1/health/metrics
          scheme: https
          static_configs:
            - targets:
              - app.vexapim.com
          authorization:
            type: x-pim-ops-token
            credentials: <PIM_COMMERCIAL_OPS_TOKEN>
```

### 4.4 SLO Alert Thresholds

Recommended alert rules:

| Alert | Condition | Severity |
|-------|-----------|---------|
| High error rate | `pim_api_errors_total` rate > 1% over 5 min | P1 |
| Request latency | p95 `pim_api_request_duration_ms` > 2000 ms over 5 min | P1 |
| Queue failures | `pim_queue_jobs_failed_total` rate > 5/min | P1 |
| Process restart | `pim_process_uptime_seconds` resets to < 60 | P2 |

---

## 5. Checklist: Production Observability Activation

Before enabling observability for a production deployment, verify each item:

- [ ] `@sentry/node` installed in `apps/api/package.json`
- [ ] `SENTRY_DSN` set in Railway `pim1-api` variables
- [ ] Sentry project environment set to `production`
- [ ] Test error appears in Sentry dashboard within 60 seconds of triggering
- [ ] OTLP endpoint is reachable from Railway network (test with `curl -o /dev/null -w "%{http_code}"`)
- [ ] First trace visible in Grafana Tempo or equivalent
- [ ] Prometheus scrape job returning non-empty metric output
- [ ] Alert rules deployed in Grafana with correct thresholds
- [ ] On-call team notified of alert routing (see [On-Call Guide](on-call-guide.md))
