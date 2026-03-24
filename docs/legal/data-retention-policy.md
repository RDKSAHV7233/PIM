# TEJ PIM Data Retention Policy

- Document owner: Product Ops + Compliance + CTO
- Status: Active operational baseline
- Last updated: 2026-03-19

## 1. Purpose
This policy defines the baseline retention and deletion posture for data processed in TEJ PIM.

The objective is to:
- retain enough information for security, auditability, support, and legal compliance;
- avoid keeping data longer than operationally justified; and
- keep non-production artifacts under tighter control.

## 2. Principles
- Tenant isolation applies to retention and purge operations.
- Retention may be extended for legal hold, incident response, fraud review, or contractual obligations.
- Production data and test data are handled differently.
- Where automated deletion is not yet implemented, manual operational handling must be recorded.

## 3. Retention Baseline

| Data category | Examples | Retention baseline | Notes |
|---|---|---|---|
| Authentication records | login attempts, lock state, revocation metadata | 90 days for transient security state; longer where captured in audit logs | In-memory or Redis lock state is operational, not archival |
| Audit logs | role changes, connector access changes, privacy actions, password set events | 365 days minimum | Extend for investigations or legal hold |
| Consent records | account consent events | 365 days minimum after last active use, or longer if required by law | Needed for privacy/compliance traceability |
| Privacy request records | account export and deletion request metadata | 365 days minimum after request closure | Export fulfillment may be manual during controlled rollout |
| Product and taxonomy data | products, variants, categories, attributes | retained for active tenant lifetime | Deleted or exported per customer offboarding or purge request |
| Connector job metadata | export jobs, submissions, retries, dead-letter metadata | 180 days baseline | Longer retention may be required for dispute handling |
| Payload snapshots | connector request/response payload snapshots | 90 days baseline unless shorter retention is configured | Sensitive fields must be redacted where required |
| Credential material | encrypted connector credentials, API keys, password hashes | retained while active; remove on revocation/offboarding unless legal hold applies | Never store plain-text credentials |
| Notifications and operational summaries | user notifications, dashboard summaries, usage snapshots | 90 days baseline unless needed for billing or trend evidence | Cached/derived records may expire sooner |
| Test data | smoke, benchmark, seeded fixtures, staging-only artifacts | purge as soon as no longer needed | Use the test-data purge workflow |

## 4. Test Data Policy
Test and smoke artifacts must not accumulate indefinitely in seller-facing environments.

Operational rules:
- hide test data by default in seller-facing UI;
- use tenant-scoped purge tooling for non-production cleanup;
- run dry-run before purge execution; and
- record purge evidence in execution docs when used for release hygiene.

Reference: `docs/runbooks/test-data-governance.md`

## 5. Deletion Triggers
Deletion or purge may be triggered by:
- customer offboarding;
- approved deletion request;
- test-data cleanup;
- credential or API-key revocation;
- contract termination; or
- internal retention-window expiry.

## 6. Manual Controls
Where automated deletion or fulfillment is not yet implemented:
- the request must still be recorded in-system;
- the handling owner must be clear;
- the user-facing surface must not promise automatic fulfillment; and
- completion should be recorded once fulfilled manually.

## 7. Legal Hold and Exceptions
The operator may suspend deletion where reasonably required for:
- litigation hold;
- fraud or abuse investigation;
- regulatory inquiry;
- incident response; or
- contract enforcement.

Any retention exception should be documented with scope and owner.

## 8. Review Cycle
This policy should be reviewed:
- at least once per quarter during controlled rollout; and
- whenever new privacy workflows, storage classes, or legal obligations are introduced.
