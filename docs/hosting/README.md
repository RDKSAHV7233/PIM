---
title: Hosting Stage Overview
audience: internal-ops
status: active
last_updated: 2026-05-17
owner: Engineering
---

# Hosting Stage Overview

Vexa PIM has three named hosting stages. Each stage has a dedicated runbook, an env template, and a triggerable GitHub Actions workflow. Promote between stages only when the stage's exit gate passes.

## Stage decision table

| Stage | Monthly cost | Purpose | Exit gate |
|-------|-------------|---------|-----------|
| [Stage 1 — Free Testing](stage-1-free-testing.md) | ₹0 | Internal dev, CI baseline | Sustained uptime + all integration tests green |
| [Stage 2 — Investor Demo](stage-2-investor-demo.md) | ₹3,000–5,000 | Customer-facing demo, investor walkthrough | Pre-investor checklist passes on `promote-stage2` workflow |
| [Stage 3 — Pilot Ready](stage-3-pilot-ready.md) | ₹10,000–15,000 | Pilot tenants, production-grade SLA | Stage 3 readiness gate passes on `promote-stage3` workflow |

## Triggering a stage verification

```bash
# Stage 1 — local verification
npm run hosting:stage1:verify

# Stage 2 — pre-demo gate
npm run hosting:stage2:verify

# Stage 3 — pilot readiness gate
npm run hosting:stage3:verify
```

Or trigger via GitHub Actions → **deploy-stage1**, **promote-stage2**, or **promote-stage3** with the `STAGING_URL` input.

## Environment templates

Each stage has a matching env template in `.env-templates/`:

- `.env-templates/.env.stage1.example` — free-tier services, workers disabled
- `.env-templates/.env.stage2.example` — paid services, worker enabled
- `.env-templates/.env.stage3.example` — full pilot configuration, backups, RLS

Copy the relevant template to `.env`, fill in real secrets, and deploy.
