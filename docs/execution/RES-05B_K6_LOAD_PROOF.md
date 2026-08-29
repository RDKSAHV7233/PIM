# RES-05B k6 Load Proof

Status: CODE READY / RUNTIME LOAD EVIDENCE PENDING

This increment adds the repeatable k6 harness for RES-05B capacity evidence. It does not change production settings, replica counts, database settings, Redis settings, customer data, connector credentials, or SLA wording.

## Scope

- k6 script: `scripts/res-05b-k6-load-proof.js`
- static contract guard: `scripts/res-05b-k6-load-proof.test.cjs`
- read-only authenticated API workload by default

## Profiles

| Profile | Purpose | Duration / VUs |
| --- | --- | --- |
| `health` | unauthenticated health-only check | 1 VU, 1 minute |
| `smoke` | fast authenticated read-path proof | 1 VU, 2 minutes |
| `baseline` | low-volume baseline | 5 VUs, 15 minutes |
| `expected` | approved expected-load shape | ramp to 25 VUs, 30 minutes |
| `burst` | approved burst shape | ramp to 50 VUs, 10 minutes |
| `sustained` | approved sustained shape | 25 VUs, 60 minutes |

## Read-Only Workload

The initial harness samples:

- `/health`
- `/catalog/products?slim=true&limit=20`
- `/taxonomy/categories?limit=20`
- `/dashboard/health`
- `/connectors/installed?limit=10`
- `/billing/usage`
- `/audit/logs?limit=10`

Mutation mode is intentionally fail-closed. Bulk import, bulk edit, media upload, and publish/export load must be added only after explicit fixture approval.

## Credential Distribution

Authenticated profiles can still use the legacy single-credential variables for smoke and baseline checks:

```bash
RES05B_WORKSPACE=<staging workspace>
RES05B_ADMIN_USER=<staging admin user>
RES05B_ADMIN_PASSWORD=<staging admin password>
```

The acceptance profiles `expected`, `burst`, and `sustained` must model the approved 10 active tenants / 25 active sessions workload. They therefore fail closed unless the run supplies at least 10 credentials through `RES05B_CREDENTIALS_JSON`:

```json
[
  {
    "workspace": "<workspace-a>",
    "user": "<user-a>",
    "password": "<password-a>"
  },
  {
    "workspace": "<workspace-b>",
    "user": "<user-b>",
    "password": "<password-b>"
  }
]
```

`RES05B_MIN_DISTRIBUTED_CREDENTIALS` defaults to `10`. Do not lower it for acceptance without explicit PO/CTO/SRE approval.

`RES05B_LOGIN_STAGGER_SECONDS` controls setup-time pacing between credential logins. For distributed acceptance profiles, the default spreads credentials across the 15-minute auth IP rate-limit window. With 10 credentials, this defaults to 100 seconds between setup logins. Do not reduce it for acceptance unless SRE has verified the runner IP is outside the current login-rate window.

Distributed profiles set k6 `setupTimeout` to 20 minutes so the paced login setup can complete. Non-distributed profiles keep a 1-minute setup timeout.

`RES05B_SESSION_THINK_TIME_MIN_SECONDS` and `RES05B_SESSION_THINK_TIME_MAX_SECONDS` control per-VU think time after each read-only iteration. Distributed profiles default to 10-14 seconds so 25 active sessions remain under the current 300 requests/minute source-IP throttle when each iteration performs health plus one sampled read request. Lower values are rate-limit/stress experiments unless PO/CTO/SRE explicitly approve them for acceptance.

`RES05B_ALLOW_SINGLE_CREDENTIAL_STRESS=true` is reserved for explicitly approved rate-limit experiments. It is not valid RES-05B acceptance evidence for the approved distributed workload.

## Thresholds

Thresholds are frozen in [RES-05A Workload Contract](RES-05A_WORKLOAD_CONTRACT.md) (issue #713):

- health p95 <= 400 ms
- catalog products p95 <= 3000 ms
- dashboard p95 <= 3000 ms
- connectors p95 <= 1000 ms
- audit p95 <= 2000 ms
- HTTP 5xx rate <= 0.5 percent
- request failure rate <= 0.5 percent

HTTP 429 is tracked separately because it can be expected only when documented limits are intentionally exceeded.

429 responses fail by default through the `res05b_http_429_rate` threshold. A run may set `RES05B_ALLOW_DOCUMENTED_429=true` only when PO/CTO/SRE have explicitly classified that execution as a documented rate-limit experiment, not as Scale/SLA acceptance proof.

## Queue / Async Evidence

Queue wait latency and job execution latency are separate evidence streams.

Queue wait latency:

- enqueue to processing-start latency
- expected-load p95 target: <= 30 seconds
- burst p95 target: <= 60 seconds

Job execution latency:

- measured by job class
- marketplace export/publish p95 target: <= 120 seconds
- bulk import completion target: freeze from RES-05B baseline evidence

This read-only harness samples queue depth and failed counts from `/health`. It does not prove queue wait latency by itself because no queue-producing workload is enabled yet.

## No Production Settings

No production settings may be changed by this increment.

Do not change:

- API replicas
- worker replicas
- database URLs
- connection-pooling settings
- Redis plan or memory
- Railway service settings
- customer SLA text
- production connector credentials

## Runtime Acceptance

RES-05B remains NOT ACCEPTED until runtime evidence exists for the approved profiles.

Minimum closure evidence:

```text
health profile:      PASS
smoke profile:       PASS
baseline profile:    PASS
expected profile:    PASS
burst profile:       PASS
sustained profile:   PASS
artifact uploaded:   PASS
secrets printed:     NO
mutation mode:       read_only
```

The first runtime blocker is local tooling: k6, Docker, and Go are not available in the current WSL environment.

The first automation blocker is GitHub auth scope: the current OAuth credential cannot create or update files under `.github/workflows/` because it lacks workflow scope. A manual workflow-dispatch wrapper should be added in a separate PR after workflow-scope credential access is available. Until then, run the harness from an environment where k6 is installed:

```bash
RES05B_PROFILE=smoke \
RES05B_API_BASE_URL=https://vexa-api-slug-vexa-api-staging.up.railway.app/api/v1 \
RES05B_WORKSPACE=<staging workspace> \
RES05B_ADMIN_USER=<staging admin user> \
RES05B_ADMIN_PASSWORD=<staging admin password> \
k6 run scripts/res-05b-k6-load-proof.js
```

Do not print the password, token, or any derived authorization header.

For `expected`, `burst`, and `sustained`, use a secret-injected `RES05B_CREDENTIALS_JSON` value. The summary records only credential count and distribution mode; it must not expose usernames, passwords, bearer tokens, or authorization headers.

By default the k6 JSON summary is written to `res-05b-k6-summary.json` in the current working directory. If `RES05B_SUMMARY_PATH` points into a directory, create that directory before starting k6 because k6 does not create parent directories for summary outputs.

## Local Health-Profile Evidence

Executed from the current WSL runner on 2026-08-26 with temporary k6 `v2.2.0`.

```text
profile:                 health
mutation mode:           read_only
HTTP 5xx rate:           0
health p95 observed:     324.9261855 ms
approved threshold:      <= 200 ms
result:                  FAIL
```

Repeat run from the same WSL runner, same staging API target, same read-only profile:

```text
profile:                 health
mutation mode:           read_only
HTTP 5xx rate:           0
request failure rate:    0
iterations:              47
health p95 observed:     295.695072 ms
approved threshold:      <= 200 ms
result:                  FAIL
```

This proves the harness can execute and the staging health endpoint was available, but it does not close RES-05B because the approved health latency threshold was crossed twice. Treat this as stable evidence that the next run needs either a controlled runner close to staging, service/runtime tuning, or a PO/CTO-approved threshold revision, not an assumed pass.

## Authenticated Smoke-Profile Evidence

Executed from the current WSL runner on 2026-08-26 with a temporary staging-only `res05b` admin identity in the `admin` workspace. The identity was deactivated after the run.

First smoke attempt:

```text
profile:                 smoke
mutation mode:           read_only
temporary identity:      created and deactivated
HTTP 5xx rate:           0
HTTP 429 rate:           0
request failure rate:    19.298245614035087 percent
result:                  FAIL
root cause:              harness route drift
```

The smoke workload included two nonexistent API paths:

```text
/dashboard/snapshot -> 404
/audit?limit=10     -> 404
```

Replacement paths were verified with the same temporary-identity method before updating the harness:

```text
/dashboard/health      -> 200
/audit/logs?limit=10   -> 200
```

Post-correction smoke rerun:

```text
profile:                 smoke
mutation mode:           read_only
temporary identity:      created and deactivated
checks:                  112/112 passed
HTTP 5xx rate:           0
HTTP 429 rate:           0
request failure rate:    0
iterations:              55
health p95 observed:     355.47160499999995 ms
catalog p95 observed:    4672.656328499994 ms
dashboard p95 observed:  728.7808589999999 ms
connectors p95 observed: 740.116773 ms
audit p95 observed:      777.49299 ms
result:                  FAIL
failed thresholds:       health p95, catalog products p95
```

The corrected smoke profile proves the authenticated read-only harness is functionally valid against staging. RES-05B still remains NOT ACCEPTED because health and catalog latency exceeded the approved gates.

Follow-up route-realism correction:

```text
/catalog/products?limit=20           -> previous heavy preview/sample path
/catalog/products?slim=true&limit=20 -> normal product-list read path used by existing E2E/web traffic
```

Both routes were verified through real temporary staging admin login. The slim route is materially faster and better matches normal UX read traffic, but it still requires a fresh smoke run before any RES-05B gate decision changes.

Slim-route smoke rerun:

```text
profile:                 smoke
mutation mode:           read_only
temporary identity:      created and deactivated
checks:                  102/102 passed
HTTP 5xx rate:           0
HTTP 429 rate:           0
request failure rate:    0
iterations:              50
health p95 observed:     390.13339499999995 ms
catalog p95 observed:    2622.347579 ms
dashboard p95 observed:  1285.5988439999996 ms
connectors p95 observed: 794.9999114999999 ms
audit p95 observed:      761.243904 ms
result:                  FAIL
failed thresholds:       health p95, catalog products p95
```

The slim route reduces product-list latency compared with the earlier heavy list path, but it does not close RES-05B. Health p95 and catalog p95 still exceed the approved gates from the current WSL runner.
