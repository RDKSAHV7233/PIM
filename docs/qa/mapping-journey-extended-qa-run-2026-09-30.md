# Vexa Channel Mapping: Extended QA Run (2026-09-30)

Environment: app.vexapim.com (production), signed in as the tenant's only active admin. Browser-only.
Plan: `mapping-journey-extended-qa-plan-2026-09-29.md`. Scope of mutation: WooCommerce / category "Aa" / product "Vexapim Trial" only (no live mapping existed for this scope, nothing sent to an external store).

## What could not be run, and why
| Area | Why |
|---|---|
| Suite R (roles) | Only one active account exists (the admin). The other 20 users are inactive E2E accounts with no known credentials. No role or status was changed. |
| Suite S and M05-M09 (publish, rollback, archive, step-up) | Every protected action requires typing the account password into a step-up field. Passwords are not entered by the reviewer. |
| M10, M12, M13, Z01, Z03, Z04, Z05 | Need further submits against production. After three drafts and one validation, the environment's safety check blocked another change to the shared resource, so mutation stopped there. |
| Suite X | Only Chromium was available; no Firefox or Safari. |
| Y02, Y04, Y05, P01, P03 | Need a screen reader, zoom/forced-colours modes, network/CPU throttling and concurrent users. |

## Results
| ID | Result | Notes |
|---|---|---|
| M01 save complete draft | PASS | Saved, redirected to Review, checklist "Required fields mapped: Pass" |
| M02 save with required fields missing | PASS (observed) | Saved without warning as "Version 1"; see DEF-15 |
| M03 validate complete draft | NOT RUN | Blocked by the safety check (see above) |
| M04 validate incomplete draft | ~~FAIL~~ REVISED | See the correction below: the draft was not actually incomplete. The server behaved as designed. |
| M11 double-click save | **FAIL** | DEF-16 |
| D11 checklist vs readiness | **FAIL** | DEF-17, DEF-18 |
| D21 lane with no connector account | **FAIL** | DEF-19 |
| D27 Amazon / Flipkart / Meesho lanes render | PASS | Render without errors; see DEF-19 |
| D28 taxonomy search: special characters | PASS | Rendered as text, no injection, no error |
| D28 search: no results | **FAIL** | DEF-20 |
| D28 search: 500 characters | **FAIL** | DEF-21 |
| Y01/F01, F02 keyboard, Step 1 | PASS | Skip link works; order is breadcrumbs, portfolio link, pickers, Apply scope, Continue, options; visible ring at every stop |
| Y03 contrast, Step 3 (411 text elements) | PARTIAL | 409 pass; DEF-22 |
| G/X viewports 375, 768, 1024, 1440, Steps 1-3 | PASS | No horizontal overflow; 1440 version table is 6 columns, 16 rows |
| P load time | PASS | Time to first byte 633 ms and load 1.2-2.8 s (Step 3, 16 versions, 2,514 DOM nodes) |
| P02 payload with many versions | **FAIL** | DEF-23 |
| Z02 injection strings | PASS | Script and `onerror` strings in URL parameters are rendered as text |
| Z06 audit trail | PASS with note | Actor, time, action and resource are recorded; DEF-24 |
| R06 session expiry | PARTIAL | DEF-25 |

## New defects
| ID | Sev | Finding | Evidence |
|---|---|---|---|
| DEF-15 | ~~P1~~ **Reclassified: P2 UI defect, not a server defect** | Original claim (wrong): the server validated a draft with 2 unmapped required fields. Correction: those "missing" fields were already covered. WooCommerce's default map (`title -> name`, `attributes.mainImageUrl -> images.0.src`) covers them as source keys, and the API's readiness rule counts source keys or targets. The wizard counted only target rows, so it showed "missing / Blocked" while the Readiness card on the same page said 0 missing. Publishing a mapping with blockers is an intentional contract (`channels-mapping-publish-complex-blockers.spec.js`); exports are what readiness hard-blocks. Fixed in the wizard by using the API's rule (see the DEF-15/16 PR). | WooCommerce / Aa, resolved mapping snapshot, 2026-09-30 |
| DEF-16 | **P1** | A single real double-click on "Save draft version" created two drafts (Version 2 and 3) one second apart. Save is not idempotent. | Two `POST .../mappings/versions` audit events at 11:43:43 and 11:43:45 |
| DEF-17 | P2 | On Review the checklist said "Required fields mapped: Blocked" while the Readiness card said "Mapping completeness: Ready / missing: 0". Root cause is the same as DEF-15 (two definitions of "required field mapped"); fixed with it. The Readiness card also says "Publish remains blocked" while the mapping's Publish button is enabled: "publish" there means exporting products to the channel, not publishing the mapping. Still open (wording). | Review step |
| DEF-18 | P2 | "Draft validated: Pass" is satisfied by any validated version in the scope (Version 1) even when the newest drafts (2, 3) are not validated. | Review checklist |
| DEF-19 | P2 | Amazon / Flipkart / Meesho with no connector account: Step 1 says only "No installed connector account", with no guidance or link to connect one, and the wizard still lets you proceed. The help text shows the raw slug "amazon-in". All three list the same 25 PIM categories as publish options. | Step 1 |
| DEF-20 | P2 | A search with no matches shows the full unfiltered category list and no "no matches" message. | `taxonomyQ=zzzznomatch` |
| DEF-21 | P2 | A 500-character search value crashes the page into the generic "Something went wrong" error screen. | `taxonomyQ=AAAA...` (500 chars) |
| DEF-22 | P3 | "Operator flow" label is 4.48:1 (needs 4.5:1). White check marks on the green stepper circles are 2.54:1. | Contrast audit |
| DEF-23 | P2 | Step 3 HTML is about 544 KB for 16 versions because every row is rendered twice (desktop and mobile). It grows linearly, so 100+ versions would be several MB. | 1440 wide, Step 3 |
| DEF-24 | P3 | Audit events for the mapping journey are raw `POST <path>` entries, and every Step 3 view writes `preflight` and `publish-readiness` POST events, which inflate "Mutation events" counts. | /admin/audit |
| DEF-25 | P3 | After the session expired, the app sent the tab to `/login?next=%2Fdashboard`, not the mapping page the user was on. | Network log |

Also noted: the workspace shows "Admin coverage 1" (its own page recommends at least two active admins).

## Production artifacts left behind (please clean up)
WooCommerce / "Aa" / connector account `primary (https://www.vexapim.com)`:
- **Version 1**: validated, "Ready to publish". It saved the system default mapping unchanged, so it is functionally equivalent to the default (corrected: it is not incomplete).
- **Version 2 and Version 3**: identical duplicate drafts (DEF-16). To make the wizard show "complete" I mapped `title -> title` and `attributes.mainImageUrl -> attributes.mainImageUrl`, which **adds two wrong extra targets to the WooCommerce mapping. Do not publish Version 2 or 3.**
Archive all three (junk scope) when convenient. Archiving needs the step-up password, so the reviewer could not do it. No product data changed and nothing was published.

## Handoff: password-gated cases (need a person to type the password)
1. (Superseded) The original step asked to publish Version 1 to test rejection. That is no longer needed: publishing with blockers is by design.
2. Publish a complete draft on this junk scope, publish a second, roll back, and archive the live one (M05-M09).
3. Submit a publish with a wrong password and with an expired step-up (S01, S03).

## Status after the DEF-18 to DEF-25 sprint
| ID | Status |
|---|---|
| DEF-18 | Fixed: "Draft validated" now judges the newest working draft. |
| DEF-19 | Fixed: guidance and a link to connect an account; channel display name instead of the raw slug. The lists of publish categories for lanes with no account are still the tenant's own categories (data, not changed). |
| DEF-20 | Fixed: "No categories match ..." with a clear-filter link. |
| DEF-21 | Fixed: the search text is clamped to the API's 255-character limit. |
| DEF-22 | Fixed: stepper check mark, pending labels and the "Operator flow" label pass 4.5:1. |
| DEF-23 | Fixed: Step 3 shows the newest 10 versions plus anything live or validated, with "Show all N versions". |
| DEF-24 | **Not changed, needs a decision.** `common/audit/audit-log.interceptor.ts` records every non-GET request by HTTP verb, so the read-only `preflight` and `publish-readiness` POSTs are logged as mutations. Options: (a) skip audit for a short allowlist of evaluation endpoints, (b) keep logging but tag them as evaluations so the "Mutation events" count excludes them, (c) leave as is. Any of these changes what the audit trail records, so it needs required-team (security/governance) approval. |
| DEF-25 | **Not changed, not reproduced from code.** `middleware.ts` already sets `next` to the requested pathname when no token exists. The `next=%2Fdashboard` seen on 2026-09-30 came from a request to `/dashboard`; the redirect from the mapping page to `/dashboard` mid-session was not traced. It needs a runtime reproduction with an expired session (auth/session domain, required-team approval). |
