# Decision record: mapping journey PO / CTO rulings (2026-09-30)

Status: **PROPOSED, not ratified.** Prepared by the assistant at the user's request ("continue as PO and CTO + Vexa team experts") after the scratch-stack QA run (`docs/qa/mapping-journey-scratch-stack-qa-run-2026-09-30.md`). It continues `DR-2026-09-30-mapping-journey-followups.md` (D1-D7). Acting in a PO / CTO lens is not an approval by any person, and no `cto-required-team-approved` label has been applied. A named human should ratify or overturn each ruling below.

Ratified by: ______  Date: ______

## D8. Review step: readiness evaluations are refused for every non-admin role

- Finding (verified on a local API, 2026-09-30, identities with no assigned admin-boundary role): `POST .../publish-readiness` and `POST .../mappings/preflight` return `403 ACCESS_POLICY_DENIED / ADMIN_BOUNDARY_FORBIDDEN` for editor, channel_manager, publisher, approver, connector_admin, reviewer and viewer. Only `admin` passes (via the legacy fallback). The same roles that may validate and publish mapping versions (`editor`, `channel_manager`) therefore cannot see readiness, and because the wizard's review step called both endpoints unconditionally, the whole review step (the only place with Validate / Publish) was unusable for them.
- The gate is deliberate, not a typo: `@AdminBoundaryAccess({ capability: "manage_product_data" })` on both routes; `access-policy.service.spec.ts` states "boundary gate wins over requiredRoles" (issue #894); `access-policy-remediation.test.cjs` pins product_admin allowed / system_admin denied; `scripts/validate-sensitive-get-policy.cjs` lists both routes. `product_admin` can only be assigned to base-role `admin` users, so an editor or channel manager cannot obtain it.
- The documents disagreed with the enforcement: `docs/security/rbac-permissions-matrix.md` (last updated 2026-05-26, `@Roles()` only) says readiness is R for every role and mappings are W for channel_manager; a controller comment repeated that. Corrected in this change (matrix section 2a, comment).
- Options: (a) widen the two routes so the roles in `@Roles()` pass; (b) keep the gate and make the wizard degrade; (c) let non-admin base roles hold `product_admin`.
- **Decision: (b).** Web only, no authorization change. The page tolerates a permission refusal on exactly those two calls, keeps the versions list and Validate / Publish actions, and shows "Readiness checks are not available for your role" (product exports stay blocked until readiness passes, regardless). This follows the product detail page, which already degrades the same way. Any other error, including 401 and a suspended tenant, behaves as before.
- Why not (a)/(c): they change an access-control gate that a security workstream pinned with tests. That belongs to the security / access-policy owner, not to the mapping team. **Open question for that owner:** should the two evaluation routes be readable by the roles that can already publish mappings (and, per the matrix, by every role for readiness)? Evidence and the role table are in matrix section 2a.
- Limits: verified against the local scratch API and CI identities only. How production channel managers and editors are configured was **not** checked; real workspaces whose users are all base-role `admin` will not see the notice.
- Revisit if: the security owner widens the routes (then delete the notice), or customers report that editors need readiness detail.

## D9. DEF-27: a "Blocked" compatibility draft can be validated and published

- Finding (verified on a local API, 2026-09-30): validate accepts a Blocked draft (201) and publish accepts it (201). Rolling back to a Blocked source is refused (409 `rollback_source_blocked`, `connector-mapping.service.ts`). Readiness raises `mapping_compatibility_blocked`, which hard-blocks product exports for that scope.
- Options: (a) keep; (b) refuse to publish a Blocked version; (c) keep, but warn at publish time.
- **Decision: (a) now, (c) as a follow-up story.** Publishing a version with blockers is intentional and specified (`channels-mapping-publish-complex-blockers.spec.js` publishes a `remap_required` version); step-up re-authentication already guards the action; and the refusal on rollback is consistent (it stops *restoring* a known-bad version, not a deliberate new publish). A server gate on compatibility is a connector-workflow change for the required team.
- Follow-up story (not built): on a Blocked version's Publish panel, warn that publishing it makes it the live version for the scope and stops product exports there until it is replaced.
- Revisit if: an operator publishes a Blocked version by mistake in a pilot tenant.

## D10. Archive is offered to roles the API will refuse

- Finding: the version row shows Archive to editors and channel managers (the web gate is `canManageChannels`), but `POST .../archive` is `@Roles("admin")` behind the boundary gate; verified on a local API: an editor with a valid step-up token gets `403 ADMIN_BOUNDARY_FORBIDDEN`. From the code, the server action's error path is not a step-up error, so it rethrows and the operator should land on the generic error page; that last step was **not click-tested**.
- **Decision: schedule a small web story** to offer Archive only to admin (add a capability helper next to `canManageChannels`), plus a test. Not done in this change because the runtime symptom was not reproduced.

## D11. E2E: the fourth `channels-mapping-publish.spec.js` test trips the API throttle when the file runs whole

- Finding: the API allows 300 requests per minute per user (`ThrottlerModule`, `app.module.ts`); the first three scenarios and their server-rendered page calls use it up. The test passes alone. A retry-with-backoff helper and wider poll windows did not fix it and were reverted (#1014).
- **Decision: do not weaken the production throttle.** If the suite must run whole, prefer splitting the file or adding a cool-down; relaxing the limit only for the Playwright API is an API change for the API owner.

## Updates to the earlier record (D1-D7)

- **D5 (DEF-25, login redirect target):** the scratch run found DEF-26 (a wrong step-up password was treated as an expired session and redirected to login; fixed in #1011). It is a plausible cause of the odd `login?next=%2Fdashboard` seen in production but is **not confirmed**. Keep D5 open pending a runtime trace.
- **D7 (remaining QA plan):** run on a local scratch stack instead (API cases for all eight roles, step-up, publish, rollback, archive; UI cases for double-save, step-up, viewer denial). Not covered: cross-tenant isolation, mid-session expiry, other browsers, screen readers, concurrent users. Archive and rollback were not exercised through the UI.
- **D6 (production hygiene):** unchanged; owner actions, not code.
