# Vexa PIM Access Policy Pending Backlog Single PO Prompt - 2026-04-27

## 2026-04-30 Release Closeout Context

The current bounded access-policy release slice is now fully validated and can be treated as complete for release closeout. The remaining items in this prompt are future-scope follow-up work, not active blockers for the closed bounded slice tracked under `INC-24`.

Future-scope follow-up themes:

- broader vendor enforcement outside the already proven product-backed read routes
- unsupported ABAC dimensions:
  - `supplier`
  - `locale`
  - `market`
  - `team`
  - `assignee`
- broader multi-role rollout and role-combination policy beyond the bounded compatibility and managed-write contract
- broader API-client resource coverage beyond the proven bounded scope families
- remaining mixed-lifecycle admin-boundary mapping
- universal response redaction

Keep ONDC out of active blockers while disabled.

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

Continue in dependency order, not just whichever route family was touched last. Execute the next safe bounded slice that removes the highest real blocker on the critical path to ownership-safe enterprise authorization, then stop and report exact remaining items.

1. broader sensitive `GET` hardening
2. `AccessPolicyService` shadow-mode follow-through on newly covered routes
3. field-level read and write policy expansion
4. scope authorization infrastructure and phased enforcement for supported models only
5. import, export, bulk, and connector policy enforcement follow-through
6. API-client principal model
7. multi-role migration foundation
8. Product Admin boundary validation
9. final admin and scoped-role maturity planning only after enforcement gates pass

Treat the list above as a dependency queue, not a treadmill. If a nominally earlier item is no longer the critical path, or if a later foundation item is required to unblock blocked roles such as `category_manager` or `vendor`, prefer the prerequisite foundation work. Do not keep taking another narrow route-annotation slice once ownership, machine-principal, multi-role, or redaction foundations have become the real blocker.

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
  - `team`
  - `assignee`
- covered product-backed resources now fail closed if an actor carries unsupported or mixed foundation scope dimensions that the current resource model cannot prove
- `catalog` is now genuinely enforced only on the Shopify connector publication-target surface; do not claim broader catalog-scope support outside that bounded route family without explicit proof
- API-client principal separation from human users is stronger because API keys are now default-denied unless a route explicitly opts into API-client access, and the catalog API family now requires explicit matching machine-principal scopes, but full machine-principal permission and scope modeling is still pending for the rest of the API surface
- connector-management writes are now blocked for `viewer` and `reviewer`, the covered connector workspace is now human-only, and the covered bulk-import and bulk-edit route families are now human-only, but full connector, bulk, import, and export policy maturity plus machine-principal modeling is still pending
- multi-role helper foundation and admin-boundary helper foundation now exist, but storage rollout and route-level maturity are still pending
- `category_manager` and `vendor` remain blocked until ownership and object-scope enforcement are implemented and tested

When selecting the next bounded slice, start from the first blocker that is still on the critical path to removing a real remaining blocker. Do not default to another admin-boundary route pass if ownership or object-scope enforcement is now the real blocker.

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
> - Future scope dimensions are representable: `vendor`, `owner`, `supplier`, `locale`, `market`, `catalog`, `team`, and `assignee`. Covered product-backed resources fail closed when unsupported dimensions are present without provable enforcement context, and `catalog` is now genuinely enforced only on the Shopify connector publication-target surface.
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

## Current Blocker Snapshot After The Latest Validated Pass

- authenticated-read classification is enforced in CI/gates and at runtime
- explicit API-client scope enforcement is real on the covered catalog API family
- explicit API-client scope enforcement is now also real on the bounded media read family through `media.read`
- explicit API-client scope enforcement is now also real on bounded:
  - compliance product-issue reads through `compliance.read`
  - rejection-intelligence score reads through `rejection_intelligence.read`
  - auto-suggestions title, attribute-enrichment, and category-suggestion reads through `auto_suggestions.read`
- future scope dimensions are representable, fail closed on covered product-backed resources, and `catalog` is genuinely enforced on Shopify publication targets
- representative live admin-boundary enforcement now exists for:
  - workspace user governance
  - workspace access-scope governance
  - API-key governance
  - connector-permission governance
  - outbound-webhook governance

What still remains blocked:

1. broader admin-boundary route mapping across the remaining admin, settings, billing, connector, dashboard, and operational governance routes that are still outside the already covered representative, billing-governance, dashboard-governance, metrics-governance, audit-governance, outbound-webhook-governance, and connector-permission-governance surfaces
2. persistent multi-role storage rollout beyond the current local-auth and JWT bridge
3. broader machine-principal permission and scope modeling beyond the covered catalog API family
4. real allow-and-deny enforcement for `vendor`, `owner`, `supplier`, `locale`, `market`, `team`, and `assignee`
5. broader shared payload redaction across more sensitive response families
6. continue re-evaluating `category_manager` and `vendor` from the new baseline:
  - `category_manager` is partially unblocked only on proven category-scoped catalog and taxonomy surfaces
  - `owner` is now partially enforced on marketplace mapping-template resources that persist `createdBy`; preserve that bounded ownership enforcement and expand only where resource ownership is equally provable
  - `vendor` remains blocked until vendor/object-scope enforcement is proven

For the next pass:

- retire the old default that kept choosing another admin-boundary slice simply because that pattern was already green
- preserve the broader admin-boundary route mapping that is now validated for:
  - billing governance
  - billing plan-tier governance boundary
  - dashboard governance
  - metrics governance
  - audit governance
  - outbound-webhook governance
  - connector-permission governance
  - compliance-rule governance
  - marketplace export and simulation governance
  - marketplace readiness and mapping-preflight governance
  - taxonomy category and attribute-definition governance
- use the next bounded slice to attack the current critical path:
- first preference: continue ownership and object-scope enforcement from the current category-scoped foundation state
  - preserve the actor-specific scope activation fix
  - preserve the partial safe unblocking of `category_manager` on category-scoped catalog and taxonomy surfaces
  - preserve the bounded owner-scope enforcement now validated for marketplace mapping templates with category/channel intersection plus owned-resource filtering
  - preserve the bounded vendor/object ownership enforcement now validated on the canonical catalog read family through `Product.vendorScopeKey`
  - preserve the adjacent bounded vendor/object ownership enforcement now validated on `GET /compliance/products/:id/issues`
  - preserve the shared governance provenance redaction now validated on:
    - `GET /admin/workspace/users`
    - `GET /admin/workspace/access-scopes`
    - `GET /admin/api-keys`
    - `GET /connectors/permissions`
    - `GET /admin/webhooks`
  - keep those governance payloads redacted for `system_admin` provenance fields unless a later validated slice proves a narrower visibility model is needed
  - keep vendor writes, taxonomy access, and all other non-proven vendor surfaces fail-closed until equivalent object proof exists there too
  - second preference: broader machine-principal permission and scope coverage where those routes are needed for real API-client usage
  - third preference: persistent multi-role storage rollout only after the ownership and machine-principal path is no longer blocked on current data shape
- only continue another admin-boundary route-mapping slice when it is directly adjacent to the current implementation and still blocks a real acceptance path
- preserve the current delegated-scope admin compatibility path for access-scope mutations until persistent multi-role rollout is ready
- do not claim Product Admin or System Admin maturity beyond the representative routes already validated

ONDC status:

- ONDC is disabled by default because `FEATURE_ONDC_ENABLED` defaults false.
- `OndcModule` is only mounted when the feature flag is enabled.
- ONDC is not part of the current access-policy execution backlog.
- Do not treat ONDC routes as active blockers while the module remains disabled.
- If ONDC is enabled later, open a separate ONDC access-policy slice before release.

Latest bounded vendor-foundation truth:

- vendor is no longer universally blocked
- vendor is now only proven safe on:
  - `GET /catalog/products`
  - `GET /catalog/products/search`
  - `GET /catalog/products/:id`
  - `GET /catalog/products/:id/variants`
  - `GET /compliance/products/:id/issues`
  - `GET /auto-suggestions/products/:id/title-suggestion`
  - `GET /auto-suggestions/products/:id/attribute-enrichment`
  - `GET /auto-suggestions/products/:id/category-suggestion`
  - `GET /rejection-intelligence/products/:id/score`
  - `GET /media/assets`
  - `GET /media/assets/:id`
  - `GET /media/assets/:id/validation`
- vendor writes remain blocked
- vendor taxonomy and governance surfaces remain blocked
- broader vendor rollout still requires additional trustworthy object ownership proof

Latest bounded shared-redaction truth:

- shared central redaction is no longer limited to catalog, dashboard, and notifications
- the following governance reads now centrally redact either provenance fields like `createdBy`, bounded delivery failure detail, billing-governance detail, or audit explorer metadata for `system_admin` while preserving full visibility for `super_admin` and legacy `admin`:
  - `GET /admin/workspace/users`
  - `GET /admin/workspace/access-scopes`
  - `GET /admin/api-keys`
  - `GET /connectors/permissions`
  - `GET /admin/webhooks`
  - `GET /admin/webhooks/deliveries`
  - `GET /audit/logs`
  - `GET /audit/events`
  - `GET /audit/events/export`
  - `GET /billing/plan-profile`
  - `GET /billing/upgrade-request`
- `GET /audit/events` and `GET /audit/events/export` now share one visibility decision so CSV export cannot bypass the JSON redaction contract
- universal response redaction is still not complete

Latest bounded machine-principal truth:

- API-client scope coverage is no longer only catalog-scoped
- the following API-client scope families are now proven:
  - `compliance.read`
  - `catalog.read`
  - `catalog.write`
  - `media.read`
  - `rejection_intelligence.read`
  - `auto_suggestions.read`
  - `taxonomy.read`
- `media.read` is only proven on:
  - `GET /media/assets`
  - `GET /media/assets/:id`
  - `GET /media/assets/:id/validation`
- `compliance.read` is only proven on:
  - `GET /compliance/products/:id/issues`
- `rejection_intelligence.read` is only proven on:
  - `GET /rejection-intelligence/products/:id/score`
- `auto_suggestions.read` is only proven on:
  - `GET /auto-suggestions/products/:id/title-suggestion`
  - `GET /auto-suggestions/products/:id/attribute-enrichment`
  - `GET /auto-suggestions/products/:id/category-suggestion`
- `taxonomy.read` is only proven on:
  - `GET /taxonomy/categories`
  - `GET /taxonomy/categories/:id`
  - `GET /taxonomy/categories/:id/attributes`
- API clients without `media.read` remain denied on those routes
- API clients without the exact matching scope remain denied on the newly covered compliance, rejection-intelligence, and auto-suggestions reads
- API clients without `taxonomy.read` remain denied on the taxonomy metadata family
- broader machine-principal resource coverage still requires additional explicit scope vocabulary and route-family proof

Latest multi-role persistence truth:

- JWT claims and local identity fixtures already support `assignedRoles`
- DB-backed auth now has additive persisted read-path support:
  - `AuthIdentity` stores scalar `role` plus additive `assigned_roles`
  - DB auth resolution reads `assigned_roles` when present
  - DB auth still falls back to scalar `role` when `assigned_roles` is empty
  - invalid persisted assigned-role strings normalize away instead of escalating privilege
- local identity-directory auth now has the same bounded bridge behavior proven:
  - local auth JWTs carry normalized `assignedRoles`
  - invalid local assigned-role strings normalize away instead of escalating privilege
  - scalar-only local identities still behave as legacy single-role users
- workspace-user governance reads now expose normalized persisted `assignedRoles` alongside scalar `role`
- workspace-user create and role-update now support additive persisted `assignedRoles`
- workspace-user role updates preserve existing `assignedRoles` when the field is omitted and the preserved set remains compatible with the next scalar role
- managed workspace-user writes reject duplicate `assignedRoles` instead of silently rewriting them
- managed workspace-user writes now use a bounded single-role-set contract:
  - at most one assigned role can be managed through workspace-user create or update
  - only `reviewer`, `editor`, `product_admin`, and `system_admin` are supported on managed writes
  - `product_admin` and `system_admin` require scalar `role = admin`
  - unsupported managed-write roles such as `super_admin`, `category_manager`, and `vendor` stay rejected
- explicit `assignedRoles: []` clears the persisted role set and the next login falls back to scalar-only compatibility
- invalid assigned-role values are rejected at the DTO/service boundary instead of being stored
- workspace-user assigned-role writes are now proven durable through later login:
  - created users can log in with their persisted assigned roles
  - later role and assigned-role updates change the next JWT claims
  - removing an assigned editor role removes the later editor-capable read path
- one more durable auth-lifecycle seam is now proven:
  - a workspace-user-created identity with scalar `viewer` plus persisted `assignedRoles: ["editor"]` keeps that assigned-role bridge through direct login
  - issued step-up JWTs retain the normalized assigned-role set
  - password-reset confirm preserves the later assigned-role login and editor-capable route decision
- one more bounded governance-boundary seam is now proven:
  - scalar `admin` remains the compatibility role field
  - persisted assigned roles are additive inputs to governance-boundary evaluation
  - DB-auth and local-auth both now prove that `assignedRoles: ["system_admin"]` crosses `manage_security` governance reads
  - DB-auth and local-auth both now prove that `assignedRoles: ["product_admin"]` does not escalate into `manage_security` governance reads
- backfill, fallback, and rollback-safe compatibility are now bounded and explicit:
  - the migration backfill contract remains additive and non-destructive: legacy rows keep scalar `role`, while empty or missing `assigned_roles` behave like scalar-only users
  - DB-auth proves that persisted duplicate role arrays normalize safely instead of duplicating effective access
  - DB-auth proves that setting `assigned_roles` to `NULL` falls back to scalar-only compatibility rather than escalating privilege
  - local-auth proves that duplicate arrays normalize safely and `assignedRoles: null` behaves like a scalar-only legacy identity
  - the checked-in rollout script and runbook now define the bounded operator contract:
    - backfill writes only scalar singleton app roles into `assigned_roles` when the current value is `NULL` or `[]`
    - invalid scalar roles are skipped
    - pre-existing non-empty assigned-role rows are preserved
    - rollback only clears scalar-singleton rows that match the bounded backfill shape
- what is still missing for full multi-role maturity:
  - broader workspace-user multi-role UX/API management is still not rolled out beyond the bounded admin create/update contract
  - no live production backfill or rollback execution evidence yet
  - do not remove scalar `role` until a separately validated rollout covers write APIs, fallback, and rollback

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
