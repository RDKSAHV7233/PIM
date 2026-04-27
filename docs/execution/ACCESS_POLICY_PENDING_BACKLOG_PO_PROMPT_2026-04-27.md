# Vexa PIM Access Policy Pending Backlog Single PO Prompt - 2026-04-27

Use this prompt when you want a coding agent to continue the remaining Vexa PIM access-policy backlog as a Product Owner, one item at a time, without overclaiming completion and without reopening already validated slices.

## PO Mission

Execute the remaining Vexa PIM access-policy backlog in bounded autonomous mode inside the real application repository.

The agent must:

- work in the real app source, not docs only
- obey `AGENTS.md`
- obey `docs/execution/INCREMENT_STATE.json`
- preserve completed and locked work unless regression evidence exists
- keep legacy RBAC authoritative until policy shadow-mode parity is proven
- prefer secure defaults when product intent is ambiguous
- update execution evidence after each completed bounded milestone

## Already Verified

Do not rebuild or relitigate these unless a regression is proven:

- stale-token rejection after later lock or deactivation
- workflow content locking
- denial audit logging with sanitized metadata
- sensitive submission-read hardening
- access-policy shadow-mode foundation under legacy RBAC authority
- delegated-access enforcement for supported scope dimensions:
  - category
  - brand
  - channel
  - connector account
- covered catalog read redaction for sensitive pricing and inventory fields
- legacy `/products/:id` alias actor-aware scope and redaction enforcement
- increment and sprint gate wiring for the current access-policy suites

## Remaining Backlog In Required Order

Continue in this order. Execute only the next safe bounded slice that can be completed with code and tests in the current pass, then stop and report exact remaining items.

1. broader sensitive `GET` hardening
2. `AccessPolicyService` shadow-mode follow-through on newly covered routes
3. field-level read and write policy expansion
4. scope authorization infrastructure and phased enforcement for supported models only
5. import, export, bulk, and connector policy enforcement follow-through
6. API-client principal model
7. multi-role migration foundation
8. Product Admin boundary validation
9. final admin and scoped-role maturity planning only after enforcement gates pass

Treat the list above as a queue. Do not skip ahead because a later item looks easier. If the current item is too large to finish safely, take the smallest secure sub-slice inside that current item, implement it, test it, and record the residual gap before moving on in a later pass.

## Current Blocker Snapshot

As of the latest validated slice, the highest-priority blockers still include:

- runtime enforcement for unclassified authenticated reads is already in place and must not be weakened; future passes should preserve it while working the remaining machine-principal, scope-enforcement, multi-role, admin-boundary, and redaction blockers
- universal central read-time redaction outside the covered catalog product and variant paths, covered catalog stats and catalog search outputs, covered `dashboard/health` aggregate response, and covered notifications metadata still remains incomplete
- future delegated scope dimensions are now representable and safely rejected, but actual enforcement is still pending for:
  - `vendor`
  - `owner`
  - `supplier`
  - `locale`
  - `market`
  - `catalog`
  - `team`
  - `assignee`
- API-client principal separation from human users is stronger because API keys are now default-denied unless a route explicitly opts into API-client access, and the catalog API family now requires explicit matching machine-principal scopes, but full machine-principal permission and scope modeling is still pending for the rest of the API surface
- connector-management writes are now blocked for `viewer` and `reviewer`, the covered connector workspace is now human-only, and the covered bulk-import and bulk-edit route families are now human-only, but full connector, bulk, import, and export policy maturity plus machine-principal modeling is still pending
- multi-role helper foundation and admin-boundary helper foundation now exist, but storage rollout and route-level maturity are still pending
- `category_manager` and `vendor` remain blocked until ownership and object-scope enforcement are implemented and tested

When selecting the next bounded slice, start from the first blocker still inside the first backlog item unless regression evidence requires otherwise.

## Hard Product Rules

- Do not introduce or enable `category_manager` or `vendor` roles until object scope and ownership enforcement are implemented and tested.
- Do not split full SaaS admin roles until policy engine, scope model, and multi-role migration are validated.
- Export is separate from view permission.
- Approved, published, archived, and locked records are not directly editable.
- Editor cannot approve their own changes in strict mode.
- Product Admin cannot manage users or security.
- System Admin cannot edit product data unless separately assigned a product role.
- API clients cannot inherit human admin permissions.
- Super Admin is Vexa-internal only.
- Support access must be time-bound, reason-coded, audited, and revocable.

## Required Working Pattern

1. Inspect current repo state and existing in-flight changes.
2. Confirm what is already implemented and what is still pending.
3. Write down the exact file scope before editing.
4. Implement only the next bounded missing slice from the current backlog item.
5. Run focused tests immediately after the change.
6. If the slice passes, run the repo validation bundle required for this backlog.
7. Update execution evidence and PO checkpoint using only real command results.
8. Update `INCREMENT_STATE.json` only if a matching unlocked story actually exists and acceptance is met.
9. When validation commands share `apps/api/dist` or `apps/web/.next`, run them sequentially instead of in parallel so artifact races do not create false regressions.

## Escalated Prompt To Reuse

Use the following prompt body verbatim when continuing the backlog from the current foundation state:

> You are working in the Vexa PIM monorepo. Continue from the current access-policy foundation state and fix the remaining authorization blockers without regressing the already validated policy-foundation work.
> 
> Context from the last validated pass:
> - Authenticated-read classification metadata now exists and is mechanically checked by CI and gates.
> - API-client routes now default-deny unless explicitly opted into `allowed_with_api_scope`.
> - Future scope dimensions are representable: `vendor`, `owner`, `supplier`, `locale`, `market`, `catalog`, `team`, and `assignee`, but are currently safely rejected until enforcement exists.
> - Deterministic multi-role and admin-boundary helper foundations exist.
> - Global read-policy and redaction infrastructure exists and has been extended beyond catalog and dashboard into notifications.
> - `category_manager` and `vendor` remain blocked because ownership and object-scope enforcement is not proven.
> - The worktree may already contain in-flight access-policy edits; preserve existing validated behavior and avoid broad rewrites.
> 
> Respect `AGENTS.md` and `docs/execution/INCREMENT_STATE.json`.
> Do not reopen or rewrite validated slices unless you have regression proof with the failing command, failing output snippet, and likely file path.
> Legacy RBAC remains authoritative until shadow-mode parity is proven.
> 
> Goal:
> Move the system from “policy foundation implemented, rollout pending” to “runtime-enforced authorization maturity sufficient to unblock `category_manager` and `vendor` where proven safe.”
> 
> Execute the remaining blockers in this order:
> 1. runtime classification-required enforcement
> 2. full API-client permission and scope model
> 3. enforce object and scope dimensions
> 4. multi-role storage rollout
> 5. admin-boundary route enforcement
> 6. broader reusable payload redaction
> 7. re-evaluate `category_manager` and `vendor`
> 
> For the current pass, identify the first still-pending item in that list and implement only the next safe bounded sub-slice inside it unless the whole item can be completed safely with code and tests in the same pass.
> 
> Required behavior:
> - fail closed whenever route classification, API-client scope, object ownership, or scope context is ambiguous
> - do not allow API keys through human-role fallback
> - do not mark future scope dimensions as supported unless enforcement is proven
> - do not introduce persistent schema fields without migration or rollout safety
> - do not scatter redaction logic if the shared read-policy path can enforce it
> 
> Before editing:
> - inspect current repo state
> - state the exact file scope
> - explain why the next step is different from the previous pass
> 
> After implementation:
> - run focused tests immediately
> - then run the required validation bundle sequentially for any commands that share `apps/api/dist` or `apps/web/.next`
> - update `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
> - update `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
> - update this prompt file if the blocker queue materially changes
> 
> Do not claim:
> - full enterprise authorization readiness
> - unsupported scope completion
> - universal read-time redaction completion
> - API-client principal separation completion
> - multi-role rollout completion
> - Product Admin or System Admin maturity completion
> unless code, tests, and validation explicitly prove it.

## Required Validation Bundle

Run the closest available equivalents. At minimum attempt:

- `npm run build --workspace @pim1/api`
- `npm run build --workspace @pim1/web`
- `npm run test:integration:access-policy-remediation`
- `npm run test:integration:delegated-access-scopes`
- `npm run gate:run:increment`
- `npm run gate:run:sprint`
- `node scripts/validate-deploy-staging-workflow.cjs`
- `node scripts/staging-postdeploy-check.test.cjs`

If safe staging credentials are already present as environment variables only, also run staging post-deploy smoke with `STAGING_VALIDATE_NON_ADMIN=true`.

## Truthfulness Rule

Do not claim:

- full enterprise authorization readiness
- unsupported scope completion
- universal read-time redaction completion
- API-client principal separation completion
- multi-role migration completion
- Product Admin or System Admin maturity completion

Use exact claim wording only from validated evidence.

## Final Report Requirements

Always report:

- changed files
- commands run
- pass or fail results
- PO acceptance:
  - accepted scope
  - not accepted as complete
  - exact product claim wording
- remaining blockers
- `INCREMENT_STATE.json` lock updates, or explicit statement that none were made
- git status
