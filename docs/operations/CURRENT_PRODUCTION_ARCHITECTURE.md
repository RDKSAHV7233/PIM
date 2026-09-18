---
title: Current Production Architecture
audience: internal-ops
status: active
last_updated: 2026-09-17
owner: Engineering / DevOps
---

This is the one canonical record of what infrastructure Vexa PIM actually runs on **today**,
verified directly against the live Railway dashboard and the repo's real GitHub Actions run
history — not against what any other document says should be true. When this file disagrees with
another doc, this file is correct; fix the other doc, not this one.

Architecture ADRs (`docs/architecture/ADR-*.md`) describe **why** decisions were made. This document
describes **what exists right now**. Update it whenever the live topology actually changes — not on
a schedule, and not speculatively.

## Snapshot

| Field | Value |
|---|---|
| Last verified | 2026-09-17, directly against the Railway dashboard (account `rdksahv7233`, project "blissful-hope") |
| Reference commit | `bdc35e5a` on `main` (2026-09-16) — there is no separate "production SHA"; whatever is on `main` is what's deployed |
| API host | Railway service **"Vexa API"**, Node 24.21.0, 1 replica |
| Web host | Railway service **"App Vexa"**, Node 24.21.0, 1 replica, serves `app.vexapim.com` — **not Vercel** |
| DNS / CDN in front of `app.vexapim.com` | Not independently verified beyond Railway's own edge — no WAF confirmed |
| Postgres (main app DB) | Self-hosted on Railway, `ghcr.io/railwayapp-templates/postgres-ssl` on a Railway volume — **not Neon**. Hobby plan: no native backup schedule, no PITR |
| Postgres (observability DB) | A second, separate Railway Postgres instance, same image, backs `OBSERVABILITY_DATABASE_URL`. **No backup of any kind** — see `docs/runbooks/backup-restore.md` §1 |
| Redis | Railway-managed, single instance, 512 MB default |
| Object storage | Cloudflare R2 (media + backup storage) |
| Queue | BullMQ over Redis, worker mode |
| Email | Resend (production email provider); `console` mode available for non-commercial config |
| Monitoring | Prometheus-format metrics at `/api/v1/health/metrics` only. **Sentry and OpenTelemetry are confirmed NOT configured** — no `SENTRY_DSN` or `OTEL_EXPORTER_OTLP_ENDPOINT` exists on the API service's environment variables |
| Backup | Daily `pg_dump` → R2 via `.github/workflows/backup-r2-daily.yml`, targeting the main app DB only. 30-day retention, 7-backup floor. This is the **only** backup mechanism of any kind — Railway itself provides none |
| Deploy workflow | `.github/workflows/deploy-staging.yml`, triggered on every push to `main`. This is the real, only-ever-executed release pipeline |
| Rollback mechanism | Manual: Railway dashboard → service → Deployments → re-deploy the last known-good version. No automated rollback exists |
| Primary on-call | Vishal Bhoi (CTO) — see `docs/runbooks/incident-response.md` §2 |
| Secondary on-call | None assigned |

## The one fact that corrects most other documents in this repo

**There is exactly one Railway environment, and it is named "Staging."** It is not a pre-production
copy of anything — it is the literal system serving real customer traffic at `app.vexapim.com`,
including at least one ENTERPRISE-plan pilot tenant with active billing (per
`docs/execution/CURRENT_STATE.md`).

A separate promotion pipeline exists in code — `deploy-stage1.yml` → `promote-stage2.yml` →
`promote-stage3.yml`, targeting a GitHub Environment named `production` — but it has **never
executed**, not once, confirmed via `gh run list --workflow=promote-stage3.yml` returning zero runs
in the repo's entire Actions history. The multi-provider architecture it was built to reach
(`docs/hosting/stage-2-investor-demo.md`, `stage-3-pilot-ready.md`: Vercel + Neon/Railway-Pro-PITR +
Upstash) was written down once on 2026-05-17 and never built. Real traffic took a simpler path
straight to the one Railway environment described above.

Every document that says "staging and production" as if they're two different things — the
architecture doc's Environment Tiers section, the on-call guide's health-check table, the incident
runbook's P0 definition — means the same one system in both halves of that sentence. Read them that
way until a second, real environment is actually built.

## Known, accepted-but-undocumented risks

These are real, currently live, and nobody has written down an explicit decision to accept them:

- **CI mutates real data on the live system on every deploy.** `deploy-staging.yml`'s post-deploy
  check creates real workspace users and a real product against the same database the pilot
  tenant's data lives in, on every push to `main`. Cleanup is incomplete (the test product it
  creates is never removed). See `docs/runbooks/test-data-governance.md` for the reactive purge
  tooling this has already required.
- **The observability database has zero backup coverage.** Likely fine (the data is designed to
  fail open and self-purge after 90 days) but never formally decided.
- **One Railway API token controls the entire system.** `RAILWAY_TOKEN`/`RAILWAY_PROJECT_ID` are
  repository-level GitHub secrets, not scoped per-environment — there's only one environment for
  them to be scoped against anyway.

## What to fix first

1. Rename the Railway environment "Staging" → "Production" (or whatever name matches reality) —
   zero engineering cost, immediately stops every runbook's terminology from being misleading.
2. Archive or explicitly freeze `deploy-stage1.yml`, `promote-stage2.yml`, `promote-stage3.yml`, and
   `docs/hosting/stage-2-investor-demo.md`/`stage-3-pilot-ready.md` — they describe infrastructure
   that was never built and read as a real safety net when they aren't one.
3. Get an explicit, written decision on the CI-mutates-real-data risk above: either isolate the
   post-deploy checks to a synthetic tenant with automatic teardown, or formally accept the risk in
   writing.
4. Decide the observability database's backup posture (add it to the workflow, or say explicitly
   that it's disposable) — don't leave it silent.

See the full external audit this document was extracted from for detailed evidence and citations
per finding (kept outside this repo).
