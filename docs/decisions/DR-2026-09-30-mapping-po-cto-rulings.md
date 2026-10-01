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

## D9. DEF-27: a "Blocked" compatibility mapping can be validated and published

**Decision (second review input, 2026-10-01): KEEP the current behavior. This is not an API defect.**

- Semantics, now recorded: `Blocked` is a **publishable compatibility declaration** used to make the applicable category/channel scope not ready for publication ("this category is deliberately unsupported"). It is not an invalid state transition and it is not "this mapping version is invalid and must never be published".
- Evidence (verified on a local API, 2026-09-30): validate accepts a Blocked draft (201) and publish accepts it (201); readiness then raises `mapping_compatibility_blocked`, which hard-blocks product exports for that scope; sibling categories stay compatible. This is the tested design: `apps/api/test/integration/connector-mapping-bulk-coverage.test.cjs`, Test 9 ("blocked category does not contaminate siblings"), validates and publishes a Blocked version on purpose and asserts that effect.
- Invariant that must keep holding: **rollback to a Blocked source stays refused** (409 `rollback_source_blocked`, `connector-mapping.service.ts`, covered by `connector-mapping.service.spec.ts`). Restoring a prior version is a different act from a deliberate new publish.
- Not affected: publishing a `remap_required` version or any version with readiness blockers stays allowed (`channels-mapping-publish-complex-blockers.spec.js`).
- Superseded: the first review input (enforce a 409 on publish of a Blocked version) is **withdrawn** in light of Test 9. No API change was made at any point.
- **Follow-up story (not built): publish-time warning.** Publishing a Blocked version has a strong operational consequence, so the Publish panel for a version whose compatibility is Blocked should say that publishing it makes the affected category unavailable / not ready for product publishing in that scope until another version replaces it. The warning explains; it must not prevent the action.
- Process note: this decision was first drafted, then corrected, before anyone had read Test 9. Read the existing tests for a behavior before ruling that it is a defect.
- Revisit if: an operator publishes a Blocked version by mistake in a pilot tenant (then consider a stronger confirmation, still not a block).

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
- **D9:** do not keep as is; enforce at the API. **Withdrawn** by the second review input below, after Test 9 showed that publishing a Blocked version is intended.
- **D10:** ratify. Hide Archive for roles the API refuses; keep the API 403 as the enforcement boundary; do not change API authorization.
- **D11:** ratify. Do not weaken the production throttle.
- **Production items:** do not archive the WooCommerce "Aa" Versions 1-3 without an explicit instruction, and first confirm none is published or referenced by an active mapping. Trace DEF-25 read-only at runtime (request/response, server logs or correlation id) before any code change.
- Next execution order (superseded by the second review input below): amend D9, let CI finish, fix D9 as an API defect, fix D10, trace DEF-25.

## Second review input (pasted by the user on 2026-10-01; author not named, so again **not** a recorded ratification)

- **D8:** keep #1015's graceful degradation for now; long term, roles allowed to publish should receive a sanitized readiness/preflight result. Do not rush into changing the admin-boundary policy: first define the sanitized response contract (below). Core invariant: *can validate/publish a mapping, therefore can see enough readiness/preflight information to make that action safely, but does not gain admin-only diagnostics.* That is a better target than simply removing `@AdminBoundaryAccess`.
- **D9:** keep current behavior (recorded above). The earlier "enforce at the API" input is withdrawn.
- **D10:** approved; implemented in #1016 (Archive offered to admin only; API unchanged).
- **D11:** no change.
- Production items: leave the WooCommerce "Aa" Versions 1-3 untouched until production archival is explicitly authorized, after confirming none is published or referenced. DEF-25: wait for a real recurrence, then capture the redirect request/response, session state and correlation/log evidence before changing any code.
- Execution order: merge/review #1016 if CI is green; record D9 as intentional behavior (this change); define the D8 sanitized-readiness contract (below); leave production versions untouched; trace DEF-25 only when reproducible.

## D8 follow-up: sanitized readiness / preflight contract (DRAFT for the access-policy owner)

Goal: a caller who may validate and publish a mapping version (`editor`, `channel_manager`) can see enough to do it safely, without gaining admin-only diagnostics. Nothing here is implemented; `@AdminBoundaryAccess` is unchanged.

What the full evaluation returns today (`ConnectorMappingService.evaluatePublishReadiness`, `connector-mapping.service.ts`): `ok`, `blockers[]` and `warnings[]` (stable codes), a free-form `checks` object, `overallScore` and a `breakdown` of content / seo / media scores. Preflight returns `ok`, `blockers`, `warnings`, `fallbackAckRequired`.

Proposed classification, to be confirmed by the owner:

| Field | Sanitized view for editor / channel_manager | Reason |
|---|---|---|
| `ok` | include | the safe-to-act answer |
| `blockers[]`, `warnings[]` with `mapping_*`, `field_mappings_missing`, `required_attribute_mapping_missing`, `fallback_*`, `using_system_default_mapping`, `product_*`, `required_product_data_missing`, `media_*` | include (stable codes; the web app already maps them to remediation text) | needed to remediate; no secrets |
| `connector_not_installed`, `connector_not_active`, `connector_credentials_expired` | **open question**: either include (they only say a connector needs attention) or collapse to one generic `connector_unavailable` | credential state is connector-admin territory; owner to decide |
| `overallScore`, `breakdown` | include | product-data quality, not tenant administration |
| `checks` (free-form object) | **exclude** until each key is audited and allow-listed | unaudited; may carry installation, account or version detail |
| `preflight.fallbackAckRequired` | include | required to act |

Open decisions for the owner: (1) a separate sanitized route, or the same route returning a reduced body for callers without the boundary role; (2) which of the connector codes above to show; (3) audit treatment, since D1 already records evaluation POSTs. Success criteria for a later implementation: an editor and a channel_manager get `200` with exactly the allow-listed fields (no `checks`); roles that cannot validate/publish still get `403`; `system_admin` stays denied as pinned by `access-policy-remediation.test.cjs`; the web app's review step shows real readiness instead of the "not available" notice for those roles.
