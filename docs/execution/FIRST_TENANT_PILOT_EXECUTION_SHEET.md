# First-Tenant Pilot Execution Sheet

Last reviewed: 2026-09-03

Status: BLOCKED — P1 auth revocation disposition and Woo app-auth verification
required before tenant onboarding

Authority: 2026-09-03 blocker-closure review supersedes earlier controlled-pilot
approval until P1 blockers are closed and re-signed.

See:

- `docs/execution/AUTH_REVOCATION_FAILURE_POLICY_DECISION_2026-09-03.md`
- branch artifact
  `blocker/p1-woo-app-auth-tenant-key:docs/execution/P1_WOO_APP_AUTH_CREDENTIAL_PERSISTENCE_CLOSURE_2026-09-03.md`
- `docs/readiness/TEAM_SIGNOFF_MATRIX_2026-08-29.md`

## Execution Path

| Order | Owner | Action | Exit evidence |
| --- | --- | --- | --- |
| 1 | PO / Sales / Delivery | Select pilot tenant and define scope | Named tenant, connectors, SKU/catalog scope, success criteria, evaluation dates |
| 2 | Legal / PO | Put minimum pilot agreement in place | Signed terms covering service scope, data handling, support expectations, liability/SLA treatment |
| 3 | Delivery / Support | Establish pilot support path | Named primary contact, escalation contact, response expectations, support inbox/channel |
| 4 | Delivery / QA | Complete pilot onboarding document | Tenant-specific closeout template completed before access |
| 5 | Operator / QA | Run supervised onboarding | Tenant provisioned, connector established, first safe publish verified, recovery path known |
| 6 | PO / CTO | Start pilot clock | Pilot start date recorded, review checkpoints scheduled |

## Pilot Scope

```
Pilot tier:            Not authorized while P1 hold is open
Tenant count:          0 until re-signed
Supported connectors:  None for customer onboarding until P1-2 implementation
                       review and required fixes are verified
Operating mode:        blocker closure / internal evidence only
No promise of:         broad GA support, unmanaged/self-service onboarding,
                       enterprise SLA beyond signed pilot terms, unverified
                       connector capabilities, 5k-20k native bulk architecture
```

## Tenant Acceptance Record

| Field | Value |
| --- | --- |
| Tenant | |
| Pilot owner | |
| Technical owner | |
| Start date | |
| End / review date | |
| Connector(s) | |
| Auth path | |
| Catalog size | |
| Expected publish volume | |
| Variant complexity | |
| Media expectations | |
| Success criteria | |
| Known exclusions | |
| Known limitations | |
| Support channel | |
| Escalation path | |
| Incident owner | |
| Rollback / recovery path | |
| Offboarding path | |
| Commercial terms signed | YES / NO |
| Privacy / data terms signed | YES / NO |
| Pilot go-live | APPROVED / BLOCKED |

## First-Tenant Go-Live Gate

Go-live requires all of the following:

- [ ] P1-2 auth revocation policy completed with Security/SRE/CTO signoff
- [ ] Any required P1-2 implementation verified in CI and staging
- [ ] P1-1 Woo app-auth fix reviewed, CI-verified, staged, and runtime-verified
- [ ] Named tenant with defined evaluation scope
- [ ] Minimum pilot agreement signed (service scope, data handling, support
      expectations, liability/SLA treatment)
- [ ] Support / escalation channel established and tested
- [ ] Tenant-specific closeout template completed
      (`docs/readiness/CUSTOMER_PILOT_CLOSEOUT_TEMPLATE_2026-08-29.md`)
- [ ] Tenant provisioned in production environment
- [ ] At least one approved connector installed and credential-verified
- [ ] First safe publish executed under operator supervision
- [ ] Recovery path documented and known to operator
- [ ] No unapproved pricing, SLA, connector, or production-readiness claim
      shown to the tenant

## Named GA Blockers (Not Waived by Pilot)

These items are not waived by the P1 hold. They remain named blockers for GA
with owners and target dates. They must not quietly disappear because blocker
closure starts.

| Blocker | Owner | Target | Current state |
| --- | --- | --- | --- |
| External VAPT / penetration test | CTO / Security | Before GA | Not started |
| Backup restore drill with measured RPO/RTO | CTO / Ops | Before GA | No drill evidence |
| Secondary on-call assignment | CTO | Before scaling beyond 2 tenants | Sole operator |
| Store-admin side verification (Shopify + WooCommerce) | QA / Connector team | Before GA | Credential-gated |
| Multi-variant + metafield Shopify test data | QA | Before GA connector claims | No multi-variant products in catalog |
| 3 env-blocked web integration tests | QA / DevOps | Before GA | Need JWT_SECRET, PIM_API_BASE_URL, AUTH_MODE=db |
| Legal counsel review of MSA, SLA, ToS, privacy policy | Legal / CTO | Before any non-pilot customer use | Skeletons only |
| Security/privacy evidence pack signoff | Security / Privacy / CTO | Before GA | All items status: Needed |
| Public pricing and marketing claims approval | Marketing / Legal / PO | Before public launch | Blocked |
| P1 auth revocation degraded-mode decision | Security / SRE / CTO | Before customer onboarding | Pending |
| WooCommerce app-auth tenant ownership verification | Connector / QA / Security | Before Woo customer onboarding | Locally fixed; needs PR, CI, staging, runtime proof |

## Review Schedule

- **Next formal review:** 2026-09-10 or immediately after first tenant
  onboarding, whichever comes first
- **Pilot checkpoint cadence:** weekly during active pilot
- **Escalation trigger:** any P0/P1 defect discovered during pilot onboarding
  or operation triggers immediate CTO review
