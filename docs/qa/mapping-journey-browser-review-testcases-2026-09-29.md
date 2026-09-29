# Vexa Channel Mapping Journey: Browser Review Test Cases (2026-09-29)

Target: https://app.vexapim.com/channels/mappings (single live environment bound to real pilot tenants)
Method: built-in Claude browser only. No code reading, no test runs.

## Ground rules
- **RO** = read-only. Safe to run on real data.
- **MUT** = mutating (Save draft, Validate, Publish, Rollback, Archive, Ack fallback). **Not executed** on production. Marked "Observe only": verify the control, its state and its wording, but do not click it.
- Auth is done by the user. No credentials are entered by the reviewer.
- Result values: PASS / FAIL / BLOCKED / N/A / NOT RUN. Every FAIL needs a screenshot or console/network evidence.
- Severity: P0 (data loss, wrong publish, leak) / P1 (major friction, silent failure) / P2 (polish) / P3 (nice-to-have).

## Suite A: Entry points and routing
| ID | Pri | Mode | Test | Expected |
|---|---|---|---|---|
| MAP-A01 | P1 | RO | Sidebar "Mappings" link | Opens /channels/mappings at Step 1 with nothing pre-filled; link highlights as active |
| MAP-A02 | P1 | RO | Dashboard mapping links (2) | Both land on the mapping page; no 404 |
| MAP-A03 | P2 | RO | Channels hub "Mappings" link | Lands on mapping page |
| MAP-A04 | P1 | RO | Connector portfolio mapping link(s) | Channel and account pre-filled for the chosen connector |
| MAP-A05 | P1 | RO | Connector detail page mapping links (3) | Redirect via /connectors/{id}/mapping; lands with channel + installationId set |
| MAP-A06 | P1 | RO | Connector entry when a live version exists | Lands on Step 3 (review) directly, and shows why |
| MAP-A07 | P1 | RO | Product → Channels tab "mapping" link | Channel, category and product pre-filled; "Product context" chip shown |
| MAP-A08 | P2 | RO | Catalog products page mapping link | Pre-fills first active channel and product category |
| MAP-A09 | P1 | RO | Unauthenticated deep link (`?next=`) | Login, then return to the same mapping URL with query intact |
| MAP-A10 | P2 | RO | Breadcrumb (Dashboard / Channels / Mappings) | Each crumb works; current page not a link |
| MAP-A11 | P2 | RO | /connectors/{bad-id}/mapping | Sensible error/not-found; no blank page |

## Suite B: Step 1, Scope
| ID | Pri | Mode | Test | Expected |
|---|---|---|---|---|
| MAP-B01 | P1 | RO | Initial load, no params | Stepper shows Step 1 current; pickers empty; Continue disabled or absent |
| MAP-B02 | P1 | RO | Select channel | Account list filters to matching installations |
| MAP-B03 | P1 | RO | Channel with multiple accounts | Must choose an account; message explains why; Continue blocked until chosen |
| MAP-B04 | P1 | RO | Channel with no installed account | Clear message and path to connect one; not a dead end |
| MAP-B05 | P1 | RO | Select source category | Category path shown in full; test-data categories hidden |
| MAP-B06 | P1 | RO | Publish-category search (taxonomy) | Results in ≤ a few seconds; selecting one sets it and shows path label |
| MAP-B07 | P2 | RO | Taxonomy search with zero results | Empty-state message, not a blank card |
| MAP-B08 | P2 | RO | Unmapped taxonomy list | Renders; each item selectable |
| MAP-B09 | P1 | RO | Continue gating | Continue only enabled when channel + category + publish category (+ account if any exist) |
| MAP-B10 | P1 | RO | Required-fields preview | Count matches chips shown; long list truncated with clear indication |
| MAP-B11 | P1 | RO | `?channel=bogus` | Warning "no longer available"; no crash |
| MAP-B12 | P1 | RO | `?categoryId=bogus` | Warning "could not be found"; no crash |
| MAP-B13 | P1 | RO | `?installationId=bogus` | Warning shown inline; account NOT silently substituted |
| MAP-B14 | P2 | RO | `?productId=bogus` | Product warning; wizard continues without sample values |
| MAP-B15 | P2 | RO | Changing channel after selecting account | Stale account cleared or flagged; no mismatched scope |

## Suite C: Step 2, Map
| ID | Pri | Mode | Test | Expected |
|---|---|---|---|---|
| MAP-C01 | P1 | RO | Load Step 2 with scope complete | Scope summary card matches selections; "Change scope" works |
| MAP-C02 | P1 | RO | Mapping source chip | Explains whether mapping is default, inherited or custom |
| MAP-C03 | P1 | RO | "Resuming draft" card | Shows draft date and author; states live mapping unchanged |
| MAP-C04 | P1 | RO | Required vs optional fields | Required grouped first; missing ones clearly marked |
| MAP-C05 | P1 | RO | Source-field dropdown | Options readable; long names not clipped |
| MAP-C06 | P1 | RO | Sample product values | Sample shown when product context or category sample exists; label says which |
| MAP-C07 | P1 | RO | Completion checklist / blocker bar | Counts match reality; wording actionable |
| MAP-C08 | P1 | RO | Change a field, then click any exit link | Unsaved-changes guard appears (no save performed) |
| MAP-C09 | P1 | RO | Change a field, then browser Back / refresh | Warned, or clearly behaves; no silent loss |
| MAP-C10 | P2 | RO | Fallback config section | Explained in plain language; default state visible |
| MAP-C11 | P2 | RO | Advanced tools drawer | Collapsed by default; panels open as labelled; JSON panel not primary |
| MAP-C12 | P2 | RO | Shopify diagnostics (Shopify accounts only) | Collections / metafields tables render, mobile columns hide sensibly |
| MAP-C13 | P1 | RO | Read-only role | Editor controls disabled or hidden; reason stated |
| MAP-C14 | P1 | MUT (observe) | Save draft button | Present, labelled, enabled only with changes; **not clicked** |

## Suite D: Step 3, Review and publish
| ID | Pri | Mode | Test | Expected |
|---|---|---|---|---|
| MAP-D01 | P1 | RO | `?step=review` with no draft | Downgrades to Step 2 with "Save a draft before reviewing" alert; alert is announced (role) |
| MAP-D02 | P1 | RO | `?step=review` without publish category | Downgrades to Step 1 with matching alert |
| MAP-D03 | P1 | RO | Publish checklist card | Each row Pass/Blocked with guidance; guidance names the correct step |
| MAP-D04 | P1 | RO | Readiness card | Blockers listed by name; connector health chip and link work |
| MAP-D05 | P2 | RO | Payload preview link | Goes to product channels tab or connector catalog payload |
| MAP-D06 | P1 | RO | Version manager list | Versions distinguishable (ordinal labels); lifecycle state, author and date visible |
| MAP-D07 | P1 | RO | Live version identification | Exactly one clearly marked as live |
| MAP-D08 | P1 | MUT (observe) | Validate / Publish / Rollback / Archive controls | Enabled state consistent with checklist; **not clicked** |
| MAP-D09 | P1 | MUT (observe) | Fallback acknowledgement UI | Appears only when required; wording explains consequence; **not clicked** |
| MAP-D10 | P1 | MUT (observe) | Step-up re-auth messaging | Wording clear for required / expired / mismatch states (via `stepUpError` URL param display only) |
| MAP-D11 | P1 | RO | Checklist vs readiness contradiction | No case where the checklist says Pass and readiness says blocked (or the reverse) |

## Suite E: State, resilience and errors
| ID | Pri | Mode | Test | Expected |
|---|---|---|---|---|
| MAP-E01 | P1 | RO | Browser Back/Forward across the three steps | Step and scope stay consistent with URL |
| MAP-E02 | P1 | RO | Refresh on each step | Same state restored |
| MAP-E03 | P2 | RO | Copy URL to a new tab | Identical view (deep link works) |
| MAP-E04 | P2 | RO | Loading state | Skeleton/loader appears; no layout jump |
| MAP-E05 | P1 | RO | Console on every step | No errors or hydration warnings |
| MAP-E06 | P1 | RO | Network on every step | No failed (4xx/5xx) calls; note slow calls > 2 s |
| MAP-E07 | P2 | RO | Very long category or attribute names | Wrap or truncate with tooltip; no overflow |
| MAP-E08 | P2 | RO | Two tabs on same scope | Stale tab behaviour is not destructive (observe only) |

## Suite F: Accessibility (visible-only)
| ID | Pri | Mode | Test | Expected |
|---|---|---|---|---|
| MAP-F01 | P1 | RO | Keyboard-only through each step | Logical order, all controls reachable, no traps |
| MAP-F02 | P1 | RO | Focus visibility | Visible ring on links, buttons, selects |
| MAP-F03 | P1 | RO | Stepper semantics | Current step exposed (aria-current or equivalent) |
| MAP-F04 | P1 | RO | Status chips | State not conveyed by colour alone |
| MAP-F05 | P2 | RO | Alerts | Alerts have role and are announced |
| MAP-F06 | P2 | RO | Form labels | All selects and inputs labelled in the accessibility tree |
| MAP-F07 | P2 | RO | Contrast on slate-500 helper text | ≥ 4.5:1 |
| MAP-F08 | P2 | RO | Zoom 200 % | No lost content |

## Suite G: Responsive
| ID | Pri | Mode | Test | Expected |
|---|---|---|---|---|
| MAP-G01 | P1 | RO | 1440 wide, all 3 steps | Baseline layout |
| MAP-G02 | P1 | RO | 768 wide | No horizontal page scroll; cards stack |
| MAP-G03 | P1 | RO | 375 wide | Stepper, pickers and field rows usable; tap targets adequate |
| MAP-G04 | P2 | RO | Tables (Shopify, versions) at 375 | Priority columns kept, others hidden |

## Suite H: Roles and security (observable)
| ID | Pri | Mode | Test | Expected |
|---|---|---|---|---|
| MAP-H01 | P1 | RO | Signed-in role's sidebar | "Mappings" visible only for channel_manager_plus |
| MAP-H02 | P1 | RO | Write controls by role | Hidden/disabled when the role cannot manage channels |
| MAP-H03 | P1 | RO | Query params with special chars (`<script>`, quotes) | Escaped; no injection or crash |
| MAP-H04 | P1 | RO | Another tenant's category/installation id in URL | Rejected as invalid; no cross-tenant data displayed |

## Traceability to recent fixes (regression watch)
- #941: invalid installation is never silently substituted (MAP-B13).
- #990: latest saved draft is resumed on Step 2 (MAP-C03).
- #991 / #994: step downgrades are explained and accessible; versions are distinguishable (MAP-D01, D02, D06).

## Execution log (run 2026-09-29, app.vexapim.com, role: Admin, browser-only, read-only)

Test-data scopes used: Shopify + "T-Shirt" (live versions exist), WooCommerce + "Aa" (no draft).
Tool caveat: text extraction only works after a screenshot forces a paint. This is a tool limit, not an app defect (server timing: first byte 316 ms, load 646 ms).

### Results
| ID | Result | Note |
|---|---|---|
| A01 | PASS | Sidebar link lands on Step 1, item highlighted (by CSS class only, see DEF-11) |
| A02, A03 | PASS | Links resolve to /channels/mappings |
| A04, A05, A06 | **FAIL** | DEF-01 |
| A07, A08 | PASS | Product tab and catalog links carry channel, category and product |
| A11 | **FAIL** | DEF-01: a non-existent installation silently lands on bare page, no not-found |
| B01, B11, B12, B13, B14 | PASS | Warnings shown, no crash, account not silently substituted (#941 holds) |
| B09 | PARTIAL | DEF-03: Shopify enables Continue with a publish category the user never chose |
| B10 | **FAIL** | DEF-04: option cards say "Required attributes: None" but preview says 7 required |
| B05 | **FAIL** | DEF-05: E2E test categories visible in publish-category list while hidden in source list |
| B15 | NOT RUN | Needs form submit |
| C01–C04, C06, C07, C11 | PASS | Scope summary, source chip, "Resuming draft" (#990 holds), field rows, drawer |
| C05 | PARTIAL | DEF-08: raw key "attributes.size" in a dropdown |
| C08 | PASS | Native modal dialog, focus on "Stay on this step" (DEF-10 for button emphasis) |
| C09 | **FAIL** (moderate confidence) | DEF-09: full-page navigation away from edited form gave no prompt |
| C13 | N/A | Only Admin role available |
| C14 | OBSERVED | Save draft version enabled, not clicked |
| D01, D02 | PASS | Downgrade alerts appear with role=status (#991/#994 hold) |
| D03, D04 | PASS | Checklist and readiness agree |
| D06 | PASS | Versions distinguishable by ordinal (#994 holds) |
| D07 | **FAIL** | DEF-06: two versions labelled "Live" for one scope |
| D08 | OBSERVED | Publish enabled only on the "Ready to publish" version; Archive enabled on Live versions (DEF-07) |
| D09, D10 | NOT RUN | Needs a scope that triggers fallback / step-up |
| D11 | PASS | No contradiction in Step 3 |
| E01 | PASS | Back returns to the same step and scope |
| E05 | PASS | No console errors |
| E06 | PASS | Only a benign aborted prefetch |
| F03 | PASS | Stepper is an ordered list with Current/Pending/Complete text |
| F04 | PASS | State is conveyed by text, not colour only |
| F05 | PASS | Alerts use role=status |
| F06 | **FAIL** | DEF-12 |
| F01, F02, F07, F08 | NOT RUN | Keyboard and contrast need manual input |
| G01 | PASS | 1440 layout, sidebar visible |
| G03 | PASS | No horizontal overflow at 375 on Map or Review; DEF-13 tap targets |
| G02 | NOT RUN | 768 not measured |
| H01, H03 | PASS | `<script>` and `onerror` payloads rendered as text |
| H02, H04 | N/A | Single role, single tenant |
| B02–B04, B06–B08 | NOT RUN | Single account per channel; taxonomy search not exercised |

Totals (66 cases): 34 PASS, 9 FAIL, 4 PARTIAL/OBSERVED, 19 NOT RUN or N/A.

### Defects
| ID | Sev | Finding | Evidence |
|---|---|---|---|
| DEF-01 | **P1** | `/connectors/{id}/mapping` always ends on bare `/channels/mappings`. Channel, account, product and the "skip to review" behaviour are lost. Reproduced for both real accounts (Shopify, WooCommerce) and a fake ID. Likely cause: the success `redirect()` sits inside a `try` whose `catch` redirects to the bare route (`app/connectors/[installationId]/mapping/page.tsx`). Affects every entry from the Connector portfolio and Connector detail (6+ links). | Browser final URL after each link |
| DEF-02 | P1 | Amber "Required fields still missing" banner and green "All required fields are mapped" banner show together with 0 missing (Shopify T-Shirt, Step 2) | Screenshot |
| DEF-03 | P1 | Shopify scope silently defaults Publish category to the source category ID and enables Continue. WooCommerce shows "Not selected". Inconsistent, and the value is a raw ID, not a label. | Continue link href contains `publishCategoryId=<source id>` |
| DEF-04 | P1 | "Required attributes: None" on every publish-category option, while the preview says 7 required fields | Step 1 text |
| DEF-05 | P2 | About 65 "E2E Test Category" entries in the publish-category list and Step 2 dropdown on the live tenant. The source list hides them. | Step 1, Step 2 dropdown |
| DEF-06 | P1 | Two versions (v7, v9) both labelled "Live" for one scope; summary says "2 live" and "1 prior published version remain". Unclear which is serving. | Step 3 |
| DEF-07 | P1 (needs product check) | Archive is enabled on Live versions; Rollback on live and replaced ones. May be blocked server-side; not exercised. | Button states |
| DEF-08 | P3 | Raw key "attributes.size" in PIM-field dropdown; Amazon-style optional fields (brand_name, item_name, size_name, tax_rate) listed on a Shopify lane | Step 2 selects |
| DEF-09 | P2 | No unsaved-changes prompt on browser refresh, URL change or tab close (guard only covers in-page links) | Navigated away with an edited select |
| DEF-10 | P2 | In the unsaved-changes dialog the red "Leave without saving" is the dominant button; "Stay" is secondary | Screenshot |
| DEF-11 | P2 | Active sidebar item has no `aria-current`; page `<title>` is "Vexa PIM" on every page; 43 duplicate element IDs (repeated Archive form inputs per version) | DOM inspection |
| DEF-12 | P2 | All 18 mapping selects share the accessible name "PIM field"; the channel field name is not in the name | DOM inspection |
| DEF-13 | P2 | Small tap targets at 375: breadcrumb links 16 px, advanced-drawer summaries 20 px | Measured |
| DEF-14 | P3 | Developer-style copy on every version row ("Mobile view keeps validate, publish, archive, and rollback controls stacked here…"); raw `ok` status text; "Publish remains blocked until…" shown while everything is ok; two "Step 3" headings on one page; raw IDs in Scope and Publish category labels; two "Open catalog mapping" links on the Connectors page with different targets | Step 3, Connectors page |

### Not verified (needs a disposable tenant or manual input)
Saving, validating, publishing, rolling back, archiving, fallback acknowledgement, step-up re-auth, read-only role, multi-account and no-account scopes, keyboard-only pass, colour contrast, 768 layout.

### Post-fix status (updated 2026-09-29)
| Defect | Status |
|---|---|
| DEF-01 connector links drop scope | Fixed in #1001; verified live (Shopify, WooCommerce, unknown id shows 404) |
| DEF-02 contradictory Step 2 notices | Fixed in #1002; verified live (fully mapped scope shows only the green notice; scope with 2 missing still shows the amber notice) |
| DEF-03 raw id as publish category label | Fix in the "scope and label clarity" PR: falls back to the category tree path |
| DEF-04 "Required attributes: None" | Fix in the same PR: the line renders only when a category lists attributes |
| DEF-06 two "Live" versions | Not a data bug. The list returns this-account and all-accounts versions, and each scope has its own published slot. Fix in the same PR: shows each version's scope, picks the active version by resolver precedence, and uses "Version N" labels |
| DEF-07 Archive enabled on Live | Not a defect: the API deliberately allows archiving a published version (`archiveVersion allows archiving from draft, validated, published, or superseded`). Recommendation only: add a confirmation when archiving the live version. Needs a product decision. |
| DEF-05, DEF-08 to DEF-14 | Open. DEF-05 (about 65 E2E test categories on the live tenant) is a data-hygiene task, not a code fix. |
