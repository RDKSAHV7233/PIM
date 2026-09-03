# Legal, Commercial, And Ops Gaps

Last reviewed: 2026-09-03

Status: active gap register - doc corrections applied 2026-09-03

This register lists existing docs that must be finalized before customer use or
launch signoff. Do not treat skeletons, runbooks, or historical signoffs as
current approval.

## Legal Documents

| Document | Exists | Current readiness | Required preparation |
| --- | --- | --- | --- |
| `docs/legal/terms-of-service.md` | Yes | Needs legal approval for current controlled rollout | Legal review and final publish decision |
| `docs/legal/privacy-policy.md` | Yes | Needs privacy/legal approval | Confirm data flows, processors, jurisdiction, contacts, rights process |
| `docs/legal/dpa.md` | Yes | Baseline pending customer-specific annexes | Add customer annex template and subprocessors/processors |
| `docs/legal/msa.md` | Yes | Skeleton with legal fill items | Legal counsel must fill all placeholders before customer use |
| `docs/legal/sla.md` | Yes | Skeleton refreshed to no approved SLA/no managed PITR baseline | Do not publish until support/SLO/credits/escalation terms are approved |
| `docs/legal/cookie-policy.md` | Yes | Technical inventory complete (6 cookies, no analytics/marketing) | Legal review of consent mechanism and DPDP alignment still required |
| `docs/legal/acceptable-use-policy.md` | Yes | Contacts and response targets filled | Legal review of prohibited use and enforcement wording still required |
| `docs/legal/dpdp-compliance.md` | Yes | Needs privacy owner review | Align with current data-governance register |
| `docs/legal/data-retention-policy.md` | Yes | Needs operations/legal proof | Confirm retention jobs, export/delete evidence, backups |
| `docs/legal/data-localisation.md` | Yes | Technical baseline refreshed to Railway/R2/no-PITR | Confirm actual hosting/storage jurisdictions, DPAs, and subprocessors |

## Commercial Documents

| Document | Exists | Current readiness | Required preparation |
| --- | --- | --- | --- |
| `docs/product/commercial-policy.md` | Yes | Current policy baseline; self-serve paid activation blocked | Keep public pricing blocked until Finance/Legal/PO approve |
| `docs/product/pricing.md` | Yes | Public-safe only if no prices/limits are published | Review before website/docs release |
| `docs/product/claim-register.md` | Yes | Requires proof mapping | Align every claim with proof reference |
| `marketing/claims/claims.json` | Yes | Conditioned and blocked | Add approved evidence before publish |
| `marketing/claims/proof-references.json` | Yes | 14 repo-safe evidence entries populated | Restricted evidence store not yet established; public claims still blocked |

## Ops Documents

| Document | Exists | Current readiness | Required preparation |
| --- | --- | --- | --- |
| `docs/runbooks/incident-response.md` | Yes | On-call contacts filled (sole operator CTO) | Secondary on-call not yet assigned; PagerDuty/Slack alerting not configured |
| `docs/runbooks/on-call-guide.md` | Yes | Updated 2026-09-03 | Sole operator rota; escalation and handoff require secondary on-call assignment |
| `docs/runbooks/backup-restore.md` | Yes | Current Railway/R2 caveat recorded | Add fresh non-zero backup proof and restore drill result |
| `docs/runbooks/disaster-recovery.md` | Yes | Current restore path corrected to R2 `pg_dump`; needs measured proof | Align RPO/RTO with real restore drill |
| `docs/runbooks/production-deploy.md` | Yes | Needs current deployment evidence | Add latest deploy/rollback verification links |
| `docs/runbooks/observability-activation.md` | Yes | Needs live telemetry confirmation | Record dashboard URLs/owners without exposing secrets |
| `docs/runbooks/stripe-billing-runbook.md` | Yes | Blocked for public checkout | Use only after commercial and feature-flag approval |

## Minimum Prep Before Customer Access

- Legal names, notices, and customer terms approved.
- Commercial authority recorded outside public docs.
- Support and escalation contacts filled.
- Environment, deployment, backup, and restore evidence captured.
- Customer support channel active.
- Known limitations reviewed with PO and Support.

## Minimum Prep Before Public Launch

- Public claims approved through claim-to-proof governance.
- Public legal pages approved.
- Public pricing/checkout policy approved or explicitly hidden.
- Ops/SRE signoff completed with current evidence.
- Security/privacy evidence pack approved.
