# Decision record: WooCommerce P1 governance state (2026-10-05)

Status: **RECORDED from the owners' decisions of 2026-10-05.** This record states the governance state and the
closure criteria. It is **not** a sign-off: the named approvals it requires do not exist yet and are not implied.

Prepared by: Claude, at the owners' instruction. Ratified by: ______ Date: ______

Supersedes (as the current governance state): the 2026-10-03 closure recorded by #1052 and #1059. Preserved,
not rewritten: those events, `INC-85`, the dated 2026-09-03 to 2026-09-05 P1 records, and the factual evidence in
`P1_WOO_AUTH_CURRENT_REBASELINE_2026-10-05.md` (#1172).

## Context

- On 2026-10-03 #1052 closed "P1-1/P1-2" and moved WooCommerce to `controlled_pilot`; #1059 moved it to
  `early_access` and opened new installs. The repository records no named CTO, PO, Security, QA or SRE approvals
  and no production database-isolation evidence for that closure, and the evidence cited for "P1-2" was
  connector-credential revocation rather than the JWT revocation-authority policy P1-2 is defined as.
- Since then the sandbox evidence the dated records asked for exists (#1168, #1172): tenant-owned credential
  persistence and isolation at both the application and the database layer, and real-Redis outage behavior.
  Production evidence does not.
- WooCommerce app-auth onboarding is not implemented end to end, so it cannot be a closure condition.

## Decisions

### D1. The 2026-10-03 closure is superseded and `p1_blocker_hold` is restored
This is a **governance correction, not an engineering regression.** WooCommerce remains technically available for
controlled engineering use; commercial and release progression is returned to `p1_blocker_hold` until the
criteria in D3 and D4 are recorded.

Effect in the system (this change): new installs and customer rollout are paused (the hold is neither
customer-visible nor installable), and the surfaced capabilities are unchanged, exactly as before 2026-10-03.
Existing installations are not altered by this change. That expectation is from the policy code and has **not**
been verified at runtime.

### D2. History is preserved
#1052 and #1059 remain historical events. `INC-85` and the dated 2026-09-03 to 2026-09-05 records are unchanged.
#1172's evidence remains factual. This record adds a new ledger entry (`INC-95`); it does not edit old ones.

### D3. Closure criteria (explicit and not retroactive)
The hold may be lifted only when **all** of the following are recorded in the repository, each against the
**current evidence and the current SHA at the time of approval**:

- CTO approval
- Product Owner approval
- Security approval
- QA approval
- SRE approval

No earlier statement, merge or sign-off counts as these approvals, and none is implied. The record names the role
holder, the SHA, the evidence reviewed and the date.

### D4. Production RLS evidence is required before re-closing
The SRE provides, from production, read-only and redacted:

1. **The actual application and pool database role**: the role the tenant-scoped (pooled) client connects as, and
   separately the role the documented RLS-bypassing "direct" client uses.
2. **`BYPASSRLS = false`** for the tenant-scoped role (and `rolsuper = false`).
3. **Table ownership** of every table that carries a tenant key, identifying whether the tenant-scoped role owns it.
4. **`FORCE ROW LEVEL SECURITY` disposition** for each such table: where ownership would otherwise bypass RLS,
   whether `FORCE` is active, or the recorded reason it is not.

Suggested read-only queries (run through the connection string each client really uses):

```sql
SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;

SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.oid IN (SELECT attrelid FROM pg_attribute WHERE attname IN ('tenant_key', 'tenantKey') AND NOT attisdropped)
ORDER BY c.relname;
```

The evidence is recorded with the date and the deployed SHA, and must contain no credentials or tenant data.
Sandbox evidence (#1168) shows what holds *if* the role is restricted; it cannot substitute for this.

### D5. Onboarding truth
- **Manual API-key installation is the supported current WooCommerce onboarding mechanism.**
- **WooCommerce app-auth is unsupported and incomplete.** Five end-to-end pieces are missing (see the re-baseline,
  section 5). No production app-auth evidence is required until it exists as a separately approved product feature.
- `BUG-WOO-OAUTH-QUERY-SECRET` remains a security finding and is a **hard prerequisite** before any future app-auth
  enablement.

### D6. Controlled production onboarding evidence uses the supported path
When produced, it uses manual-key onboarding with a consenting tenant or test installation: redacted ownership
evidence, authenticated validation, and the named approvals in D3. A product publish is not required merely to
prove credential ownership. Until a supported app-auth flow exists there is nothing to prove for it.

### D7. Documentation
Only current-state documents are reconciled, and only their WooCommerce statements. Dated records are untouched.
The generated connector inventory is regenerated by its own script, not edited by hand.

### D8. Relationship to Sprint 5
ADR-0015 is the authoritative contract for publication targets. This record is its prerequisite governance state:
the publication-readiness evaluator reports `P1_BLOCKER_HOLD` for WooCommerce from the launch stage restored here.
Sprint 5.1 (shadow only) begins after this record is on `main`; enforcement is a later, separate decision.

## What changed in the system for this record
- `apps/api/src/connector-framework/connector-launch-policy.ts`: the WooCommerce stage and pipeline metadata only.
- Its spec and `woocommerce-launch-copy-consistency.test.cjs`, and the matching customer-facing copy in
  `apps/web/src/app/connectors/setup/page.tsx`.
- Documents: this record, the ADR-0015 status, the WooCommerce rows of the current-state documents, a pointer in the
  re-baseline, and the `INC-95` ledger entry.

## What did not change
No publication-target evaluator and no fail-closed default for unknown connectors (Sprint 5.1). No WooCommerce
app-auth work. No fix for `BUG-WOO-OAUTH-QUERY-SECRET`. No RLS or database change. No change to any other
connector's stage.

## Not verified
Runtime behavior after this change; the live pilot installation's state; production database roles and RLS; whether
named approvals exist outside the repository.
