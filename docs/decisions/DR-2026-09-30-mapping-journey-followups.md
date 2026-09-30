# Decision record: mapping journey follow-ups (2026-09-30)

Status: **PROPOSED, not ratified.** Prepared by the assistant at the user's request, acting in a CTO / required-team lens after the browser QA of the mapping journey (`docs/qa/mapping-journey-extended-qa-run-2026-09-30.md`). It is not an approval by any person, and no `cto-required-team-approved` label has been applied. A named human should ratify (or overturn) each decision below.

Ratified by: ______  Date: ______

## D1. DEF-24: audit trail records read-only POSTs as mutations
- Finding: `common/audit/audit-log.interceptor.ts` records every non-GET request with `action = <HTTP verb>`. Each view of the mapping review step therefore writes `POST .../publish-readiness` and `POST .../mappings/preflight`, and the audit page's "Mutation events" chip counts them.
- Options considered: (a) stop recording those endpoints, (b) record them with a different action such as `EVALUATE`, (c) leave recording alone and change only how the audit page counts them.
- **Decision: (c).** The recorded trail stays byte-for-byte the same, so this needs no governance approval and loses no evidence (who looked at readiness, when). The audit page counts the two evaluation endpoints in a separate "Evaluations" chip and no longer in "Mutation events".
- Why not (a)/(b): both change what is recorded or how existing filters ("POST") and exports behave; that is a security/governance decision with no compelling benefit over (c).
- Revisit if: audit volume from evaluation POSTs becomes a storage or cost problem.

## D2. DEF-17: "Publish remains blocked" next to an enabled mapping Publish button
- Finding: "publish" means two things on this page: making a mapping version live (the button) and publishing products to the channel (what readiness gates; exports hard-block on it). Publishing a mapping with blockers is intentional (`channels-mapping-publish-complex-blockers.spec.js`).
- **Decision:** reword the two direct statements to name what is blocked ("Publishing products to this channel stays blocked until ...", "blocking product publishing"). No behaviour change; no server gate.

## D3. DEF-05: about 65 "E2E Test Category" rows in the live tenant
- **Decision:** hide them in the publish-category lists using the existing `filterTestData` (already applied to the source-category picker). Do **not** delete tenant data from code. If the owner wants them gone, deletion is a separate, explicit data operation by the tenant admin.

## D4. Server-side duplicate protection for saving drafts (follow-up to DEF-16)
- Finding: the double-click fix is client-side. `ConnectorMappingService.createDraft` inserts on every call.
- **Decision: deferred, accepted risk.** A "same content within N seconds" check only narrows the race (two concurrent requests can both pass it) unless backed by a DB constraint or lock, which is a larger change to a connector workflow (required-team domain). Duplicate drafts are harmless: never live, and archivable.
- Revisit if: duplicate drafts are observed from non-browser clients or retries. Then add an idempotency key on the create call.

## D5. DEF-25: login redirect target
- **Decision: close as not reproduced.** `middleware.ts` already sets `next` to the requested path. Reopen with a runtime trace (expired session, mapping page load) if it recurs.

## D6. Production hygiene (owner actions, not code)
1. Archive WooCommerce / "Aa" mapping Versions 1, 2 and 3 (junk scope; Versions 2 and 3 add wrong extra targets). Needs the step-up password. **Do not publish them.**
2. The workspace has one active admin; its own Users page recommends at least two.
3. The 20 inactive E2E user accounts in the tenant can be reviewed and retired by the admin.

## D7. Remaining QA plan
- Roles, step-up, publish, rollback and archive cases were never run. They need a scratch tenant with a second account per role and someone to type the step-up password. Until then these paths are covered only by the existing automated specs.
