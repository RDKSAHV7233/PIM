# Vexa QA Acceptance Lane (browser, user-journey certification)

Date: 2026-10-07
Baseline: `origin/main` at `e7209405`
Type: **QA plan and evidence format.** No code, no production change by this document.
Status: **proposal / awaiting human review.** Execution is authorised only as described in section 2 and starts only when the inputs in section 11 are supplied.

## 1. What this lane is, and is not

The lane drives the **deployed Vexa app through the browser** as a real user with several roles and tenants, and certifies what a user can observe after the backend changes of SEC-DB-RLS-001. It sits **on top of** the automated lanes and replaces none of them:

```
unit / integration / restricted-role CI  →  API and DB security tests  →  automated E2E
        →  browser QA (this lane)  →  human acceptance and release decision
```

It answers one question: **does Vexa behave correctly from a real user's point of view?** Its most important duty is to catch the failure the RLS work exposed as the most dangerous: *the request succeeds, the job runs, zero rows are processed, the UI looks normal, and the business action never happened.* So every scenario verifies **result state**, not a success message.

**This lane is not evidence for:** RLS correctness, database role safety, provider-secret protection, concurrency correctness or budget atomicity. Those need the automated and security lanes. A passing browser pass must never be cited for them.

## 2. Authorisation, environment and safety rules

Decision recorded 2026-10-07 by the user: **a full run with writes, against named synthetic QA tenants only.**

1. **One environment exists and it is production** (Railway "Staging" serving `app.vexapim.com`; `docs/runbooks/production-deploy.md`). There is no staging copy. Therefore **writes go only to the named QA tenants**. Real pilot tenants are never written to, and observed read-only only if the user explicitly names them.
2. **Sign-in is by the human.** The agent never types, receives or stores a password, token, MFA code or recovery code. The user signs each persona into the browser pane; the agent works inside that session. A persona switch means the user signs in again.
3. **Marker for everything created:** every record the lane creates is named with a prefix the app already recognises as test data (`QA Flow ...`; the filter in `apps/web/src/lib/test-data-filter.ts`, purge tool `tools/dev/purge-test-data.cjs`), so it is hidden from sellers by default and purgeable per tenant. A **created-records register** lists every record (type, id, tenant, time) for cleanup.
4. **Excluded entirely** (they would reach outside the QA tenants or cost money or send messages): live marketplace or store publishing; real connector credentials (only invalid or sandbox values; credential flows are tested with deliberately fake secrets); email to real addresses or invitations to real people; payments, live Stripe checkout or plan changes on real tenants; deleting or purging anything outside a QA tenant; deleting real user accounts; AI provider traffic (not enabled); activating the signed-media key (human-gated; its own runbook).
5. **Purge only with the dry run first,** on the QA tenant key, after the lane (`docs/runbooks/test-data-governance.md`): dry run, review counts, execute, dry run again. Record it. Never run it against a tenant key that is not a QA tenant.
6. **Stop conditions:** unexpected data from a tenant that is not the persona's; any sign a real tenant is affected; a 5xx burst; any request to enter a credential; a prompt in the app asking for payment; the session landing in an unexpected tenant. Stop, record, and ask.
7. Records contain **no secrets, no token values, no customer data, no row payloads**: names, ids of QA records, status codes and booleans.

## 3. Personas and tenants

Roles are those of `apps/api/src/common/rbac/roles.ts`. **Role availability depends on the tenant's plan tier:** TRIAL and STARTER offer admin, editor and viewer only; GROWTH adds publisher, approver and reviewer; BUSINESS and ENTERPRISE offer all eight. The QA tenants' tier decides which personas can exist, so the tier is an input (section 11).

| Persona | Role | Used for |
|---|---|---|
| **Admin** | `admin` | settings, users, plan, connectors, workspace, audit |
| **Catalog / Editor** | `editor` | products, media, imports, categories, publish readiness |
| **Reviewer / Approver** | `reviewer` (comment) and, where the tier allows, `approver` | review, comments, approval; permission boundaries |
| Viewer (optional) | `viewer` | read-only boundary |

**Tenants:** at least **two** QA tenants, **Tenant A** and **Tenant B**, each with its own persona accounts, plus the default tenant observed only as a **negative** (a QA persona must never see it).

## 4. Result-state rule (applies to every scenario)

A scenario passes only if **both** hold: the UI shows the expected outcome, **and** an independent observation confirms the state changed. Independent observations, in order of preference: (a) the API response seen in the browser's network log for the follow-up `GET`; (b) the same record seen from a **second persona** or after a hard reload; (c) the resulting counts (before and after) on a list, dashboard or job page. A success toast alone is never a pass. For jobs and sweeps: record `processed` or `examined` counts and require a **non-zero** count where the fixture implies at least one; a green result with zero processed fails.

## 5. Scenario catalogue

Columns: **Safety class** `R` read-only, `W` writes to a QA tenant, `X` excluded (listed so it is a decision). Roles: A admin, E editor, V reviewer/approver, T the other tenant's persona.

### 5.1 Authentication and sessions (AUTH)

| ID | Scenario | Role | Class | Expected |
|---|---|---|---|---|
| AUTH-01 | login and logout; session ends; back button does not reveal pages | A, E, V | R | redirected to login; no cached data after logout |
| AUTH-02 | visit a protected page logged out, and a direct deep link | none | R | redirect to login, then back to the intended page after sign-in |
| AUTH-03 | stale session: leave idle past expiry, act | E | R | clear re-auth prompt; no half-applied action |
| AUTH-04 | logout in tab 2 while tab 1 is open, then act in tab 1 | E | R | tab 1's next action is refused cleanly |
| AUTH-05 | open the same page in two tabs and act in both | E | W | no corruption; the later action sees current state |
| AUTH-06 | account-suspended and unauthorised pages | A | R | the suspended page appears only for a suspended state; no information leak |

### 5.2 Tenant isolation as seen in the UI (TEN)

| ID | Scenario | Role | Class | Expected |
|---|---|---|---|---|
| TEN-01 | create a product `QA Flow A-1` in Tenant A and `QA Flow B-1` in Tenant B | E, T | W | each persona sees only their own |
| TEN-02 | search, list, category tree, dashboard counts, notifications in each tenant | E, T | R | no cross-tenant item or count |
| TEN-03 | media: upload in A; B persona requests A's asset by id | E, T | W | not found or refused; never the bytes |
| TEN-04 | import jobs, export jobs, bulk edit runs in A, viewed from B | E, T | W | invisible to B |
| TEN-05 | connector installations and credentials list in A, viewed from B | A, T | R | invisible to B; credential values never displayed |
| TEN-06 | audit log, admin users, API keys, webhooks lists | A, T | R | each tenant sees its own only |
| TEN-07 | URL tampering: B persona opens A's product, job and asset URLs | T | R | refused or not found; no data in the response |
| TEN-08 | the default tenant's data from a QA persona | E | R | never visible |

### 5.3 Product journey (PROD)

| ID | Scenario | Role | Class | Expected |
|---|---|---|---|---|
| PROD-01 | create product with required fields; empty and invalid fields | E | W | clear validation; nothing half-saved |
| PROD-02 | edit attributes, categories, translations; reload | E | W | persisted; version advances |
| PROD-03 | attach media; main image; thumbnail | E | W | listed; renders; belongs to this product |
| PROD-04 | validation and quality issues appear; fix one | E | W | issue list updates; counts change |
| PROD-05 | submit for review; reviewer comments; approver approves or rejects | E, V | W | status follows the workflow; roles enforced |
| PROD-06 | publish-readiness for a channel | E | W | readiness reflects real gaps (no live publish) |
| PROD-07 | stale object: edit in two tabs; save both | E | W | the second save is refused or merges explicitly; no silent overwrite |
| PROD-08 | very long values, strange characters, emoji, markup, leading and trailing spaces | E | W | stored and displayed safely; no injection; no truncation surprise |

### 5.4 Connector journey (CONN)

| ID | Scenario | Role | Class | Expected |
|---|---|---|---|---|
| CONN-01 | start connector setup; required fields; wrong credential shape | A | W | clear validation; no credential echoed |
| CONN-02 | save deliberately **fake** credentials; validation runs | A | W | an expected, understandable failure state; status shown honestly |
| CONN-03 | channel status and readiness pages | A, E | R | match the connector's actual state |
| CONN-04 | edit and re-save credentials; rotate (fake values only) | A | W | accepted; old value never shown |
| CONN-05 | Editor attempts connector admin actions | E | R | blocked |
| CONN-06 | disconnect and reconnect | A | W | state transitions correct; no orphan state |
| CONN-X1 | real store or marketplace credentials; live publish | n/a | X | excluded |

### 5.5 Imports and bulk operations (IMP)

| ID | Scenario | Role | Class | Expected |
|---|---|---|---|---|
| IMP-01 | upload a valid small file of `QA Flow` rows | E | W | job completes; row count matches; products exist |
| IMP-02 | file with invalid rows | E | W | per-row errors shown; valid rows handled as documented |
| IMP-03 | partial failure then retry | E | W | retry processes only the failed rows; no duplicates |
| IMP-04 | the same file twice (idempotency) | E | W | no duplicate products, or a clear duplicate report |
| IMP-05 | job status page over time; refresh mid-job | E | W | status progresses; refresh does not restart or lose it |
| IMP-06 | bulk edit on a QA selection | E | W | exactly the selected items change; counts match |
| IMP-07 | oversize or wrong-format file | E | W | refused clearly |

### 5.6 Media (MED)

| ID | Scenario | Role | Class | Expected |
|---|---|---|---|---|
| MED-01 | upload, thumbnail in the library and in the product tab | E | W | renders for Tenant A **and** Tenant B personas |
| MED-02 | open an asset view and download | E | W | correct bytes (compare size or hash) |
| MED-03 | inaccessible asset (deleted or wrong id) | E | R | not found, no stack trace |
| MED-04 | cross-tenant attempt on another tenant's asset id | T | R | refused |
| MED-05 | *after* the signing key is activated: signed-URL smoke tests S1 to S10 | A, E | W | per `docs/runbooks/media-signing-activation-runbook.md`; **not run until a human activates the key** |

### 5.7 Billing and plan controls (BILL)

| ID | Scenario | Role | Class | Expected |
|---|---|---|---|---|
| BILL-01 | plan page, limits and usage counters | A | R | counters match the real counts of QA records |
| BILL-02 | approach and exceed a limit on a **QA tenant only** | E | W | warning, then a clear block; blocked operations really do not happen |
| BILL-03 | grace and trial states display | A | R | consistent with the plan profile |
| BILL-04 | non-default tenant behaves the same as the default for limits | A, T | R | no default-tenant-only behaviour |
| BILL-X1 | real checkout, upgrade, payment | n/a | X | excluded |

### 5.8 Operational jobs: silent no-op detection (OPS)

| ID | Scenario | Role | Class | Expected |
|---|---|---|---|---|
| OPS-01 | after an import, export or bulk run, the job page's processed counts equal the data actually present | E | W | non-zero where expected; matches lists |
| OPS-02 | notifications and dashboard figures update after real work | E | W | change is visible without a manual trick |
| OPS-03 | a scheduled or recovery job that should act on a QA tenant | A | W | shows evidence of acting on the **non-default** tenant, not only the default |
| OPS-04 | admin audit and error-authority pages reflect the actions just taken | A | R | entries present with correct actor and tenant |

### 5.9 Adversarial and robustness (ADV)

Run these **inside** the journeys above, against QA tenants only: double-click submit; refresh mid-operation; browser back and forward after a write; two tabs; logout in another tab; repeated identical request; very long, empty and strange values; expired or reused links; operation on a stale object; operation after the role was changed by an admin; network interruption then retry (offline toggle in the browser tools). Expected everywhere: **no duplicate, no half-applied state, no silent success, no data from another tenant, a clear message.**

### 5.10 Permission boundaries (PERM)

| ID | Scenario | Expected |
|---|---|---|
| PERM-01 | Editor attempts an admin function (users, plan, auth policy) | blocked in the UI **and** refused by the API |
| PERM-02 | Reviewer attempts a mutation (edit, publish, delete) | blocked; comments allowed |
| PERM-03 | Viewer attempts any write | blocked |
| PERM-04 | a role is changed while the user is signed in, then the user acts | the new permission applies on the next action |
| PERM-05 | Tenant A persona requests Tenant B resources by guessed ids | refused or not found |

### 5.11 AI journey (later; not run now)

Added **only after** the live provider is enabled under the programme's gates: the user requests a suggestion; the proposal appears with source and evidence; reject leaves the Product unchanged; edit preserves the audit trail; approve follows the normal Product Service path; the AI never mutates the canonical product directly; prompt-injection-like supplier text cannot trigger an action. **Excluded now: no provider is enabled.**

## 6. Evidence record (one row per scenario run)

| Field | Content |
|---|---|
| Test ID, date and time (UTC), build or commit shown by the app, if visible | |
| Role, tenant, signed-in persona (name of the QA account, not a credential) | |
| Precondition | |
| Steps | |
| Expected result | |
| Actual result | |
| Network or API evidence | method, path, status code only (no tokens, no bodies with customer data) |
| UI evidence | description or a screenshot filed locally; screenshots are not committed unless sanitised |
| **Result-state check (section 4)** | what independent observation confirmed it |
| PASS / FAIL / BLOCKED | |
| Defect ID and severity | |
| Records created (to the register) | |

**Severity:** S1 data from another tenant visible, or a silent no-op on a business action, or loss or corruption of data; S2 a core journey blocked or a permission boundary failed without data exposure; S3 wrong or misleading result with a workaround; S4 cosmetic. **Defect IDs** follow `QA-<area>-<nn>` and are filed as GitHub issues in this repository (the project has no other tracker).

## 7. Cadence

- After each meaningful **deployed** slice from Stream A: a focused pass over the areas it touches (for example TEN, MED and OPS after a sweeper or media slice).
- One **larger certification pass before the restricted-role cutover**, covering every scenario above, repeated **after** the cutover on the same QA tenants (MED-01, TEN-01 to TEN-08 and OPS-03 are the ones that prove non-default tenants survive row level security from the user's side).
- This lane never gates a deploy on its own; it produces evidence for the human release decision.

## 8. Existing automation, not duplicated

The repository already has Playwright E2E (`playwright.config.cjs`) and earlier browser QA records. This lane covers what that automation does not: multi-persona, multi-tenant, adversarial interaction and result-state verification on the deployed app. Where an automated test already proves a path, the lane samples it rather than repeating it.

## 9. Defect handling

Each FAIL becomes an issue with the evidence row, the severity and the minimal steps. An S1 stops the lane (section 2, stop conditions) and is reported immediately. The lane does not fix defects; fixes go through the normal PR flow, and a fixed defect is re-tested by re-running its scenario.

## 10. What this lane does not decide

It does not approve a release, certify RLS, or replace a Security or QA sign-off. A pass is evidence, not a decision.

## 11. Inputs needed before execution

1. The **two or more QA tenant keys** (and, if available, confirmation they are synthetic and disposable).
2. The **plan tier** of each (it decides which personas can exist), and the list of QA persona accounts per tenant (names only).
3. Confirmation of the app URL (`app.vexapim.com`) as the target.
4. The human **signs each persona in** to the browser pane when asked; the agent never handles credentials.
5. Whether any real tenant may be observed read-only (default: no).

Until these are supplied the lane is **BLOCKED**, and no scenario is run.
