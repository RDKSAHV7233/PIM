# Vexa Channel Mapping: Extended QA Plan (production-grade)

Status: DRAFT for approval. Follows the read-only browser smoke test of 2026-09-29
(`mapping-journey-browser-review-testcases-2026-09-29.md`: 34 pass, 9 fail, 19 not run).
Purpose: close the gaps that smoke test could not cover, and reach a release sign-off decision.

## 1. Goal and exit criteria
The mapping journey is signed off when all of the following hold:
1. Every P0/P1 case in this plan is PASS, or has an accepted, documented risk.
2. The publish, rollback and archive flows have been run end to end on a disposable tenant.
3. Every role has been checked for both allowed and denied actions.
4. No open P0, and no open P1 without a named owner and date.
5. Every fixed defect has a regression test (automated where practical).

## 2. Environment and data (must exist before any mutating test)
Only one live environment exists and it serves real pilot tenants. So mutating tests are never run on a real tenant.

| Need | Detail | Owner |
|---|---|---|
| Disposable tenant | Separate workspace, clearly named `qa-mapping-<date>`, deleted or archived after the run | Product/Eng |
| Connector accounts | Shopify (2 accounts on the same tenant), WooCommerce (1), one channel with 0 accounts. Amazon, Flipkart and Meesho only if connectable | Eng |
| Categories | At least 3 with different required-field counts, one with 0 required fields | QA |
| Products | 5 products, at least one per category, one with missing required values | QA |
| Roles | Admin, Editor, one business-only/read-only role, one non-channel-manager role | Admin |
| Step-up | A user able to complete step-up re-authentication, and one who cannot | Eng |
| Data hygiene | Remove or hide the ~65 "E2E Test Category" entries from real tenants (DEF-05) | Eng |

Rules:
- Real-tenant checks stay read-only, as in the smoke test.
- Publish tests on the disposable tenant must use connector credentials for a throwaway store. Never a real customer store.
- Any test that could publish to a live external channel needs written approval first.

## 3. Test areas (adds to the 66 existing cases)

### Suite M: Mutating flows (disposable tenant only) — P0/P1
| ID | Pri | Test | Expected |
|---|---|---|---|
| MAP-M01 | P0 | Save draft with all required fields mapped | New draft version created, version number increments, redirect to Review, live mapping unchanged |
| MAP-M02 | P1 | Save draft with required fields missing | Either blocked with a clear message or saved as an incomplete draft that cannot be validated |
| MAP-M03 | P0 | Validate a valid draft | State moves to "Ready to publish"; checklist and readiness agree |
| MAP-M04 | P1 | Validate a draft with a missing required mapping | Rejected with the named missing fields |
| MAP-M05 | P0 | Publish a validated draft | Exactly one version is Live; the previous live version becomes Replaced (DEF-06 check) |
| MAP-M06 | P0 | Publish then confirm resolved mapping | Resolved snapshot matches the published version |
| MAP-M07 | P0 | Rollback to a replaced version | The rolled-back version is Live, the current one becomes Replaced, and an audit entry is written |
| MAP-M08 | P1 | Archive a draft | Draft leaves the active list and stays in history (includeArchived) |
| MAP-M09 | P0 | Archive the Live version (DEF-07) | Blocked with a clear reason, or explicitly warns and leaves the channel in a defined state |
| MAP-M10 | P1 | Publish when readiness is blocked | Publish stays disabled and the server also rejects a forged request |
| MAP-M11 | P1 | Double-click Save / Publish | Only one version created (idempotent) |
| MAP-M12 | P1 | Save while offline or on a 5xx | Visible error, edits preserved, no phantom version |
| MAP-M13 | P1 | Two tabs: publish in tab A, then publish stale draft in tab B | Tab B gets a clear conflict message; no silent overwrite |
| MAP-M14 | P1 | After publish, run a product publish to the throwaway channel | Payload reflects the published mapping (uses the payload preview link) |

### Suite S: Step-up and fallback — P0/P1
| ID | Pri | Test | Expected |
|---|---|---|---|
| MAP-S01 | P0 | Publish/rollback without step-up | Step-up required message, no change made |
| MAP-S02 | P1 | Complete step-up, retry | Action succeeds; returns to the same step and scope |
| MAP-S03 | P1 | Expired, mismatched-session and wrong-scope step-up | Each shows its own message; no change made |
| MAP-S04 | P1 | Scope needing a fallback | Acknowledge control appears, wording explains the consequence |
| MAP-S05 | P0 | Publish without acknowledging fallback | Blocked in the UI and by the server |
| MAP-S06 | P1 | Acknowledge fallback for version A, then open version B | Acknowledgement does not carry over |

### Suite R: Roles and permissions — P0/P1 (each row run once per role)
| ID | Pri | Test | Expected |
|---|---|---|---|
| MAP-R01 | P0 | Sidebar and direct URL, each role | Denied roles cannot see or open the page; friendly denial, not a crash |
| MAP-R02 | P0 | Viewer role on Step 2 and 3 | No Save/Validate/Publish/Archive/Rollback; reason stated |
| MAP-R03 | P0 | Forged POST for a write action as a viewer | Rejected server-side (401/403), no data change |
| MAP-R04 | P0 | Editor vs Admin | Matches the approved capability model (editors can edit; confirm who can publish) |
| MAP-R05 | P0 | Tenant isolation: use tenant A's category/installation/version IDs while signed in to tenant B | Rejected, no data shown |
| MAP-R06 | P1 | Session expiry mid-edit | Redirect to login, return to the same URL; edits are not silently lost (warn if possible) |

### Suite D: Data variety — P1/P2
| ID | Pri | Test | Expected |
|---|---|---|---|
| MAP-D20 | P1 | Channel with several accounts | Must choose an account; no default guess (B03) |
| MAP-D21 | P1 | Channel with no account | Clear route to connect one (B04) |
| MAP-D22 | P1 | Switch account after mapping | Scope-change warning; no cross-account draft bleed (account-mismatch guard) |
| MAP-D23 | P2 | Category with 0 required fields | Sensible empty state; can still publish or is told why not |
| MAP-D24 | P2 | Category with 50+ required or optional fields | Grouped, searchable or paginated; page stays responsive |
| MAP-D25 | P2 | Very long category, account and field names; non-ASCII, emoji, RTL text | No overflow; correct rendering |
| MAP-D26 | P2 | Version history with 100+ versions | Usable list (pagination or collapse); no slow render |
| MAP-D27 | P1 | Each channel lane (Shopify, WooCommerce, Amazon, Flipkart, Meesho) | Fields, required sets and terminology are channel-correct (DEF-08 check) |
| MAP-D28 | P1 | Taxonomy search: hit, no hit, special characters, very long query | Correct empty state and no crash (B06–B08) |

### Suite X: Cross-browser and devices — P1/P2
Run Suite A, B, C and D core cases plus the unsaved-changes dialog in: Chrome (latest), Firefox, Safari (macOS and iOS), Edge. Viewports: 375, 768, 1024, 1440. Check `<dialog>` modal behaviour, select controls, focus rings and the sticky header on each.

### Suite Y: Accessibility (manual, WCAG 2.2 AA) — P1
| ID | Test |
|---|---|
| MAP-Y01 | Keyboard-only run of all three steps and the modal (order, traps, visible focus, Esc) |
| MAP-Y02 | Screen reader (NVDA + Chrome, VoiceOver + Safari): stepper, alerts, 18 mapping selects (DEF-12), version list |
| MAP-Y03 | Contrast for helper text, chips, disabled buttons and links |
| MAP-Y04 | Zoom 200% and 400%, text spacing override |
| MAP-Y05 | Reduced motion and forced-colours mode |
| MAP-Y06 | Automated axe run on each step (duplicate IDs, page title, aria-current, DEF-11) |

### Suite P: Performance and resilience — P2
| ID | Test | Target (to be agreed) |
|---|---|---|
| MAP-P01 | Load time of each step on a 4x-throttled CPU and Fast 3G | Step usable within 4 s |
| MAP-P02 | Payload and DOM size on Review with 100+ versions (page currently repeats markup per version) | No layout jank; agreed DOM budget |
| MAP-P03 | Concurrent users (2–5) editing different scopes on one tenant | No cross-talk |
| MAP-P04 | API failure injection (500 on versions, readiness, taxonomy) | Error boundary or inline error; no blank page |
| MAP-P05 | Slow API (5–10 s) | Loading state; no double-submit |

### Suite Z: Security — P0/P1 (needs Security sign-off before running)
| ID | Test | Expected |
|---|---|---|
| MAP-Z01 | CSRF on save, validate, publish, rollback, archive | Rejected without valid token |
| MAP-Z02 | Reflected/stored XSS via category, field and account names, and the JSON override textareas | Escaped everywhere |
| MAP-Z03 | Malformed and oversized JSON in "Override mapping rules" and "fallback behavior" | Validation error; no server 500 |
| MAP-Z04 | `redirectTo` open-redirect probes on mapping actions | Only same-origin paths accepted |
| MAP-Z05 | IDOR on version, installation and category IDs (see R05) | Rejected |
| MAP-Z06 | Audit trail present for save, validate, publish, rollback, archive, with user and time | Entries in Audit Logs |

## 4. Regression suite for the smoke-test defects
Each fixed defect gets a test that fails before the fix and passes after (repo E2E rules apply: Playwright, no parallel workers, explicit 30 s poll timeouts).

| Defect | Regression test |
|---|---|
| DEF-01 | Connector link lands on `/channels/mappings` with channel, installationId, productId; lands on `step=review` when a live version exists; unknown ID shows not-found |
| DEF-02 | Step 2 never shows the "still missing" and "all mapped" banners together |
| DEF-03 | Shopify and WooCommerce behave the same for the publish category default, and show a label, not a raw ID |
| DEF-04 | Option cards' required count equals the preview count |
| DEF-06 | After publish, at most one version is Live per scope |
| DEF-09 | `beforeunload` prompt appears when the form is dirty |
| DEF-11 | Page title, aria-current and unique IDs asserted in the accessibility baseline spec |

## 5. Sequencing and effort (estimates)
| Phase | Content | Effort |
|---|---|---|
| 0 | Environment, data, roles, approvals (section 2) | 1–2 days |
| 1 | Suites M, S, R (P0 first) | 2 days |
| 2 | Suites D, Z | 1.5 days |
| 3 | Suites X, Y, P | 2 days |
| 4 | Regression tests for defects; fixes verified | Parallel with fixes |
| 5 | Report, sign-off meeting | 0.5 day |

Order rule: P0 mutating and permission cases run first. A failure there stops the run and goes back to engineering.

## 6. Roles and responsibilities
| Role | Responsibility |
|---|---|
| QA lead | Owns the plan, runs M/S/R/D, keeps the defect log |
| UI/UX architect | Reviews flow-level findings: DEF-02, DEF-03, DEF-06, DEF-07 wording and behaviour |
| Designer | Suite Y visual checks, dialog emphasis (DEF-10), tap targets (DEF-13), copy (DEF-14) |
| Developer | Fixes, regression tests, DEF-01 root cause |
| Security | Approves and reviews Suite Z |
| Product/PO | Rules on expected behaviour where unclear (DEF-03, DEF-07, who can publish) |

## 7. Open questions (decide before starting)
1. Can a disposable tenant with two Shopify accounts and a throwaway store be created?
2. Which roles may publish, roll back and archive? (Confirm against the pricing/capability model.)
3. Should archiving a Live version be allowed?
4. Should Suite Z be run by the QA team or Security?
5. Is there an agreed performance budget for the mapping pages?
6. Which browsers and devices does the pilot commit to supporting?

## 8. Risks
- Mutating tests can leak to a real channel. Mitigation: throwaway credentials and written approval.
- Single environment: a test tenant shares infrastructure with real tenants, so keep load tests small.
- Locked stories in `INCREMENT_STATE.json`: fixes need regression evidence. This plan's results and section 4 tests provide it.
- Scope creep: cap this plan at the mapping journey. Bulk-import and connector-setup pages stay out of scope.
