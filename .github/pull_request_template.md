## Scope
- Primary change:
- Explicit file or subsystem scope:
- What is intentionally out of scope:

## Risk
- Product/user impact:
- Security, tenant, auth, deploy, or data risk:
- If this PR crosses multiple risk domains, why it should not be split:

## Verification
- Commands run:
- CI or staging evidence:
- Known gaps or follow-up PRs:

## Feature Completion Checklist
_Skip items that are not applicable to this PR. Every unchecked item needs a reason._

### API Layer
- [ ] Controller endpoint exists with correct route and HTTP method
- [ ] `@Roles()` decorator lists the intended roles (list them: ___________)
- [ ] `@RequirePlanLimit()` decorator present if this consumes a billable resource (skus/submissions/users/storage/connectors)
- [ ] Validation DTO with class-validator decorators on the request body
- [ ] All queries use `prisma.tenant(key)`, not raw unscoped queries
- [ ] Audit log entry on mutations (verify no sensitive fields in metadata)
- [ ] Error responses use structured error codes, not plain strings

### UI Layer
- [ ] Page/component renders the feature
- [ ] Error states handled: API down, 403, 404, 402 (plan limit), network timeout
- [ ] Empty state handled (zero items, first-time user)
- [ ] Loading state present (skeleton or spinner, not blank)
- [ ] All API error codes have human-readable messages in the UI
- [ ] Mobile viewport does not break (`min-w-0`, `break-words` where needed)

### Wiring Verification
- [ ] UI calls the correct API endpoint (not a stale or wrong path)
- [ ] API error codes match what the UI expects (same string, same HTTP status)
- [ ] Role assumed by UI matches `@Roles()` on the API endpoint
- [ ] If plan-limited: resource label exists in `PlanLimitModal.normalizeResourceLabel()`

### Test Layer
- [ ] API integration test covers happy path + at least one error path
- [ ] Web route-contract test verifies page returns 200 for a permitted role
- [ ] RBAC: at least one unpermitted role returns 403
- [ ] If billable: plan-limit test at boundary (current = limit, then +1)

## Reviewability
- [ ] This PR is focused enough to review safely.
- [ ] New behavior has tests or a documented reason why it does not.
- [ ] Locked-story or increment edits include regression evidence when required.
- [ ] Large PRs have explicit CTO approval and the `cto-large-pr-approved` label.
- [ ] Security, tenant-boundary, auth/session, workflow, migration, or WooCommerce/Shopify connector changes have required-team approval and the `cto-required-team-approved` label.
