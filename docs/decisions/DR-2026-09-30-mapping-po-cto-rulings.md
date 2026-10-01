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

**Status: OPEN. Two positions conflict; no API change has been made.**

- Finding (verified on a local API, 2026-09-30): validate accepts a Blocked draft (201) and publish accepts it (201). Rolling back to a Blocked source is refused (409 `rollback_source_blocked`, `connector-mapping.service.ts`). Readiness raises `mapping_compatibility_blocked`, which hard-blocks product exports for that scope.
- **Position A (review input): an invariant mismatch.** `Blocked` is a hard compatibility state, so publish must not make it live: readiness says HARD BLOCK while publish says 201, and rollback already refuses the same state. Enforce at the API (409 on publish of a Blocked version), for every caller.
- **Position B (existing tested design): publishing a Blocked mapping is how a category is declared unsupported.** `apps/api/test/integration/connector-mapping-bulk-coverage.test.cjs`, Test 9 ("blocked category does not contaminate siblings"), deliberately validates **and publishes** a Blocked version, then asserts that preflight for that category fails with `mapping_compatibility_blocked` while sibling categories stay compatible. Read that way, the hard readiness block is the intended **effect** of the publish, not a disagreement with it; and rollback refusing a Blocked source is a different act (restoring a prior version, not a fresh deliberate publish). This was missed when D9 was first drafted and again when it was corrected, because the test was not read before the decision.
- What enforcing Position A would take: change or remove Test 9, and provide another explicit way to declare a category blocked for a connector. It would also change behavior for any tenant that already relies on publishing Blocked mappings; that was **not** checked in production.
- Not affected either way: publishing a `remap_required` version or any version with readiness blockers stays allowed and specified (`channels-mapping-publish-complex-blockers.spec.js`).
- **Needs a named decision** between (1) keep publish-of-Blocked as a feature and add a publish-time warning that it makes the version live for the scope and stops exports there, or (2) refuse it at the API and add an explicit alternative. Assistant's recommendation: (1), because it is tested intent and (2) removes a capability without a replacement; but the trade-off is the owner's.
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

## Review input received (pasted by the user on 2026-09-30; the author is not named, so this is **not** a recorded ratification)

- **D8:** interim UI degradation acceptable; long-term policy direction: read-only readiness/preflight evaluation should be available to any role authorized to validate/publish the same mapping, unless the response carries genuinely admin-only information. If the current response exposes sensitive diagnostics, do not broaden the admin endpoint wholesale; return a sanitized evaluation (ready/blocked, blocking reasons, warnings, mapping/schema compatibility, required remediation; no credentials, tenant-administration detail or privileged diagnostics). This PR's degradation should not become the final UX. Follow-up (not built): a sanitized evaluation for editor / channel_manager; needs the access-policy owner.
- **D9:** do not keep as is; enforce at the API. (Conflicts with existing Test 9, which publishes a Blocked version on purpose; D9 above is therefore left OPEN for a named decision.)
- **D10:** ratify. Hide Archive for roles the API refuses; keep the API 403 as the enforcement boundary; do not change API authorization.
- **D11:** ratify. Do not weaken the production throttle.
- **Production items:** do not archive the WooCommerce "Aa" Versions 1-3 without an explicit instruction, and first confirm none is published or referenced by an active mapping. Trace DEF-25 read-only at runtime (request/response, server logs or correlation id) before any code change.
- Next execution order: amend D9 here (done), let this PR's CI/review finish, fix D9 as a narrow API invariant defect, fix D10 in the web UI, trace DEF-25 read-only.
