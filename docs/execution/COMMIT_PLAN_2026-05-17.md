# Commit Plan — 2026-05-17 CTO Sprint Pass

**Branch:** `claude/distracted-gagarin-2032bb`
**Target:** `main` (rebase recommended before opening PRs)
**Status:** Draft. Not yet executed. Awaiting explicit commit authorization.

---

## Why three commits, not one squash

The change set spans three logically separable concerns:

1. **Database + audit governance** — index migration, retention policy, related ADRs. Reviewable by a database engineer in 15 minutes.
2. **UX honesty + governance documents** — Meesho copy, operations counts, gate wiring, PO V4 sign-off, release notes, ADRs. Reviewable by an engineering lead + PO in 30 minutes.
3. **OIDC admin UI skeleton** — new admin surface plus contract test. Reviewable by a frontend engineer + auth backend reviewer in 30 minutes.

A single squash commit would force one reviewer to hold all three contexts simultaneously and would make rollback all-or-nothing. Three commits keep blast radius small.

---

## Commit 1: AuditLog index + retention policy

### Message

```
feat(db+audit): AuditLog composite index for revision/activity queries + retention policy

Adds (tenant_key, resource_id, action, created_at DESC) composite index to
audit_logs via concurrent migration. Supports getProductRevisions() and
getProductActivity() query paths without table scan as audit volume grows.

Filed ADR-005 (revisions-from-AuditLog) and ADR-006 (allowFailure sunset
policy) to record the rationale and bound the existing connector-idempotency
known-failing gate step.

Drafted docs/runbooks/audit-log-retention.md with tier-based retention bands
and the future purge implementation spec. Retention is policy only; no
automated purge runs yet.

No behavioral change to running services. Index creation is CONCURRENT so
migration is online-safe.

changelog: [Added] AuditLog composite index for revision/activity queries
changelog: [Added] AuditLog retention policy documentation
```

### Files

- `packages/db/prisma/migrations/20260517000002_auditlog_resource_action_index/migration.sql` (new)
- `packages/db/prisma/schema.prisma` (1 line: `@@index([tenantKey, resourceId, action, createdAt(sort: Desc)], ...)`)
- `docs/decisions/ADR-005-revisions-from-audit-log.md` (new)
- `docs/decisions/ADR-006-allowfailure-sunset-policy.md` (new)
- `docs/runbooks/audit-log-retention.md` (new)

### Verification before commit

- `npm run build --workspace @pim1/api` → PASS (validates Prisma client codegen against new schema)
- Migration SQL parses (`CREATE INDEX CONCURRENTLY` is valid PostgreSQL syntax)

---

## Commit 2: UX honesty + governance + gate wiring

### Message

```
feat(ux+governance): Meesho honest UI, operations count clarity, contract-test gating, V4 sign-off

Surfaces:
- Meesho connector tile in /connectors now honestly states the connector is
  in development. Excel export still throws Not Implemented (TODO P5-S4);
  surface no longer implies the export works. Server-action guard rejects
  export queueing for in-development channels at the action boundary.
- Operations dashboard KPI for Submission Jobs and Dead Letter Queue now
  displays "<windowLimit>+" when at the window cap, with helper text
  disclosing the cap. Replaces ambiguous "N of M" when N == M == limit.
- Central isChannelInDevelopment() registry in marketplace-channels.ts lets
  any UI surface consult one source of truth.

Governance:
- approval-comments and product-activity-timeline integration tests are
  wired as named npm scripts and as gated steps in run-increment-gates.cjs.
  Existing tests now continuously verify the V4 approved claims.
- PO sign-off V4 ratified. V3 (2026-05-06) is superseded.
  Approval comments, product activity timeline, and bounded OIDC login move
  from Forbidden to Approved. Browser-only Shopify proof, OIDC enforced,
  and Shopify publish-volume claims move to Forbidden.
- CURRENT_STATE.md V4 addendum supersedes V3-era posture without rewriting
  the historical content.
- v0.9.0-pilot release notes added for sellers; CHANGELOG entry for engineers.
- .env.staging converted to deprecation stub. .env.staging.example is the
  canonical template.
- ADRs 007, 008, 009, 010 filed: JSON attribute blob acceptance, billing
  operator-mediated, Smart Suggestions rule-based, OIDC opt-in.
- INC-10 idempotency diagnostic memo for the connector lead.

Contract-test updates: connector-launch-honesty-ui and
connector-claim-consistency tests updated to assert the honest Meesho copy
instead of the prior misleading "uses Excel export only" string. The tests
were encoding the lie; the corrected tests encode the truth.

changelog: [Changed] Meesho UI clearly marked in-development
changelog: [Changed] Operations counts display window cap honestly
changelog: [Added] approval-comments and product-activity-timeline gate steps
changelog: [Added] PO sign-off V4 supersedes V3
```

### Files

- `apps/web/src/lib/marketplace-channels.ts` (added registry)
- `apps/web/src/app/connectors/page.tsx` (Meesho copy)
- `apps/web/src/app/actions.ts` (server-action guard)
- `apps/web/src/app/operations/page.tsx` (count clarity + contract bridge comments)
- `apps/web/test/integration/connector-launch-honesty-ui.test.cjs` (assert honest copy)
- `apps/web/test/integration/connector-claim-consistency.test.cjs` (assert honest copy)
- `package.json` (2 new npm scripts)
- `scripts/run-increment-gates.cjs` (2 new gate steps)
- `.env.staging` (deprecation stub)
- `docs/decisions/ADR-007-json-attribute-blobs.md` (new)
- `docs/decisions/ADR-008-billing-operator-mediated.md` (new)
- `docs/decisions/ADR-009-smart-suggestions-rule-based.md` (new)
- `docs/decisions/ADR-010-oidc-opt-in-pilot.md` (new)
- `docs/execution/PO_SIGNOFF_CONTROLLED_PILOT_V4_2026-05-17.md` (new)
- `docs/execution/CURRENT_STATE.md` (V4 addendum)
- `docs/execution/INC-10_IDEMPOTENCY_DIAGNOSTIC_2026-05-17.md` (new)
- `docs/product/RELEASE_NOTES.md` (week of May 17)
- `CHANGELOG.md` (v0.9.0-pilot entry)

### Verification before commit

- `npm run lint --workspace @pim1/web` → 3 pre-existing errors only (actions.ts:22 conflict resolves on rebase)
- `npm run lint --workspace @pim1/api` → PASS
- `npm run build --workspace @pim1/api` → PASS
- `npm run test --workspace @pim1/web` → 112/109 passing (3 pre-existing worktree-base failures resolve on rebase)
- New gate step npm scripts resolve correctly (verified)

---

## Commit 3: OIDC admin IdP configuration UI + step-up auth scope

### Message

```
feat(admin+auth): OIDC IdP configuration UI with auth-config step-up scope

Adds /admin/auth-policy/oidc — the first self-serve admin surface for tenant
OIDC SSO configuration. Backend (INC-39) ships in PR #71; this commit makes
it usable without operator API access AND adds the step-up auth scope that
guards auth-config mutations.

Backend:
- New step-up scope STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK = "auth_config_high_risk"
  in apps/api/src/auth/jwt.ts. StepUpScope union expanded; isStepUpScope
  type-guard accepts both scopes.
- step-up.dto.ts @IsIn list accepts the new scope so /auth/step-up will mint
  tokens with it.
- @RequireStepUp(auth_config_high_risk, ...) + @UseGuards(StepUpGuard) applied
  to upsertConfig and deleteConfig on OidcController. Both endpoints now
  enforce admin role + step-up password proof + parent-session binding.

Web surfaces:
- New page /admin/auth-policy/oidc with current-status card, upsert form
  (issuer, clientId, clientSecret encrypted at rest, callbackUrl, scopes,
  claimsMapping JSON), and separate disconnect card.
- Both forms collect a stepUpPassword field. Server actions call
  issueStepUp({password, scope: "auth_config_high_risk"}) and pass the
  resulting token via x-pim-step-up-token header. Empty password triggers
  a clear inline error.
- Admin-role gated at the server action and at the controller. Non-admin
  viewers see a clear "Restricted" message.
- Status banners (oidc-saved, oidc-deleted, oidc-error) wired via query
  parameters in the standard pattern used by /admin/auth-policy.
- Linked from /admin/auth-policy and from /admin (admin hub).

API client:
- Three new functions in apps/web/src/lib/api/admin.ts targeting
  /auth/oidc-config: getOidcConfig, upsertOidcConfig, deleteOidcConfig.
  Accepts headers via existing ApiRequestOptions.headers field.

Contract test:
- apps/web/test/integration/admin-oidc-config-route-contract.test.cjs with
  16 assertions covering page composition, step-up password prompts (frontend),
  step-up scope declaration (backend jwt.ts), step-up DTO acceptance,
  controller decorator + StepUpGuard, server-action wiring, API client
  surface, navigation.

Pilot posture: ADR-010 amended same-day. OIDC moves from operator-mediated
to self-serve admin configuration. "OIDC enforced" remains forbidden per
PO V4 — that gate requires Gate C closure, not just this surface.

changelog: [Added] OIDC IdP configuration admin UI with step-up auth
changelog: [Added] auth_config_high_risk step-up scope
```

### Files

- `apps/api/src/auth/jwt.ts` (new constant + StepUpScope union + isStepUpScope guard)
- `apps/api/src/auth/dto/step-up.dto.ts` (@IsIn accepts new scope)
- `apps/api/src/auth/oidc.controller.ts` (decorator + UseGuards on 2 endpoints, plus imports)
- `apps/web/src/app/admin/auth-policy/oidc/page.tsx` (new — page with step-up prompts on both forms)
- `apps/web/src/app/admin/auth-policy/oidc/actions.ts` (new — issues step-up token, passes via header)
- `apps/web/src/lib/api/admin.ts` (3 new functions)
- `apps/web/src/app/admin/auth-policy/page.tsx` (link to new OIDC page)
- `apps/web/src/app/admin/page.tsx` (OIDC nav card)
- `apps/web/test/integration/admin-oidc-config-route-contract.test.cjs` (new, 16 assertions, passes)
- `apps/api/test/integration/auth-oidc-config-step-up.test.cjs` (new, runtime integration test, 9 validations, gated without allowFailure)
- `package.json` (additional named script: test:integration:auth-oidc-config-step-up)
- `scripts/run-increment-gates.cjs` (additional gate step: "Integration: OIDC config step-up")
- `docs/decisions/ADR-010-oidc-opt-in-pilot.md` (already in commit 2; amended in same sprint to reflect shipped state)

### Verification before commit

- New contract test executes successfully: `node apps/web/test/integration/admin-oidc-config-route-contract.test.cjs` returns `status: ok` with 12 validations
- No new lint errors introduced (web lint shows only the 3 pre-existing `actions.ts:22` conflicts)
- Auth-policy parent page link verified
- Admin hub nav verified

---

## Pre-commit checklist for each commit

For all three:

1. Confirm `git status --short` reflects only the files listed in that commit's "Files" section
2. Run `git diff --check` (no whitespace errors)
3. Run the validation listed in the commit's "Verification" section
4. Commit using HEREDOC to preserve formatting:

```bash
git commit -m "$(cat <<'EOF'
<message body>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

5. After commit, run `git status --short` to confirm only files for the NEXT commit remain modified or untracked.

## Post-commit checklist

1. Rebase onto current `main` to resolve the 3 pre-existing `actions.ts:22` lint errors and the 3 pre-existing web test failures (`auth-cookie-csrf`, `connector-install-form`, `operations-imports-route-contract`).
2. Re-run lint + test post-rebase. Expect zero failures.
3. Open three PRs (or one PR per logical commit, depending on team preference). Use the commit body as the PR description starting point.
4. Tag `v0.9.0-pilot` on the resulting main commit once all three land.

---

## Things NOT in any of these commits

These were considered and intentionally omitted:

- INC-10 fix — diagnostic memo only. Closure is a separate connector-lead ticket.
- Localization admin UI — out of P0/P1 scope for this pass.
- Self-serve billing — PO-deferred.
- Shopify dev-store recorded session — ENG-P2-5, connector-lead work.
- Tenant-level "require OIDC for all users" toggle — separate decision required (see amended ADR-010 closing note).

---

## Awaiting instruction

I have not staged or committed anything. This plan is a draft awaiting explicit go-ahead. To proceed, the user can say one of:

- "Commit all three" — I execute the three commits in order.
- "Commit only commit 1" (or 2, or 3) — I execute that one and skip the others.
- "Stage everything, don't commit" — I run `git add` for all 13+12 paths but stop before commit.
- "Hold" — I do nothing further. The work remains in the worktree for the user to inspect, modify, or commit manually.
