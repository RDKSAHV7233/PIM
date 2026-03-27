# TEJ PIM Master User Guide

- Version: 1.1
- Date: 2026-03-09
- Repo validation baseline: `0ae974c`
- Basis: strict current-code-only validation against route files, page components, UI helpers, and route-bound server actions used by the current TEJ PIM application
- Validation mode: current-code-only
- Current documented route inventory source: `apps/web/src/app/`

## 1. Document Overview

### Purpose of the document
This guide explains how to use the current TEJ PIM application page by page. It is intended to support live operations, onboarding, QA verification, product reviews, implementation planning, support troubleshooting, and user training. The guide is grounded in current TEJ PIM route files, page components, and route-bound UI behavior verified directly from code.

### Who should use it
- Admins configuring plan, privacy, access, and connector permissions
- Catalog Managers supervising taxonomy, completeness, and readiness
- Catalog Executives and Content Teams updating products, media, and attributes
- Quality Reviewers resolving issues and triaging approval queues
- Operations Managers monitoring imports, jobs, retries, and repair workflows
- Marketplace / Channel Managers installing connectors and maintaining mappings
- Viewers who need read-only catalog and operations visibility
- Product, design, engineering, onboarding, support, and QA teams

### User roles covered
TEJ PIM currently implements three technical roles:
- `admin`
- `editor`
- `viewer`

Business roles in this guide map to the current technical model as follows:

| Business Role | Current Technical Role Mapping | Notes |
|---|---|---|
| Admin | `admin` | Full governance, connector access, plan access, privacy actions |
| Catalog Manager | `editor` or `admin` | Uses catalog, quality, channels; admin if taxonomy/control changes are needed |
| Catalog Executive | `editor` | Day-to-day product editing |
| Content Team | `editor` | Content, attributes, media, validation |
| Quality Reviewer | `editor` | Quality surfaces exist; no separate technical reviewer role today |
| Operations Manager | `editor` or `admin` | Imports, bulk edit, jobs, repair, usage visibility |
| Marketplace / Channel Manager | `editor` plus connector permissions, or `admin` | Install/reconnect/uninstall may be permission-gated |
| Viewer / Read-only User | `viewer` | Monitoring and drill-down only |

### Scope of the guide
This guide covers:
- current top-level navigation shell
- current implemented pages under Dashboard, Products, Catalog, Channels, Quality, Operations, and Settings (`/admin/*` governance routes)
- current auth routes
- current product-detail tabs and embedded workflows
- pages requested in the brief that are not standalone routes in TEJ PIM today
- legacy redirect surfaces that still exist but are no longer the main entry points

This guide does not invent new pages, new roles, new workflows, or future-state UX that is not present in the current TEJ PIM project.

### Key assumptions
- The guide reflects the current implemented shell from `apps/web/src/components/nav/app-sidebar.tsx`.
- The canonical mapping workflow is `/channels/mappings`.
- Product create is implemented inline within the product workbench, not as a separate route.
- Several requested items are not standalone pages in the current product. Those are explicitly marked as one of:
  - `Implemented inside another page`
  - `Legacy redirect`
  - `Information not available in current TEJ PIM project`
- Additional locale support is deferred. English is the only supported visible UI language in the current scope.

### Navigation principles of the product
TEJ PIM is organized into seven operating zones:
- `Dashboard`: what needs attention now
- `Products`: catalog workbench and product creation surface
- `Catalog`: category, attribute, and media definitions
- `Channels`: connector setup, mappings, submissions, and channel health
- `Quality`: validation, issue inbox, completeness, approvals, rejection insights
- `Operations`: imports, bulk edit, jobs, repair
- `Settings` / admin routes: plan, users, connector access, privacy, audit, workspace

### How to read the guide
- Start with sections 1 to 4 if you are new to TEJ PIM.
- Use section 5 for route-level operation details.
- Use section 7 for end-to-end journeys.
- Use section 8 for role-specific training.
- Use section 9 for support and exception handling.
- When a requested page is not implemented, follow the related-page guidance to the actual TEJ PIM surface.

## 2. Product Overview

### What TEJ PIM is
TEJ PIM is a multi-tenant product information management and marketplace operations application. It helps India-focused sellers and catalog teams manage product records, attributes, categories, variants, media, validation issues, completeness, approval queues, imports, bulk edits, channel mappings, connector submissions, and governance settings in one web workspace.

### Business problems it solves
- fragmented product data spread across spreadsheets and marketplace-specific formats
- inconsistent taxonomy and attribute definitions across products
- low data completeness before listing submission
- unclear publish blockers caused by missing fields, channel rules, or media gaps
- slow operational repair loops for imports and failed submissions
- tenant-level governance for plan limits, privacy requests, and connector access

### Core modules
- Authentication and session access
- Dashboard
- Product Workbench
- Catalog Categories
- Catalog Attributes
- Media Library
- Channels Overview
- Connectors
- Mapping Manager
- Submissions
- Channel Health
- Issue Inbox
- Validation
- Rejection Insights
- Completeness
- Approval Queue
- Imports
- Bulk Edit
- Jobs
- Repair Center
- Admin Workspace
- Plan & Usage
- Users & Roles
- Connector Access
- Privacy
- Audit Logs summary

### Typical end-to-end user journey
1. User signs in.
2. Dashboard shows catalog health, publish blockers, queue pressure, and quick actions.
3. User opens Products to create or triage products.
4. User edits product content, attributes, variants, and media.
5. User resolves quality issues and reviews readiness.
6. Channel Manager verifies connectors and mappings.
7. User submits product data to a channel.
8. Operations tracks jobs, retries failures, and repairs import/submission exceptions.
9. Admin governs plan usage, permissions, and privacy workflows.

### Primary value for each role
- Admin: governance, access control, privacy, plan enforcement, audit visibility
- Catalog Manager: catalog health oversight and readiness management
- Catalog Executive: fast product updates and issue resolution
- Content Team: structured content enrichment and media association
- Quality Reviewer: blocker triage and workflow review visibility
- Operations Manager: import and submission recovery surface
- Marketplace Manager: connector setup, channel mappings, submission monitoring
- Viewer: read-only visibility across the platform

## 3. Role-Based Access Summary

| Capability Area | Admin | Editor | Viewer |
|---|---|---|---|
| View dashboard and drill-down links | Yes | Yes | Yes |
| Create and update products | Yes | Yes | No |
| Create categories | Yes | No | No |
| Create attributes / manage taxonomy definitions | Yes | No | No |
| Upload media / bulk associate media | Yes | Yes | No |
| Resolve issue warnings | Yes | Yes | No |
| Trigger validation from product detail | Yes | Yes | No |
| Create variants | Yes | Yes | No |
| Create submission/export jobs | Yes | Yes | No |
| Install connectors | Yes or connector-permitted | Yes if server grants permission | No |
| Reconnect / disable connectors | Yes or connector-permitted | Yes if server grants permission | No |
| Delete disabled connector record | Yes | No | No |
| Create / validate / publish / rollback mappings | Yes | Yes, with step-up where required | No |
| View imports, jobs, repair center | Yes | Yes | Yes |
| Apply bulk edit | Yes | Yes | No |
| Change plan tier | Yes | No | No |
| Grant/revoke connector permissions | Yes | No | No |
| Request privacy export / deletion | Depends on logged-in actor | Depends on logged-in actor | Depends on logged-in actor |
| View audit log summary page | Yes | Yes | Yes |

### Approval rights
- Current TEJ PIM has approval visibility through `in_review` status and Quality pages.
- A dedicated separate approval-role permission model is not available in current TEJ PIM.
- Final approval actions are not implemented as a standalone decision console.

### Import/export rights
- Editors and Admins can act on import repair and bulk edit actions.
- Viewers can monitor but not mutate.
- Channel submission initiation occurs from product detail and requires write access.

### Settings access
- Settings routes are visible in navigation and resolve to `/admin/*` governance pages.
- Plan tier updates and connector-permission changes are admin-only.
- Viewer access is effectively read-only across admin pages.

### Connector/channel access
- Connector actions are server-gated, not only UI-gated.
- The UI exposes blocked reasons such as missing permission or plan limits.
- Connector permissions can target roles or individual principals.

### Audit/log visibility
- Audit summary page exists.
- Detailed explorer UI is not yet implemented.
- Server-side audit capture exists for key governance and connector lifecycle actions.

## 4. Global UI Conventions

### Header
- Sticky top header across authenticated pages
- Product name link: `TEJ PIM`
- Role badge visible when a server session is present
- Logout button visible when an auth token is present

### Sidebar
Current production sidebar sections are:
- Dashboard > Overview
- Products > Product Workbench
- Catalog > Categories, Attributes, Media
- Channels > Overview, Connectors, Mappings, Submissions, Health
- Quality > Issue Inbox, Validation, Rejection Insights, Completeness, Approval Queue
- Operations > Imports, Bulk Edit, Jobs, Repair Center
- Settings > Workspace Settings, Plan & Usage, Users & Roles, Connector Access, Privacy, Audit Logs

`Labs / Internal` exists in code but is hidden from normal production navigation.

### Breadcrumbs
- Most pages display a short breadcrumb line in the page header
- Product detail includes links back to Dashboard and Catalog
- Breadcrumbs describe operating context rather than full hierarchy depth

### Search, filters, and filter bars
- Filters are page-specific, usually near the top of list pages
- Filter bar patterns use `Apply` and `Clear`
- Filters persist through query parameters
- Some pages also expose `hideTestData` toggles

### Saved views
- Current saved-view behavior is implemented as route query presets, not named user-persisted objects
- Example: Product Workbench `All`, `Needs Attention`, `Ready`

### Tables
- Tables are the dominant list pattern
- Typical columns use status chips, connector or product identifiers, timestamps, counts, and action links
- Wide tables are wrapped in `overflow-x-auto`

### Bulk actions
- Bulk actions are limited and page-specific today
- Issue Inbox: resolve selected warnings
- Bulk Edit: preview and apply changes to a filtered scope
- Media: bulk association by CSV content

### Status badges
- `StatusChip` is used consistently for statuses such as draft, active, success, warning, blocked, dead-letter, or required/optional states
- Status chips matter because they provide fast triage cues across catalog, quality, jobs, and channels

### Drawers / modals
- Plan-limit interruptions use a modal pattern
- Most other actions use inline cards/forms rather than drawers

### Toasts / alerts / banners
- Success and error banners are usually inline at the top of the page or inside the affected card
- Examples:
  - login error banner
  - connector permission granted/revoked banner
  - plan tier updated banner
  - product update conflict banner

### Empty states
- Empty states are explicit and action-oriented on major pages
- They usually explain why the page is empty and provide a next action such as `Open Products`, `Install connector`, or `Import from Excel`

### Error states
- Auth errors redirect to login with a reason banner
- Validation and update conflicts are shown inline with human-readable copy
- Some pages surface blocked reasons directly under disabled actions

### Loading states
- Server-rendered pages usually render after data load rather than showing long client-side spinners
- Client-side auth pages use submission-state button text and countdown banners

### Permission-denied states
- Viewer mode usually shows read-only text instead of disabled forms
- Admin-only sections explain that admin access is required
- Connector-action denial messages include server reason strings translated into UI copy

### Unsaved changes behavior
- Product edit and similar workflows are form-submit based; there is no global unsaved-changes modal validated in current TEJ PIM
- Best practice is to submit before navigating away

### Audit/history access patterns
- Product activity is shown inside Product Detail > Activity
- Governance audit summary is shown at `/admin/audit`
- Job and submission history live in Operations Jobs and Channels Submissions

## 5. Page-by-Page Detailed User Guide
## Login
### A. Purpose
- Provides the primary entry point into TEJ PIM.
- Used by Admin, Editor, and Viewer users.
- Primary business objective: authenticate the user and route them into the correct application shell.

### B. When users come here
- Starting a new session
- Returning after logout
- Returning after session expiry or forbidden redirect
- Recovering from repeated invalid login attempts

### C. Page layout / screen structure
- Centered auth card
- Title and subtitle
- Optional reason banner (`forbidden` or `session_expired`)
- User ID field
- Password field
- Primary `Sign in` button
- Error banner area
- Rate-limit/lockout panel when applicable
- Inline forgot-password prompt when attempts are low

### D. Field-by-field / section-by-section explanation
- `User ID`: text input, required, sent as `userId`; identifies the account to authenticate.
- `Password`: password input, required.
- `Sign in`: submits to `/api/auth/login`; on success performs full redirect to the requested next path.
- Reason banner: explains why the user was returned to login.
- Attempts remaining hint: appears when the server returns `401` with low remaining attempts.
- Rate-limit panel: appears on `429`, includes retry countdown.

### E. User actions
- Sign in
  - Who: any user
  - Steps: enter User ID and Password -> click `Sign in`
  - Expected result: redirect to `/dashboard` or the sanitized next path, with authenticated shell
  - Failure scenarios: invalid credentials, temporary rate limit, account lockout, network error
  - Edge cases: stale tab after login, expired session, repeated failed attempts
- Navigate to password reset
  - Who: any user
  - Steps: click reset link from the low-attempt hint or open `/login/reset`
  - Expected result: user reaches reset-request screen

### F. Detailed use cases
1. Actor: Catalog Executive. Goal: start the day and open Dashboard. Preconditions: active account. Journey: enter credentials -> submit -> land on Dashboard with sidebar. System response: server sets session cookies and loads authenticated shell. Success: Dashboard visible. Failure: invalid credentials banner.
2. Actor: Admin. Goal: resume work after session expiry. Preconditions: prior session expired. Journey: redirected to `/login?reason=session_expired` -> sign in again. System response: amber banner explains expiry. Success: redirected back to requested page.
3. Actor: Viewer. Goal: open read-only dashboard. Preconditions: viewer account active. Journey: sign in. Success: dashboard loads but editing controls remain absent on later pages.
4. Actor: Quality Reviewer. Goal: avoid lockout after repeated mistakes. Journey: sees low-attempt hint -> opens reset page before exhausting attempts. Success: reset request sent.
5. Actor: Operations Manager. Goal: recover from rate limit. Journey: too many attempts -> sees countdown -> waits -> retries. Success: login works after countdown.

### G. Business rules
- Auth cookie drives the authenticated shell.
- Redirect path is sanitized before navigation.
- The system does not expose raw auth internals in the login UI.
- Lockout and rate-limit behavior comes from server responses.

### H. Validations and edge cases
- User ID required
- Password required
- `401`: invalid credentials
- `423`: redirects to locked page with masked email and unlock time
- `429`: shows countdown panel
- network failure: generic login network error

### I. Related pages
- `/login/reset`
- `/login/locked`
- `/dashboard`

### J. Tips / best practices
- Use password reset before repeated failed attempts cause lockout.
- If redirected from another page, finish sign-in and allow the full redirect to complete.

### K. Support / troubleshooting notes
- If login succeeds but the app shell is incomplete, verify cookies and reload in a fresh session.
- If the lockout screen appears unexpectedly, support should verify account unlock timing and prior failed attempts.

## Forgot password / reset password
### A. Purpose
- Requests reset instructions for a user account.
- Used by any user who cannot sign in.
- Primary business objective: recover access without requiring manual admin intervention for common cases.

### B. When users come here
- User forgot password
- User receives low-attempt warning from login
- Support directs user to self-serve reset request

### C. Page layout / screen structure
- Title and subtitle
- Email field
- `Send reset link` button
- Success or error banner
- Back-to-login link

### D. Field-by-field / section-by-section explanation
- `Email`: required email input; prefilled when arriving from login warning link.
- `Send reset link`: posts to `/api/auth/password-reset/request`.
- Success message: generic confirmation that avoids revealing account existence.
- Error message: shown for request failure.
- Back to login: returns user to `/login`.

### E. User actions
- Request password reset
  - Who: any user
  - Steps: enter email -> submit
  - Expected result: generic success confirmation
  - Failure scenarios: network failure, server error
  - Edge cases: mistyped email, unregistered email, repeated submissions

### F. Detailed use cases
1. Actor: Catalog Executive. Goal: recover forgotten password. Preconditions: remembers work email. Outcome: success message shown.
2. Actor: Admin. Goal: guide another user through recovery. Outcome: uses page without revealing whether the email exists.
3. Actor: Viewer. Goal: request reset from a prefilled email link. Outcome: one-click completion after confirming email.

### G. Business rules
- Reset request UI should not reveal whether the email exists.
- Reset is request-based; full reset completion page is not surfaced as a separate validated route in current TEJ PIM.

### H. Validations and edge cases
- Email required
- Invalid or mistyped email still returns generic flow outcome
- Network/server failure shows generic reset error

### I. Related pages
- `/login`
- `/login/locked`

### J. Tips / best practices
- Verify the workspace email address before submitting.

### K. Support / troubleshooting notes
- If no email arrives, support should verify mail delivery, account status, and reset service health.

## MFA / OTP verification if applicable
### A. Purpose
- Information not available as a standalone MFA or OTP page in current TEJ PIM.
- Current high-risk confirmation is implemented as password-based step-up re-authentication inside `/channels/mappings`.

### B. When users come here
- Not applicable as a standalone route.

### C. Page layout / screen structure
- Not applicable as a standalone route.

### D. Field-by-field / section-by-section explanation
- Step-up password field exists inside the Mapping Manager when high-risk actions require it.

### E. User actions
- Re-confirm password during mapping publish, rollback, or archive when prompted.

### F. Detailed use cases
1. Actor: Marketplace Manager. Goal: publish mapping after step-up password confirmation.
2. Actor: Admin. Goal: rollback a mapping version after re-authentication.

### G. Business rules
- Step-up is embedded, not global.

### H. Validations and edge cases
- Wrong step-up password blocks the protected action.

### I. Related pages
- `/channels/mappings`

### J. Tips / best practices
- Treat step-up prompts as approval checkpoints for high-risk mapping actions.

### K. Support / troubleshooting notes
- If repeated step-up failures occur, verify the current login password and session state.

## Session expired / unauthorized page
### A. Purpose
- No dedicated standalone session-expired page exists.
- TEJ PIM routes unauthorized or expired sessions back to login with a reason code.

### B. When users come here
- Accessing a protected page without a valid session
- Returning from a forbidden or expired request

### C. Page layout / screen structure
- Implemented through Login page reason banners.

### D-K.
- Use the Login page guidance above. The equivalent messages are `session_expired` and `forbidden`.

## Dashboard
### A. Purpose
- Central operational landing page.
- Used by all roles.
- Primary business objective: show what is broken, what is pending, and what the user should do next.

### B. When users come here
- Immediately after login
- Returning from a task to review health again
- Starting daily catalog or channel operations
- Checking plan usage, import pressure, or queue backlog

### C. Page layout / screen structure
- Page header: title, description, quick action buttons (`New Product`, `Fix Issues`, `Import Catalog`)
- Catalog Health KPI row
- Publishing Health KPI row
- `Top products to fix now` table
- `Next best actions` card
- `Catalog Work Queue` card
- `Operations & Usage` card

### D. Field-by-field / section-by-section explanation
- `New Product`: opens Product Workbench where product creation is done inline.
- `Fix Issues`: links to Issue Inbox.
- `Import Catalog`: links to Imports.
- `Products Needing Enrichment`: count of incomplete SKUs.
- `Blocking Issues`: open blocking issue count.
- `Pending Approvals`: count of items in review.
- `Ready to Publish`: readiness count from dashboard health snapshot.
- `Blocked Listings`: listings blocked by channel rules.
- `Active Channels`: installed connectors with active status.
- `Warnings to Review`: non-blocking issues.
- `Top products to fix now`: prioritized list with product, reason, completeness, updated time, and `Open product` link.
- `Next best actions`: quick links into products, issues, approvals, and mappings.
- `Catalog Work Queue`: summarized queue chips.
- `Operations & Usage`: import repair count, jobs needing retry, plan tier, SKU usage.

### E. User actions
- Open products needing attention
- Open Issue Inbox
- Open Approval Queue
- Open Mapping Manager
- Open Plan & Usage
- Start product creation indirectly via Product Workbench

For each action:
- Who: all users can view links; write actions depend on destination permissions.
- Expected result: navigation to the target workspace.
- Failure scenarios: login expiry, forbidden destination, stale data counts.
- Edge cases: counts can be zero while downstream pages still contain filtered history.

### F. Detailed use cases
1. Actor: Catalog Manager. Goal: identify the top products blocking catalog throughput. Steps: open Dashboard -> review `Top products to fix now` -> open the first product. Success: manager starts with highest-impact SKU.
2. Actor: Operations Manager. Goal: see if imports need repair. Steps: check `Operations & Usage` -> open Imports or Jobs. Success: repair backlog visible.
3. Actor: Marketplace Manager. Goal: assess channel health before publish push. Steps: review Publishing Health -> open `Review channel mappings`. Success: mapping or readiness workflow begins.
4. Actor: Admin. Goal: review current plan pressure. Steps: check usage card -> open Plan & Usage. Success: admin sees resource meters and limits.
5. Actor: Viewer. Goal: monitor overall catalog status without editing. Steps: review KPIs and drill to read-only pages. Success: sees the same health context without write controls.

### G. Business rules
- Dashboard is read-only and route-based; it does not mutate state.
- KPIs come from multiple APIs and represent operational snapshots.
- Quick actions are navigation shortcuts, not hidden mutations.

### H. Validations and edge cases
- zero-state metrics are valid and should not be treated as errors
- if underlying APIs fail due to auth, user is redirected to login
- high counts indicate workload, not necessarily page failure

### I. Related pages
- `/catalog/products`
- `/quality/issues`
- `/quality/approvals`
- `/channels/mappings`
- `/operations/imports`
- `/admin/plan`

### J. Tips / best practices
- Use Dashboard to prioritize, not to perform detailed edits.
- Move from Dashboard to specific workspaces once the main issue area is clear.

### K. Support / troubleshooting notes
- If Dashboard counts look wrong, compare with Issue Inbox, Jobs, and Plan pages to isolate stale or missing source data.

## Notifications / alerts center
### A. Purpose
- Implemented as a topbar notification center in current TEJ PIM.
- Used to review recent async import, publish, and approval events without navigating into each operational page first.

### B-K.
- Use the bell icon in the authenticated header to open the notification panel.
- The panel supports unread counts, direct action links, and mark-read behavior.
- Current TEJ PIM does not implement a separate full-page notifications route.

## User profile / account settings
### A. Purpose
- Information not available as a standalone page in current TEJ PIM.
- TEJ PIM does not currently implement a dedicated profile editor, account-preferences page, or account-settings console.

### B-K.
- Do not treat `/admin/privacy` as a profile page. It is a separate Data and Privacy workflow for export and deletion requests.
- Current account-related controls visible in the UI are limited to logout and privacy workflows.
## Product list
### A. Purpose
- Main catalog workbench at `/catalog/products`.
- Used heavily by Admin, Editor, Catalog Manager, Catalog Executive, Content Team, and Viewer.
- Primary business objective: triage products, start creation, monitor readiness, and navigate to product detail.

### B. When users come here
- Beginning daily catalog work
- After Dashboard drill-down
- To create a new product
- To review completeness and channel readiness at scale
- To check onboarding progress for a new tenant

### C. Page layout / screen structure
- Sticky top workbench bar with breadcrumb, saved-view chips, triage counters, Issue Inbox link, and `Hide test data`
- `Getting Started` or `Workbench Actions` card
- Optional urgent warning banner when products need attention
- `+ New Product` button and plan-limit badge if SKU usage is high
- Inline Create Product form when expanded
- Product table with Title, Category, Status, Complete %, Compliance Issues, Channel Readiness, Last Updated, Variants
- Empty states for empty catalog and no matching products

### D. Field-by-field / section-by-section explanation
- Saved views: `All`, `Needs Attention`, `Ready`; changes route query, not a named persistent object.
- Triage counters: counts of `Needs Attention`, `At Risk`, and `Ready` products.
- `Hide test data`: excludes seeded/demo data from the workspace.
- `Getting Started`: onboarding checklist for first import, completeness review, first issue fix, first channel connection.
- `Workbench Actions`: direct links to Issue Inbox, Approvals, Bulk Edit, and Mappings once onboarding is underway.
- `+ New Product`: expands inline create form for writers.
- Plan-limit badge: warns near or over SKU limit and links to Plan page.
- Table columns:
  - `Title`: product title plus brand summary
  - `Category`: category path or fallback category ID
  - `Status`: draft/active/archived chip
  - `Complete %`: completeness score
  - `Compliance Issues`: GST/HSN and required-data issue count
  - `Channel Readiness`: per-product readiness cell
  - `Last Updated`: localized timestamp
  - `Variants`: count of variants

### E. User actions
- Open a product
  - Who: all roles
  - Steps: click product title
  - Result: open Product Detail
  - Failure: auth/session failure redirects to login
- Create a product
  - Who: Admin, Editor
  - Steps: click `+ New Product` -> fill form -> submit
  - Result: new product created and workbench refreshes
  - Failure: plan limit, validation, network/server error
- Switch saved view
  - Who: all roles
  - Steps: click `All`, `Needs Attention`, or `Ready`
  - Result: query updates and filtered list renders
- Hide/show test data
  - Who: all roles
  - Result: route query updates and list re-renders
- Open downstream workspaces
  - Who: all roles
  - Steps: use workbench actions or row links

### F. Detailed use cases
1. Actor: Catalog Executive. Goal: create a new SKU manually. Preconditions: editor access. Journey: open Products -> click `+ New Product` -> submit basic details -> open created product. Success: new SKU exists and is editable.
2. Actor: Catalog Manager. Goal: focus only on risky products. Journey: switch to `Needs Attention`. System response: list filters to blocking/at-risk products. Success: manager sees only priority SKUs.
3. Actor: Marketplace Manager. Goal: find products ready for channel submission. Journey: open `Ready` view -> sort mentally by readiness and open products. Success: ready SKUs isolated.
4. Actor: Admin. Goal: verify tenant onboarding progress. Journey: review `Getting Started` checklist. Success: sees exactly which first-run steps remain incomplete.
5. Actor: Viewer. Goal: monitor catalog throughput. Journey: open workbench, inspect statuses and readiness cells, open a specific product read-only. Success: visibility without edit controls.

### G. Business rules
- Product creation is inline, not a separate route.
- Viewer role is read-only.
- Triage is driven by compliance and channel-readiness state.
- Plan usage can block product creation.

### H. Validations and edge cases
- Empty catalog shows action-oriented empty state.
- If selected filter yields zero rows, a filter-clear empty state appears.
- Readiness statuses load asynchronously into the table.
- Plan limit warnings can appear before limit is reached.

### I. Related pages
- `/products/[id]`
- `/quality/issues`
- `/quality/approvals`
- `/operations/bulk-edit`
- `/channels/mappings`

### J. Tips / best practices
- Use the workbench for triage and navigation, not deep editing.
- Clear filters before assuming products are missing.

### K. Support / troubleshooting notes
- If products seem missing, check `Hide test data`, selected view, and whether the tenant actually has product rows.

## Saved views
### A. Purpose
- Implements quick triage presets inside Product list.
- Roles: all.
- Primary objective: reduce catalog scanning time.

### B-K.
- Implemented inside `/catalog/products`.
- Views available today: `All`, `Needs Attention`, `Ready`.
- They are query-based presets, not separately named user-managed saved views.

## Product details overview
### A. Purpose
- Core product workspace at `/products/[id]`.
- Used by all roles; write actions for Admin and Editor.
- Primary business objective: edit, validate, publish, and monitor a single product in one segmented page.

### B. When users come here
- From Product Workbench row click
- From Issue Inbox `Fix Now`
- From Jobs or Submissions product links
- From approval and readiness workflows

### C. Page layout / screen structure
- Sticky page header with product title, SKU fragment, category, status, completeness, `Save`, `Validate`, `Submit`
- Tab navigation: `Overview`, `Content`, `Attributes`, `Variants`, `Media`, `Channels`, `Quality`, `Activity`
- Main content column showing active tab sections
- Persistent right rail with completeness, blocking issues, channel readiness, next actions

### D. Field-by-field / section-by-section explanation
- Header `Save`: submits product edit form when content or attributes are open.
- Header `Validate`: triggers validation action.
- Header `Submit`: jumps to the Channels tab.
- Overview card fields: Brand, Category, Status, Last updated, Completeness, Variants.
- Blocker card: blocking issues, warnings, publish blockers, fix-navigation links.
- Right rail:
  - `Completeness`
  - `Blocking Issues`
  - `Channel Readiness`
  - `Next actions`

### E. User actions
- Save product changes
- Run validation
- Open Channels tab for publish actions
- Open Quality tab to resolve issues
- Open Media Library for this product
- Create variant
- Trigger process/requeue for existing export jobs

### F. Detailed use cases
1. Actor: Content Team. Goal: update title and description. Preconditions: editor access. Steps: open product -> Content tab -> edit -> Save. Success: banner confirms update.
2. Actor: Quality Reviewer. Goal: inspect blockers from Issue Inbox. Steps: open product via `Fix Now` -> Quality tab. Success: exact issue list visible.
3. Actor: Marketplace Manager. Goal: submit a ready product. Steps: open product -> Channels tab -> review blockers -> create export job. Success: submission job created.
4. Actor: Operations Manager. Goal: requeue failed publish job. Steps: open product -> Channels tab -> publish attempts -> `Requeue`. Success: retry action sent.
5. Actor: Viewer. Goal: inspect completeness, issues, and history. Steps: open product -> switch tabs. Success: full read-only understanding without edit buttons.

### G. Business rules
- Product updates are versioned and can conflict.
- Viewer role cannot mutate the product.
- Mapping edits should happen in `/channels/mappings`, not via legacy template authoring unless transition inventory is still needed.

### H. Validations and edge cases
- `VERSION_CONFLICT` appears when expected version is stale.
- Plan-limit modal can interrupt publish creation.
- Empty variants, empty media, or no jobs are valid states.
- Missing channel mapping or quality blockers will prevent ready-to-publish state.

### I. Related pages
- `/catalog/products`
- `/catalog/media`
- `/quality/issues`
- `/channels/mappings`
- `/channels/submissions`
- `/operations/jobs`

### J. Tips / best practices
- Use tabs instead of scrolling aimlessly; each tab is a job area.
- Fix quality and mapping blockers before attempting channel submission.

### K. Support / troubleshooting notes
- If save fails repeatedly, reload and verify version conflict.
- If submit appears blocked, inspect both Quality and Channels tabs.

## Basic information tab
### A. Purpose
- Implemented inside Product Detail as `Content` tab.
- Used by writers and reviewers.
- Objective: maintain core fields such as title, brand, description, HSN, GST, and status.

### B. When users come here
- After opening Product Detail
- When fixing content or compliance fields

### C. Page layout / screen structure
- Versioned edit form
- Core text/number/select fields
- Save button via page header or form button

### D. Field-by-field / section-by-section explanation
- `Product Title`: required
- `Brand`: optional text
- `Description`: multiline content
- `HSN Code`: compliance-oriented value
- `GST Rate`: numeric value
- `Status`: `draft`, `active`, `archived`
- `Submitting with expected version`: optimistic-concurrency hint

### E. User actions
- Edit and save core fields
- Change status

### F. Detailed use cases
1. Update title after marketplace copy review.
2. Add missing brand.
3. Correct HSN code after compliance issue.
4. Change status from draft to active.
5. Review content in read-only mode.

### G. Business rules
- Save is blocked by version conflict if another update already landed.

### H. Validations and edge cases
- required title
- numeric GST input
- stale version conflict

### I-K.
- Related to Overview, Quality, and Product list. Best practice: save after each major content block.

## Attributes tab
### A. Purpose
- Product-level attribute editing within Product Detail.
- Objective: complete category-specific fields needed for quality and channel readiness.

### B. When users come here
- After category-specific validation failures
- Before channel submission

### C. Page layout / screen structure
- Dynamic attribute area inside the versioned edit form
- Inputs rendered from category attribute definitions
- Supports boolean, select, text, and number styles

### D. Field-by-field / section-by-section explanation
- Each attribute field uses the category definition name and required marker.
- `select` attributes render dropdowns from allowed values.
- `boolean` attributes render checkbox pattern.
- Numeric attributes render number inputs.
- Additional attributes are serialized back into product attributes JSON.

### E. User actions
- Fill required attributes
- Correct invalid or missing values
- Save changes

### F. Detailed use cases
1. Add fabric value from allowed list.
2. Toggle a boolean feature flag.
3. Enter numeric dimension or weight.
4. Fix a missing required attribute flagged in validation.
5. Review category-required fields before publish.

### G. Business rules
- Required markers come from taxonomy definitions.
- Allowed values are enforced at the UI level when definition type is select.

### H. Validations and edge cases
- missing required values remain quality blockers until resolved
- malformed numeric content is rejected by number input/browser validation
- categories with no extra attributes show informative empty message

### I-K.
- Related to Catalog Attributes, Quality, and Channel Readiness. Best practice: complete required attributes before switching to Channels.

## Variants tab
### A. Purpose
- Manage child variants for a parent product.
- Objective: capture SKU-level price, inventory, status, and variant attributes.

### B. When users come here
- Product requires size/color variants
- Inventory and price differ by SKU

### C. Page layout / screen structure
- `Add Variant` form
- Existing `Variants` table

### D. Field-by-field / section-by-section explanation
- `SKU Code`: required unique variant code
- `Inventory Quantity`: required numeric quantity
- `MRP`: optional number
- `Selling Price`: optional number
- `Status`: draft/active/archived
- `Variant Attributes`: freeform textarea payload
- Variants table columns: SKU, Attributes, MRP, Selling Price, Inventory, Status

### E. User actions
- Create variant
- Review existing variants

### F. Detailed use cases
1. Add a size-specific SKU.
2. Add color-specific attributes.
3. Set inventory to zero for temporarily unavailable stock.
4. Compare MRP vs selling price across variants.
5. Review variant status mix before publish.

### G. Business rules
- Viewer cannot create variants.
- Variant data contributes to downstream operational accuracy but is not exposed through a separate variant-detail route.

### H. Validations and edge cases
- SKU required
- inventory cannot be negative
- empty variant list is valid

### I-K.
- Related to Product overview and Pricing/Inventory view. Best practice: keep variant attributes structured and consistent.

## Media tab
### A. Purpose
- Media-oriented section inside Product Detail.
- Objective: route users to the Media library scoped to the current product.

### B-K.
- This tab does not host upload controls directly.
- Primary actions: `Open Media Library` and `Channel Media Health`.
- Use it when the product needs images, image validation, or asset linkage review.

## Compliance / mandatory data tab
### A. Purpose
- Implemented as `Quality` tab in Product Detail.
- Objective: run validation and inspect open issues.

### B. When users come here
- After a blocking issue
- Before submission
- During approval review

### C-K.
- Main controls: `Run validation` and issue panel.
- Empty state means no current issues found.
- Blocking issues must be fixed in content/attributes/media.

## Channel-readiness / completeness tab
### A. Purpose
- Implemented primarily as Product Detail `Channels` tab plus `ProductReadinessSummaryBar`.
- Objective: determine whether the product can be published.

### B-K.
- Shows readiness state, blockers, warnings, mapping link, quality link, submission form, simulation payload, template inventory, and publish attempts/recovery.
- Use it for preflight checks, job creation, process, and requeue flows.

## Pricing / inventory info view if applicable
### A. Purpose
- Implemented inside Product Detail `Variants` tab.
- Objective: review per-variant MRP, selling price, and inventory.

### B-K.
- There is no separate pricing or inventory route in current TEJ PIM.

## Audit/history tab
### A. Purpose
- Implemented as Product Detail `Activity` tab.
- Objective: show recent submission activity for the product.

### B-K.
- Current Activity view is submission-oriented, not a full product audit explorer.
- Use `/admin/audit` for governance summary and Operations/Channels pages for broader history.

## Linked categories / taxonomy section
### A. Purpose
- Implemented across Product Detail header/overview and Catalog pages.
- Objective: show the current category and drive attribute scope.

### B-K.
- Product detail shows category path; taxonomy changes themselves are managed in Catalog Categories.

## Related products / bundles if applicable
### A. Purpose
- Information not available in current TEJ PIM project.
- No standalone related-products or bundles UI was validated.

### B-K.
- Not implemented as a user-facing page or section.

## Product create page
### A. Purpose
- Implemented inline on `/catalog/products` rather than as a separate route.
- Objective: create a new product quickly from the workbench.

### B-K.
- Use the `+ New Product` inline form on Product Workbench.
- If plan limits block creation, the UI routes the user toward Plan & Usage.

## Product edit flow
### A. Purpose
- Implemented in `/products/[id]` across Content and Attributes tabs.
- Objective: update versioned product data safely.

### B-K.
- Expected sequence: open product -> edit content or attributes -> save -> validate -> review readiness.

## Product duplicate flow
### A. Purpose
- Information not available in current TEJ PIM project.
- No validated duplicate-product action or route was found.

### B-K.
- Not implemented.

## Archive / delete flow
### A. Purpose
- Current visible archive/delete product flow is not available as a dedicated user-facing action.
- Product status supports `archived`, but a dedicated delete/archive flow is not validated in the current UI.

### B-K.
- Use status changes where available. Permanent delete flow for products is not documented in current TEJ PIM.
## Category list
### A. Purpose
- Taxonomy review page at `/catalog/categories`.
- Used by Admins and read-only observers.
- Objective: review category hierarchy and create categories.

### B. When users come here
- Setting up taxonomy
- Reviewing available categories before product or attribute work
- Preparing attribute assignment

### C. Page layout / screen structure
- Header with title, description, and show/hide test-data toggle
- Categories table
- Admin-only `Create Category` form
- Optional `Show 100 more` / `Show all` controls

### D. Field-by-field / section-by-section explanation
- `Show test data` / `Hide test data`: include or exclude seeded data
- Categories table columns:
  - `Name`
  - `Path`
  - `Slug`
- `Category Name`: required for creation
- `Parent Category`: optional select; drives hierarchy
- `Create category`: submits category creation action

### E. User actions
- Review category list
- Toggle test data
- Increase list length
- Create category (admin only)

### F. Detailed use cases
1. Admin creates `Men's Shirts` under `Apparel`.
2. Catalog Manager reviews category path before assigning product taxonomy.
3. Attribute Admin verifies the correct category exists before adding definitions.
4. Viewer audits the current taxonomy list.
5. Admin exposes more rows for a large taxonomy set.

### G. Business rules
- Category creation requires admin role.
- Parent category is optional.
- Current page is flat-table focused; there is no separate interactive tree widget.

### H. Validations and edge cases
- category name required
- large taxonomies use pagination-by-limit pattern, not infinite scroll
- viewer/editor see management restriction message

### I. Related pages
- `/catalog/attributes`
- `/catalog/products`

### J. Tips / best practices
- Use clear category names and consistent nesting before large imports.

### K. Support / troubleshooting notes
- If category creation fails, verify admin role and duplicate-path or server constraints.

## Category create/edit page
### A. Purpose
- Category creation is embedded in the Category List page.
- Separate edit page is not validated in current TEJ PIM.

### B-K.
- Create: use the inline `Create Category` form on `/catalog/categories`.
- Edit: Information not available in current TEJ PIM project as a dedicated page.

## Category tree / hierarchy page
### A. Purpose
- Information not available as a standalone tree page in current TEJ PIM.
- Hierarchy is represented by `Parent Category` selection and `Path` column.

### B-K.
- Use `/catalog/categories` for current hierarchy review.

## Attribute list
### A. Purpose
- Attribute-definition workspace at `/catalog/attributes`.
- Used by Admins for governance and by other roles for review.
- Objective: manage category-scoped attribute definitions and required flags.

### B. When users come here
- Preparing taxonomy for product enrichment
- Investigating why a product requires certain fields
- Adding a new attribute definition for a category

### C. Page layout / screen structure
- Page header
- `Scope` card with category selector
- `Attribute Definitions` table
- Admin-only `Add Attribute Definition` form
- Related workspaces card

### D. Field-by-field / section-by-section explanation
- `Category`: required selector for current attribute scope
- Attribute table columns:
  - `Label`
  - `Key`
  - `Type`
  - `Scope`
  - `Required`
  - `Allowed Values`
- Add-form fields:
  - `Display Name`
  - `Key`
  - `Data Type`: text, number, boolean, select, json
  - `Applies To`: product or variant
  - `Required`: true or false
  - `Allowed Values (JSON array)`

### E. User actions
- Switch category scope
- Review definitions
- Add new attribute definition (admin)
- Navigate to Categories or Products

### F. Detailed use cases
1. Admin adds `fabric` as a required select attribute for a fashion category.
2. Admin adds `weight` as a numeric product attribute.
3. Admin adds a variant-level attribute for size or color representation.
4. Catalog Manager reviews which attributes are mandatory before onboarding a large category.
5. Viewer confirms allowed values for an existing field.

### G. Business rules
- Only admins can add definitions.
- Attribute scope depends on selected category.
- Allowed values are structured as JSON array text input.

### H. Validations and edge cases
- selected category required for scoped view
- invalid JSON array in allowed values will fail server-side creation
- categories with no definitions show explicit empty row

### I. Related pages
- `/catalog/categories`
- `/products/[id]`

### J. Tips / best practices
- Define required attributes before large imports.
- Prefer select values over free text when channel requirements are strict.

### K. Support / troubleshooting notes
- If an attribute does not appear on Product Detail, verify category scope and `Applies To`.

## Attribute group management
### A. Purpose
- Information not available in current TEJ PIM project as a standalone attribute-group UI.

### B-K.
- Current TEJ PIM manages attributes individually, scoped by category and applies-to.

## Attribute create/edit page
### A. Purpose
- Attribute creation is embedded inside `/catalog/attributes`.
- A standalone attribute edit page is not validated.

### B-K.
- Create: use `Add Attribute Definition`.
- Edit: Information not available in current TEJ PIM project.

## Attribute assignment to categories
### A. Purpose
- Implemented through the scoped attribute page.
- Objective: view or add attribute definitions for a selected category.

### B-K.
- Use the `Category` selector on `/catalog/attributes` to assign scope.
- Current implementation is category-scoped, not a drag-and-drop assignment matrix.

## Mandatory vs optional rule setup
### A. Purpose
- Implemented through the `Required` field on attribute definitions.
- Objective: control whether a field becomes a quality blocker.

### B-K.
- Use the `Required` selector in the Add Attribute Definition form.
- Current UI does not expose a separate rule-builder page.

## Validation rule setup
### A. Purpose
- Information not available as a standalone validation-rule editor.
- Validation behavior is reflected through issues, readiness, and product validation results.

### B-K.
- Current user-facing surfaces for validation are `/quality/validation`, `/quality/issues`, and Product Detail > Quality.

## Variant attribute setup
### A. Purpose
- Implemented through attribute definitions with `Applies To = variant`.

### B-K.
- Create the definition in `/catalog/attributes`, then use Product Detail > Variants to populate values.

## Media library
### A. Purpose
- Media workspace at `/catalog/media` (re-exporting `/media`).
- Used by Admins, Editors, Content Teams, and Viewers.
- Objective: upload media, bulk associate media, and validate assets against channel rules.

### B. When users come here
- A product needs images
- A channel media rule failed
- A bulk media association file needs to be processed
- User needs product-scoped asset review

### C. Page layout / screen structure
- Page header with links to Products and Channel Health
- Filter card with Product and Variant filters
- Upload Media card
- Bulk Media Association (CSV) card
- Media Assets table
- Optional Channel Validation card when a specific asset is selected

### D. Field-by-field / section-by-section explanation
- Filter fields:
  - `Product`
  - `Variant ID`
- Upload fields:
  - `Product`
  - `Variant ID`
  - `Image File`
  - `Width`
  - `Height`
- Bulk association fields:
  - `CSV Content`
  - expected headers: `skuCode,imageUrl,contentBase64,fileName,mimeType,width,height`
- Assets table columns:
  - `Asset`
  - `Product`
  - `Variant`
  - `Type`
  - `Dimensions`
  - `Size (KB)`
  - `Validation`
- Channel Validation fields:
  - `channel`
  - `Run validation`
  - results: valid/invalid, checks, issues, warnings

### E. User actions
- Filter assets
- Upload media
- Run bulk association CSV
- Open validation for a specific asset
- Re-run validation against another channel

### F. Detailed use cases
1. Content Team uploads the first hero image for a product.
2. Operations Manager bulk-associates many images from a CSV payload.
3. Marketplace Manager validates an asset against Amazon rules.
4. Catalog Executive filters media to a single product before fixing missing images.
5. Viewer reviews asset dimensions and validation outcomes.

### G. Business rules
- Viewer role is read-only.
- Media validation is channel-specific.
- Bulk association accepts either `contentBase64` or `imageUrl`.

### H. Validations and edge cases
- image file required for upload
- width/height optional depending on file context
- no selected asset means no validation card
- bulk association can complete without a dedicated progress tracker on this page

### I. Related pages
- `/products/[id]?tab=media`
- `/channels/health`

### J. Tips / best practices
- Filter by product before uploading to avoid orphaned assets.
- Validate representative assets for each required channel.

### K. Support / troubleshooting notes
- If validation looks wrong, confirm the selected channel and whether the asset dimensions were captured.

## Media upload page
### A. Purpose
- Implemented inside Media Library as the `Upload Media` card.

### B-K.
- There is no separate standalone upload route. Use `/catalog/media`.

## Media detail page
### A. Purpose
- Information not available as a separate asset-detail route.
- Asset detail is shown through the table and validation card inside Media Library.

### B-K.
- Use `/catalog/media` with `assetId` query context.

## Media tagging / organization
### A. Purpose
- Information not available in current TEJ PIM project as a standalone tagging or folder-management page.

### B-K.
- Current Media page focuses on upload, association, and validation.

## Product-media linking flow
### A. Purpose
- Implemented through product-scoped upload and bulk-association workflows in Media Library.

### B-K.
- Link assets by choosing a Product and optional Variant ID at upload time, or by CSV bulk association.

## Media validation issues view
### A. Purpose
- Implemented as the `Channel Validation` section in Media Library.

### B-K.
- Use `Validate` on an asset row, choose channel, review issues/warnings, then return to product or upload workflow if fixes are needed.
## Issues / quality inbox
### A. Purpose
- Issue triage page at `/quality/issues`.
- Used by Admins, Editors, Quality Reviewers, Catalog Managers, Operations leads.
- Objective: prioritize and route data-quality work with severity-aware filtering.

### B. When users come here
- After Dashboard `Fix Issues`
- During review of blockers before publish
- To resolve warning-level issues in bulk

### C. Page layout / screen structure
- Page header
- KPI cards for Open Issues, Resolved Today, Blocking Items
- `Today's Progress` card
- Filter bar with Severity, Connector Install, Category, Product Status, Page Size
- Issue table with optional selection checkboxes
- Pagination navigation via previous/next cursor links when returned by API

### D. Field-by-field / section-by-section explanation
- `Severity`: all, blocking, warning
- `Connector Install`: narrows issues to a connector installation
- `Category`: category filter
- `Product Status`: draft, active, archived
- `Page Size`: request limit, capped at 200
- Table columns:
  - `Select`: only for warning rows and only for writers
  - `Product`: name, SKU, category, product status
  - `Field`: field path
  - `Severity`
  - `Age`
  - `Message`: seller-facing issue plus suggested fix
  - `Action`: `Fix Now`
- `Resolve selected warnings`: bulk warning-resolution action

### E. User actions
- Apply filters
- Clear filters
- Open product from `Fix Now`
- Resolve selected warnings (writers only)

### F. Detailed use cases
1. Quality Reviewer filters to `BLOCKING` and starts highest-priority fixes.
2. Catalog Executive filters by category before a focused remediation sprint.
3. Marketplace Manager filters by connector installation to isolate channel-specific issues.
4. Admin bulk-resolves non-blocking warnings after a policy change.
5. Viewer reviews current issue load but cannot resolve warnings.

### G. Business rules
- Blocking issues cannot be bulk-resolved here; they must be fixed in product data.
- Warning rows can be selected for resolution by writers.
- Viewer role cannot mutate issue state.

### H. Validations and edge cases
- page size is sanitized and capped
- zero-item result renders empty state, not error
- `Age` may show `<1h` or day counts depending on timing

### I. Related pages
- `/products/[id]`
- `/quality/validation`
- `/quality/approvals`

### J. Tips / best practices
- Clear blockers first, warnings second.
- Filter by product status `in_review` when preparing approval decisions.

### K. Support / troubleshooting notes
- If a warning cannot be resolved, confirm it is not actually a blocking rule or already refreshed out of scope.

## Product review page
### A. Purpose
- Information not available as a separate dedicated route.
- Current product review work happens through `/products/[id]` plus `/quality/approvals` and `/quality/issues`.

### B-K.
- Use Product Detail for the actual record, and Approval Queue for review-state monitoring.

## Approval queue
### A. Purpose
- Review visibility page at `/quality/approvals`.
- Used by Admins, Editors, and Quality reviewers.
- Objective: monitor products in `in_review` state and understand whether they are blocked or clear for decision.

### B. When users come here
- During review cycles
- After products move to `in_review`
- Before final publish readiness confirmation

### C. Page layout / screen structure
- Page header
- KPI cards: Products In Review, Products Blocked, Warnings In Review, Clean For Decision
- Workflow Status card
- Operator Actions card
- Items In Review table or empty state

### D. Field-by-field / section-by-section explanation
- `Products In Review`: count from stats
- `Products Blocked`: number of in-review products with blocking issues
- `Warnings In Review`: in-review products with warnings
- `Clean For Decision`: pending approvals without current inbox issue rows
- `Open Review Issues`: jump to Issue Inbox filtered for `in_review`
- `Open Validation`: jump to validation overview
- Table columns: Product, Status, Severity, Field, Message

### E. User actions
- Open filtered review issues
- Open validation workspace
- Inspect in-review items

### F. Detailed use cases
1. Quality Reviewer checks whether review queue is actionable or blocked.
2. Catalog Manager measures how many in-review items are clean enough for decision.
3. Operations Manager validates that review backlog is not caused by hidden blockers.
4. Admin checks if workflow queues are growing.
5. Viewer monitors review-state health.

### G. Business rules
- This page is a monitoring queue, not a full approve/reject transaction console.
- It reflects actual `in_review` workflow status.

### H. Validations and edge cases
- no open issue rows does not always mean there are no products in review; the queue may still contain clean-for-decision items

### I-K.
- Related to Issue Inbox, Validation, and Product Detail. Best practice: always open the product before making a real business decision.

## Approval details page
### A. Purpose
- Information not available as a separate approval-detail route.
- Current detail review happens inside Product Detail and the Approval Queue table.

### B-K.
- Use `/products/[id]` plus `/quality/approvals`.

## Rejection / rework flow
### A. Purpose
- Implemented through `/rejection`, `/quality/issues`, `/products/[id]?tab=quality`, and channel submission history.
- Objective: understand likely channel rejection reasons and route work back to product fixes.

### B. When users come here
- After channel rejections or recurring validation failures
- When Marketplace teams want to reduce future rejection risk

### C. Page layout / screen structure
- Rejection Insights page with KPI cards, filter bar, and score/insight content
- Linked follow-up into Issue Inbox

### D-K.
- Main fields: `Product`, `Channel`
- Use case examples:
  1. Marketplace Manager checks likely rejection causes before submission.
  2. Catalog Executive reviews suggestions after a rejection trend emerges.
  3. Quality Reviewer cross-checks rejection risk against current blockers.
- Rework is executed in Product Detail, not in the rejection page itself.

## Completeness dashboard
### A. Purpose
- Quality overview at `/quality/completeness`.
- Objective: monitor how complete the catalog is and route follow-up into Issue Inbox or Validation.

### B. When users come here
- Daily or weekly catalog health review
- Before channel push

### C. Page layout / screen structure
- KPI row: Total SKUs, Complete SKUs, Incomplete SKUs, Completeness %
- `Quality Signals` card
- `Next Actions` card

### D-K.
- Uses dashboard health snapshot and stats.
- Blocking and warning counts are surfaced as quality signals.
- Main actions: `Open Issue Inbox`, `Open Validation`.
- Use cases:
  1. Catalog Manager tracks completeness trend.
  2. Quality Reviewer checks blocking load.
  3. Admin validates readiness before onboarding another connector.

## Data quality reports
### A. Purpose
- Information not available as standalone reports pages.
- Current equivalents are `Completeness`, `Validation`, `Issue Inbox`, and Dashboard health sections.

### B-K.
- Use those pages as the current operational reporting set.

## Workflow history / audit logs
### A. Purpose
- Workflow-level history is split across Product Activity, Jobs, Submissions, and Admin Audit summary.

### B-K.
- There is no single combined workflow-history route in current TEJ PIM.

## Bulk edit landing page
### A. Purpose
- Bulk edit workspace at `/operations/bulk-edit`.
- Objective: select a scope, preview changes, and apply them safely.

### B. When users come here
- Mass content updates
- Brand cleanup
- Status changes across multiple products
- Scheduled operational corrections

### C. Page layout / screen structure
- Filter/configuration form
- Preview/diff component
- Apply confirmation checkbox
- History/operations table depending on current page state

### D. Field-by-field / section-by-section explanation
- `Category`
- `Status`
- `Brand Contains`
- `Product IDs`
- `Updates`
- `I have reviewed the preview and I am ready to apply these changes.`
- Preview uses a diff component before apply.

### E. User actions
- Configure scope
- Preview updates
- Apply bulk edit

### F. Detailed use cases
1. Operations Manager updates a brand string across many products.
2. Catalog Manager targets one category only.
3. Admin applies status changes to a set of product IDs.
4. Editor validates preview before execution.
5. Viewer reviews operation history without applying changes.

### G. Business rules
- Empty or unsafe scope is guarded server-side.
- Apply requires reviewed-confirmation checkbox.
- Viewer cannot apply.

### H. Validations and edge cases
- product IDs can be comma or newline separated
- invalid update payload fails action
- preview/apply mismatch should be treated as a workflow warning

### I-K.
- Related to Products and Quality. Best practice: always preview before apply, and use the narrowest possible scope.

## Bulk edit configuration page
### A. Purpose
- Implemented inside `/operations/bulk-edit`.

### B-K.
- Use the filter/config form at the top of the page.

## Bulk edit preview page
### A. Purpose
- Implemented inside `/operations/bulk-edit` through diff preview.

### B-K.
- Preview is part of the same page, not a separate route.

## Bulk edit execution result page
### A. Purpose
- Implemented inside `/operations/bulk-edit` through refreshed state and operations list.

### B-K.
- There is no separate result route.

## Bulk import landing page
### A. Purpose
- Import operations page at `/operations/imports`.
- Objective: monitor import jobs and repair failed rows.

### B. When users come here
- After import processing begins
- When failed rows need correction
- During import operations review

### C. Page layout / screen structure
- Header with hide/show test-data toggle
- KPI cards: Total Jobs, Needs Attention, Retrying, Completed
- Import Jobs table
- Optional Row Repair Console for selected `bulkJobId`

### D. Field-by-field / section-by-section explanation
- Job table columns:
  - `Job`
  - `Format`
  - `Category`
  - `Status`
  - `Rows`
  - `Success`
  - `Needs Attention`
  - `Actions` -> `View rows`
- `Row Repair Console`: shows row number, translated error, and row repair form
- `Show/Hide test data`: toggles seeded data visibility

### E. User actions
- Review import jobs
- Open row-level repair for a selected job
- Repair failed/dead-letter rows (writers)

### F. Detailed use cases
1. Operations Manager opens a failed import and repairs broken rows.
2. Admin reviews retrying jobs after an upstream fix.
3. Catalog Executive repairs a specific row after format translation error.
4. Viewer inspects job outcomes without editing.
5. Support traces a problematic import by job ID.

### G. Business rules
- Current page is monitoring-and-repair oriented, not a full upload wizard.
- Viewer cannot repair rows.

### H. Validations and edge cases
- selected `bulkJobId` with no failing rows shows a clear message
- empty job list is valid
- row-level translation uses human-readable error mapping where possible

### I-K.
- Related to Repair Center and Jobs. Best practice: repair dead-letter rows early so imports do not linger unresolved.

## File upload / import mapping page
### A. Purpose
- Information not available as a separate upload/mapping route in current TEJ PIM.
- Current import UI begins at monitoring and repair, not file upload wizard steps.

### B-K.
- Treat this as future scope, not current product behavior.

## Import validation result page
### A. Purpose
- Implemented through Import Jobs table and Row Repair Console.

### B-K.
- No separate route exists today.

## Import job status page
### A. Purpose
- Implemented through `/operations/imports` and `/operations/repair`.

### B-K.
- Use `bulkJobId` query selection to inspect row-level state.

## Export page / export history page
### A. Purpose
- Information not available as a standalone export page in current TEJ PIM.
- Channel submission/export activity is tracked through Product Detail > Channels, Channels Submissions, and Operations Jobs.

### B-K.
- Use those pages instead of expecting a dedicated export center.

## Job logs / operation logs
### A. Purpose
- Jobs workspace at `/operations/jobs`.
- Objective: review submission-job lifecycle, dead-letter backlog, and channel error details.

### B. When users come here
- After submission failures
- To locate a specific submission ID
- To inspect retries and dead-letter backlog

### C. Page layout / screen structure
- Header with actions to Repair Center and Channel management
- KPI row
- Filter bar
- Latest Submission Jobs table
- Optional Selected Submission Detail card

### D-K.
- Filters: `Status`, `Connector Slug`, `Submission ID`
- Detail card shows connector, product, attempt, and channel errors
- Use cases:
  1. Operations Manager filters `DEAD_LETTER` jobs.
  2. Marketplace Manager inspects a rejected submission.
  3. Support searches by submission ID.
  4. Viewer monitors retry pressure.
  5. Admin checks whether errors are channel-specific.
- Best practice: use Jobs for cross-channel operations and Channels Submissions for business-facing channel view.
## Connectors list
### A. Purpose
- Channel connector list at `/channels/connectors`.
- Used by Admins and connector-permitted editors.
- Objective: install connectors, inspect current installations, and route into mapping and connector detail.

### B. When users come here
- Initial channel onboarding
- Adding another marketplace account alias
- Reconnecting or disabling a connector
- Checking capabilities and installation metadata

### C. Page layout / screen structure
- Page header with link to `Connector Access`
- Success banner after install/reconnect/uninstall/delete
- `Available Connectors` card grid with install forms
- `Installed Connectors` table with details, mapping, reconnect, disable, delete actions

### D. Field-by-field / section-by-section explanation
- Available connector card fields:
  - display name
  - slug
  - auth type
  - version
  - capabilities
  - installed account count
- Install form fields:
  - `Account Alias`
  - `External Account Ref`
  - `Install connector`
- Installed table columns:
  - `Connector`
  - `Account Alias`
  - `External Ref`
  - `Status`
  - `Capabilities`
  - `Installed`
  - `Last Sync`
  - `Metadata`
  - `Actions`
- Blocked reasons can explain permission or plan-limit failure directly in the UI.

### E. User actions
- Install connector
- Open Details
- Open Mapping
- Reconnect
- Disable
- Delete disabled record (admin only)

### F. Detailed use cases
1. Marketplace Manager installs a Flipkart account alias `primary`.
2. Admin adds a second Amazon account alias after upgrading plan.
3. Editor with connector permission reconnects a disabled installation.
4. Admin disables a connector before deleting the disabled record.
5. Viewer inspects capabilities and status without mutation rights.

### G. Business rules
- Server decides whether install/reconnect/uninstall is allowed.
- Plan limits can block connector installation or account expansion.
- Permanent delete is only available for disabled installations and admin role.

### H. Validations and edge cases
- install blocked when connector already exists for alias
- reconnect or disable may be blocked by permission or plan policy
- metadata can be empty JSON

### I. Related pages
- `/channels/connectors/[installationId]`
- `/channels/mappings`
- `/admin/connectors`
- `/admin/plan`

### J. Tips / best practices
- Use clear account aliases for multi-account operations.
- Review capabilities before promising publish behavior for a connector.

### K. Support / troubleshooting notes
- If install is blocked, check the exact message: permission issue vs plan limit vs already installed.

## Connector installation detail page
### A. Purpose
- Connector detail page at `/channels/connectors/[installationId]`.
- Objective: inspect one installation's overview, permission overrides, and submission history.

### B. When users come here
- From Connectors list `Details`
- During troubleshooting of a specific connector account
- When validating permissions and recent submission state

### C. Page layout / screen structure
- Page header with status chip and link to mapping manager
- KPI row: Capabilities, Submissions, Errors/Rejections, Permission Rules
- Overview card
- Permissions card
- Submission History table

### D-K.
- Overview fields: installation ID, slug, external ref, installed at, last sync
- Permissions card shows per-principal overrides and link to Admin Connector Access
- Submission table columns: Submission, Product, Status, Attempt, Submitted
- Use cases:
  1. Marketplace Manager confirms capabilities for one installation.
  2. Admin checks whether a role-specific override exists.
  3. Operations reviews failed submissions for a connector.
- Best practice: use this page to understand one account alias before changing permissions or mappings.

## Connector settings page
### A. Purpose
- Current connector settings and permission controls live under `/admin/connectors`.
- There is no separate settings page outside connector detail and admin connector access.

### B-K.
- Use Connector Detail for overview/history and Admin Connector Access for governance.

## Channel attribute mapping page
### A. Purpose
- Implemented in the canonical Mapping Manager at `/channels/mappings`.
- Objective: define how PIM fields map to channel fields under lifecycle control.

### B. When users come here
- Before first publish for a category/channel pair
- After a preflight blocker indicates mapping is incomplete
- When connector definition or taxonomy compatibility changes

### C. Page layout / screen structure
- Page header
- step-up password field for protected actions
- selector/filter area for category, channel, taxonomy search, mapping type, category scope, publish category, compatibility, fallback controls
- lifecycle action buttons for create, validate, publish, archive, rollback
- resolved mapping preview and preflight panels
- version history / inventory areas

### D. Field-by-field / section-by-section explanation
- `Step-up re-authentication`: password confirmation for high-risk mapping actions
- `Category`: current internal category scope
- `Channel`: target marketplace channel
- `Taxonomy search`: search external taxonomy candidates
- `Mapping type`: mapping level / scope selector
- `Category scope` and `Publish category`: target publish taxonomy values
- `Channel compatibility`: compatibility state visible to the workflow
- `Allow fallback mapping`: explicit fallback behavior
- `Fallback confirmation`, `Default fallback category`, `Fallback label`, `Confirmation message`: fallback governance controls
- `Override mapping rules (JSON)` and `Override fallback behavior (JSON)`: advanced structured overrides
- `Archive reason` / `Rollback reason`: audit-supporting reason fields

### E. User actions
- Create connector mapping version
- Validate mapping version
- Publish mapping version
- Archive mapping version
- Roll back to prior mapping version

### F. Detailed use cases
1. Marketplace Manager creates the first mapping for a new category/channel pair.
2. Admin validates a mapping before publish.
3. Admin publishes a validated mapping after step-up password confirmation.
4. Channel team archives a superseded version with a reason.
5. Admin rolls back after a bad mapping publish causes preflight blockers.

### G. Business rules
- `/channels/mappings` is the canonical edit surface.
- High-risk mapping actions require step-up re-authentication.
- Legacy connector mapping pages redirect here.

### H. Validations and edge cases
- wrong password blocks protected actions
- incomplete category/channel scope prevents meaningful resolution
- advanced JSON overrides can fail if malformed
- fallback behavior must be explicit when used

### I. Related pages
- `/channels/connectors`
- `/products/[id]?tab=channels`
- `/catalog/attributes`

### J. Tips / best practices
- Treat lifecycle changes like controlled release operations.
- Use reasons on archive and rollback for future troubleshooting.

### K. Support / troubleshooting notes
- If mapping actions fail unexpectedly, verify step-up state, connector definition availability, and category/channel selection.

## Category mapping page
### A. Purpose
- Implemented inside `/channels/mappings` through publish category and taxonomy selection.

### B-K.
- There is no separate standalone category-mapping route. Use the canonical Mapping Manager.

## Listing readiness page
### A. Purpose
- Implemented across Product Detail > Channels, Product Readiness Summary Bar, Dashboard, and Channel Health.

### B-K.
- No standalone readiness route exists. Use the page closest to the operating decision:
  - product-level -> Product Detail > Channels
  - channel-level -> Channel Health
  - portfolio-level -> Dashboard

## Submission/job history page
### A. Purpose
- Implemented through `/channels/submissions`, `/operations/jobs`, and connector detail history.
- Objective: track listing lifecycle by channel and by job.

### B-K.
- Channels Submissions is business-facing channel history.
- Operations Jobs is operational troubleshooting history.

## Error / reconciliation page
### A. Purpose
- Implemented through `/operations/repair`, `/operations/jobs`, `/quality/issues`, and rejection insights.

### B-K.
- No single standalone reconciliation route exists.

## Retry / republish flow
### A. Purpose
- Implemented through Product Detail > Channels publish attempts, Operations Jobs, and Repair Center follow-up.

### B-K.
- `Process` and `Requeue` exist on product submission attempts.
- Use Jobs and Repair Center for operational follow-up.

## Reports home
### A. Purpose
- Legacy redirect in current TEJ PIM.
- `/reports` redirects to Dashboard rather than serving a standalone reports center.

### B-K.
- Use Dashboard, Quality, Channels, Operations, and Admin summary pages as the current reporting surfaces.

## Catalog health report
### A. Purpose
- Implemented through Dashboard and `/quality/completeness`.

### B-K.
- No separate report route exists.

## Missing attributes report
### A. Purpose
- Implemented through Issue Inbox, Validation, Product Detail > Quality, and Product Detail > Attributes.

### B-K.
- No standalone report route exists.

## Channel readiness report
### A. Purpose
- Implemented through `/channels/health` and product-level readiness surfaces.

### B-K.
- Use `/channels/health` for current per-channel reporting.

## Approval turnaround report
### A. Purpose
- Information not available as a standalone turnaround report in current TEJ PIM.

### B-K.
- Use Approval Queue KPIs and workflow counts as current visibility.

## Import/export performance report
### A. Purpose
- Implemented through `/operations/imports` and `/operations/jobs` KPI cards, not as a standalone report route.

### B-K.
- No separate report page exists.

## User activity / audit report
### A. Purpose
- Partially implemented through `/admin/audit` summary page.

### B-K.
- Detailed explorer is planned, not currently implemented.

## Admin overview
### A. Purpose
- Governance landing page at `/admin`.
- Used by Admins primarily, but readable by others.
- Objective: route governance work to the correct admin subsection.

### B-K.
- Cards: Workspace Settings, Plan & Usage, Users & Roles, Connector Access, Privacy, Audit Logs.
- Use cases:
  1. Admin opens plan controls.
  2. Admin opens connector access management.
  3. Viewer reviews what governance areas exist.

## Users list
### A. Purpose
- Access-model summary page at `/admin/users`.
- Objective: show role matrix, user-limit context, and connector permission overrides.

### B. When users come here
- Reviewing current access model
- Checking user limits
- Inspecting connector overrides by principal

### C-K.
- KPI row: User Limit, Role Profiles, Connector Overrides, User Principals
- Role Matrix table: Admin, Editor, Viewer across Catalog, Channels, Operations, Quality, Admin
- Connector Permission Overrides table: Principal, Type, Connector, Action, Alias, Updated
- Use cases:
  1. Admin confirms viewer is read-only everywhere.
  2. Admin reviews connector override growth.
  3. Support checks whether a principal has connector-level access.
- There is no standalone user create/edit CRUD page today.

## User create / edit page
### A. Purpose
- Information not available in current TEJ PIM project as a standalone page.

### B-K.
- Current Users & Roles page is visibility-focused, not a full user-management console.

## Roles & permissions page
### A. Purpose
- Implemented primarily through `/admin/users` and `/admin/connectors`.

### B-K.
- Global role matrix is on Users & Roles.
- Connector-specific overrides are managed on Connector Access.

## Team / workspace settings
### A. Purpose
- Workspace summary page at `/admin/workspace`.
- Objective: point users to current workspace-level governance surfaces.

### B-K.
- Current page is informational with links to Plan & Usage and Connector Access.
- A richer settings form is not currently implemented.

## Approval settings
### A. Purpose
- Information not available as a separate settings page in current TEJ PIM.

### B-K.
- Approval visibility is operational, not currently governed through a standalone settings editor.

## Workflow settings
### A. Purpose
- Information not available as a separate workflow-settings page.

### B-K.
- Workflow behavior is currently reflected through product status and quality/approval surfaces.

## Taxonomy settings
### A. Purpose
- Implemented through Categories and Attributes pages rather than a unified settings page.

### B-K.
- Use `/catalog/categories` and `/catalog/attributes`.

## Import/export settings
### A. Purpose
- Information not available as a separate settings page.

### B-K.
- Current import and export controls are task pages, not settings pages.

## Connector defaults / settings
### A. Purpose
- Implemented across Connector list, Connector detail, and Admin Connector Access.

### B-K.
- No single standalone defaults page exists.

## Notification settings
### A. Purpose
- Information not available in current TEJ PIM project.

### B-K.
- Not implemented as a user-facing settings page.

## Audit / security settings
### A. Purpose
- Implemented partially as `/admin/audit` summary and auth/privacy behavior.

### B-K.
- Current audit page states that a dedicated explorer UI is planned.

## API / token settings if applicable
### A. Purpose
- Information not available in current TEJ PIM project as a user-facing page.

### B-K.
- Not implemented.

## Billing / subscription page if applicable
### A. Purpose
- Plan and usage page at `/admin/plan`.
- Objective: show plan meters and allow admin plan-tier changes.

### B. When users come here
- To review current plan usage
- When connector or SKU limits block actions
- During tenant packaging/governance review

### C-K.
- Fields and sections:
  - billing breadcrumb and current plan header
  - usage meters for SKUs, Submissions, Storage, Users, Connector Installations, Accounts Per Connector
  - read-only current plan summary and `Request upgrade` commercial CTA
- Use cases:
  1. Admin reviews current usage and requests a commercial upgrade after hitting connector limits.
  2. Ops Manager reviews SKU usage before a major import.
  3. Support checks whether plan limits explain blocked connector installs.
  4. Viewer reviews current plan utilization without edit rights.
  5. Admin validates the current billing-cycle reset date.
- Best practice: treat plan changes as governance actions and confirm tenant impact before updating.

## Privacy
### A. Purpose
- Self-service privacy page at `/admin/privacy`.
- Objective: expose export and deletion workflows under current DPDP-oriented behavior.

### B. When users come here
- Request data export
- Review latest privacy status
- Schedule account deletion

### C-K.
- Status section shows latest consent, latest export, latest deletion
- Export form fields: `Format` -> JSON or CSV
- Delete form fields: `Confirmation text` (must equal DELETE), `Reason (optional)`
- Use cases:
  1. Admin requests JSON export.
  2. User requests CSV export for internal archive.
  3. Admin schedules deletion after typing DELETE.
- Edge cases: expired session, network failure, incorrect confirmation text

## Audit Logs
### A. Purpose
- Summary page at `/admin/audit`.
- Objective: state current audit coverage and set user expectation that detailed explorer UI is still pending.

### B-K.
- Current page contains a header and `Current State` card only.
- Use it as a governance summary, not a searchable audit console.

## 6. Pages Covered in Detail

This guide covers every requested page or requested functional surface using one of three classifications:
- `Standalone page`: a real current TEJ PIM route
- `Implemented inside another page`: the functionality exists but is embedded in another route or tab
- `Information not available in current TEJ PIM project`: no validated user-facing page was found

### Core navigation / shell coverage
- Login -> Standalone page
- Forgot password / reset password -> Standalone page
- MFA / OTP verification -> Implemented inside Mapping Manager as step-up re-authentication
- Session expired / unauthorized -> Implemented through Login reason banner
- Dashboard -> Standalone page
- Notifications / alerts center -> Not standalone
- User profile / account settings -> Information not available as a standalone route; `/admin/privacy` is a separate privacy workflow, not a profile page

### Catalog coverage
- Product list / saved views / product create -> Standalone page with embedded flows
- Product detail overview / edit / tabs / audit activity -> Standalone page with tabbed workspace
- Product duplicate / dedicated archive-delete page -> Information not available in current TEJ PIM project
- Related products / bundles -> Information not available in current TEJ PIM project

### Category and attribute coverage
- Category list / create -> Standalone page with embedded create flow
- Category edit / tree page -> Not standalone
- Attribute list / create / category assignment / mandatory-vs-optional / variant attribute setup -> Standalone page with embedded governance controls
- Attribute group management / standalone validation rule page -> Information not available in current TEJ PIM project

### Media coverage
- Media library / upload / validation / product-media linking -> Standalone page
- Media detail / tagging-organization -> Not standalone or not implemented as separate route

### Quality and workflow coverage
- Issue Inbox / Validation / Completeness / Approval Queue / Rejection Insights -> Standalone pages
- Product review page / approval details page / data quality reports / workflow history summary -> Implemented across existing quality, product, and admin routes

### Bulk operations coverage
- Bulk Edit -> Standalone page with embedded configuration, preview, and execution flow
- Imports -> Standalone monitoring and repair page
- Upload wizard / import mapping / export center -> Information not available as separate pages
- Jobs / Repair Center -> Standalone pages

### Channels coverage
- Channels overview / connectors / connector detail / mappings / submissions / health -> Standalone pages
- Category mapping / listing readiness / retry-republish / reconciliation -> Implemented across mappings, product detail, submissions, jobs, and repair

### Reporting and admin coverage
- Reports home and report pages -> Redirected or implemented through existing operational pages, not as a dedicated reporting module
- Admin overview / plan / users / connector access / privacy / audit -> Standalone pages
- User create-edit / workflow settings / notification settings / API token settings -> Information not available in current TEJ PIM project

## 7. Page Flow Mapping

### End-to-end journey for new product creation
- Start page: `/catalog/products`
- Navigation path:
  1. Open Product Workbench
  2. Click `+ New Product`
  3. Submit inline create form
  4. Open created product in `/products/[id]`
  5. Complete Content and Attributes tabs
  6. Add variants if applicable
  7. Link media in `/catalog/media`
  8. Run validation from Product Detail > Quality
  9. Review readiness in Product Detail > Channels
- Decisions taken:
  - whether product is simple or variant-based
  - whether required attributes/media are complete
  - whether channel mapping already exists
- System checks:
  - plan limit for SKUs
  - versioned update checks
  - validation and readiness checks
- Possible failure points:
  - plan limit reached
  - version conflict
  - missing attributes/media
  - missing mapping or channel blockers
- Completion criteria:
  - product saved, validated, and ready for submission or review

### End-to-end journey for bulk import
- Start page: current TEJ PIM import operations start at `/operations/imports`
- Navigation path:
  1. Monitor import jobs
  2. Open selected job rows with `bulkJobId`
  3. Review failed/dead-letter rows
  4. Use Row Repair Console to correct rows
  5. Re-check job outcome
- Decisions taken:
  - whether the issue is data formatting, taxonomy mismatch, or required field absence
- System checks:
  - translated import status and row-level errors
- Possible failure points:
  - repeated dead-letter rows
  - viewer attempting repair
- Completion criteria:
  - failed rows repaired and import backlog reduced

### End-to-end journey for quality review and approval
- Start page: `/quality/issues` or `/quality/approvals`
- Navigation path:
  1. Review queue or issue severity
  2. Open product from `Fix Now`
  3. Update content/attributes/media
  4. Run validation
  5. Return to Approval Queue to reassess
- Decisions taken:
  - blocker vs warning priority
  - whether the product is clean for decision
- System checks:
  - issue severity, product status, validation results
- Possible failure points:
  - hidden blockers remain on product
  - incomplete channel readiness despite clean quality state
- Completion criteria:
  - no blocking issues remain and product is ready for downstream decision or submission

### End-to-end journey for channel mapping and publication
- Start page: `/channels/connectors` or `/channels/mappings`
- Navigation path:
  1. Install or confirm connector
  2. Open Mapping Manager
  3. Select category and channel
  4. Resolve taxonomy and mapping details
  5. Validate mapping version
  6. Publish mapping version with step-up password if required
  7. Open Product Detail > Channels
  8. Review readiness and create export job
  9. Process or monitor submission
- Decisions taken:
  - channel/category scope
  - fallback behavior
  - whether mapping is safe to publish
- System checks:
  - connector availability
  - mapping preflight
  - product readiness
- Possible failure points:
  - step-up failure
  - mapping incompatibility
  - missing product data or media
  - submission rejection/error
- Completion criteria:
  - mapping published and submission created successfully

### End-to-end journey for bulk edits and rollback if applicable
- Start page: `/operations/bulk-edit`
- Navigation path:
  1. Define scope
  2. Enter update payload
  3. Review preview/diff
  4. Confirm readiness checkbox
  5. Apply
  6. Review resulting operation state on the same page
- Decisions taken:
  - narrow vs broad scope
  - whether the preview matches intended changes
- System checks:
  - scope safety and payload validity
- Possible failure points:
  - unsafe/empty scope
  - malformed updates
- Completion criteria:
  - update applied successfully
- Rollback note:
  - a dedicated bulk-edit rollback page is not validated in current TEJ PIM

### End-to-end journey for admin setup and user onboarding
- Start page: `/admin`
- Navigation path:
  1. Review Workspace Settings summary
  2. Open Plan & Usage to confirm tier and limits
  3. Open Users & Roles to review role matrix and capacity
  4. Open Connector Access to grant action-level overrides if needed
  5. Open Privacy to review export/deletion controls
- Decisions taken:
  - which users need connector overrides
  - whether plan upgrade is needed before rollout
- System checks:
  - current usage meters
  - connector permission records
- Possible failure points:
  - role mismatch
  - plan limits
- Completion criteria:
  - workspace governance is ready for the operating team

## 8. Use Case Library

### Admin use cases
- Top goals:
  - govern access and connector permissions
  - manage plan and usage
  - oversee privacy and audit posture
- Common workflows:
  - change plan tier
  - grant/revoke connector actions
  - inspect user-role matrix
  - request privacy export or schedule deletion
- Common blockers:
  - connector action blocked by plan
  - missing detailed audit explorer
- Recommended practices:
  - review plan impact before upgrades
  - document reason for connector permission exceptions

### Catalog Manager use cases
- Top goals:
  - improve completeness
  - reduce blockers
  - move products toward readiness
- Common workflows:
  - use Product Workbench saved views
  - monitor Completeness
  - review Approval Queue
  - inspect product detail blockers
- Common blockers:
  - missing taxonomy definitions
  - incomplete media or channel mappings
- Recommended practices:
  - work in triage order: blockers -> warnings -> readiness

### Catalog Executive use cases
- Top goals:
  - create and edit products quickly
  - resolve assigned data issues
- Common workflows:
  - create product inline
  - edit content and attributes
  - upload/link media
  - validate product
- Common blockers:
  - version conflicts
  - missing required attributes
- Recommended practices:
  - save frequently and validate before leaving the product page

### Quality Reviewer use cases
- Top goals:
  - clear blockers
  - assess in-review products
- Common workflows:
  - filter Issue Inbox by severity
  - open products from `Fix Now`
  - monitor Approval Queue
  - review Validation and Completeness pages
- Common blockers:
  - issue not actually fixable from inbox alone
  - product clean in quality but blocked in channels
- Recommended practices:
  - always confirm product-level readiness, not only issue counts

### Marketplace Manager use cases
- Top goals:
  - connect channels
  - publish safe mappings
  - monitor submissions
- Common workflows:
  - install/reconnect connectors
  - manage mappings
  - check Channel Health
  - inspect Submissions and Jobs
- Common blockers:
  - step-up failure
  - plan limit on accounts or installations
  - missing product or mapping data
- Recommended practices:
  - publish mappings only after validation and reasoned review

### Viewer use cases
- Top goals:
  - understand system state without changing it
- Common workflows:
  - review Dashboard, Products, Quality, Jobs, and Admin summaries
- Common blockers:
  - inability to execute repair or governance actions
- Recommended practices:
  - use related pages to build context before asking writers/admins for intervention

## 9. Error, Empty, and Exception State Guide

### No data states
- What user sees: explicit empty-state cards or informational messages
- Why it happens: no products, no connectors, no issues, no jobs in current scope
- What to do next: follow provided action link such as create product, install connector, clear filters
- Admin/support needed: no, unless data should exist but is unexpectedly absent

### No permission states
- What user sees: read-only messaging, hidden action buttons, or admin-required notices
- Why it happens: viewer role or lack of connector-specific permission
- What to do next: request admin or connector permission
- Admin/support needed: yes, if the user should have additional rights

### Validation error states
- What user sees: issue rows, validation panel entries, translated error descriptions
- Why it happens: required fields, invalid formats, compliance failures
- What to do next: fix product data in content, attributes, variants, or media
- Admin/support needed: only if taxonomy definitions or rules are wrong

### Network / server error states
- What user sees: inline error banner, generic failure text, or redirect to login on auth failures
- Why it happens: network outage, backend failure, expired session
- What to do next: retry, reload, or sign in again
- Admin/support needed: yes if the problem persists across retries

### Import failure states
- What user sees: import jobs needing attention and row repair console
- Why it happens: row-level formatting or required-field failures
- What to do next: open job rows and repair bad records
- Admin/support needed: only if systemic mapping/taxonomy issues keep repeating

### Connector sync failure states
- What user sees: rejected/error statuses in Submissions or Jobs, dead-letter counts, blocked connector actions
- Why it happens: channel rejection, connector configuration issue, permission problem, or backpressure/retry path
- What to do next: inspect product, mapping, connector detail, and jobs
- Admin/support needed: yes if connector credentials or permissions are involved

### Approval conflicts
- What user sees: items in review with blockers still present
- Why it happens: workflow state advanced before all issues were cleared
- What to do next: fix blockers from product detail or issue inbox
- Admin/support needed: no, unless workflow policy itself is wrong

### Duplicate SKU / product conflicts
- What user sees: product or variant creation/update failure depending on server response
- Why it happens: existing unique identifier already in use
- What to do next: confirm correct SKU and retry with a unique value
- Admin/support needed: sometimes, if duplicates came from a bad import

### Stale data / concurrent edit conflicts
- What user sees: `VERSION_CONFLICT` message on product update
- Why it happens: another update already changed the product version
- What to do next: reload product, review latest values, reapply intended changes
- Admin/support needed: usually not

## 10. Glossary

- Product: the primary catalog record managed in TEJ PIM
- Parent product: the main product record that can own variants
- Variant: a child SKU with its own inventory, pricing, status, and attributes
- Attribute: structured product or variant field defined per category
- Attribute group: Information not available in current TEJ PIM project as a standalone user-facing concept
- Taxonomy: the category structure used to organize products and scope attributes
- Completeness: percentage indicator of how complete a product is
- Channel readiness: product ability to move toward channel submission based on quality, mapping, and channel checks
- Connector: installed marketplace/channel integration account
- Mapping: rules that align PIM category/field data to channel taxonomy and requirements
- Submission: a channel-facing listing attempt or job record
- Approval queue: quality workflow view for products in `in_review`
- Saved view: query-based product workbench preset such as `Needs Attention`
- Bulk edit: scoped multi-product update workflow
- Bulk import: import-job and row-repair workflow
- Rework: the act of fixing product data after issues or rejections
- Audit log: governance event history; summary UI exists, detailed explorer is pending
- Dead letter: failed job state that requires intervention
- Step-up re-authentication: password confirmation required for high-risk mapping actions

## 11. Final Deliverable Quality Rules Applied to This Guide

- The guide reflects current validated TEJ PIM routes and embedded workflows only, and Section 12 maps each page/functionality claim to source files.
- Requested pages that do not exist as standalone surfaces are marked clearly rather than invented.
- Permissions are described in terms of current technical roles: `admin`, `editor`, `viewer`.
- Operational examples use realistic catalog, marketplace, and governance scenarios.
- Field descriptions focus on what is visible and actionable in the current UI.
- Where information is missing from current TEJ PIM, the guide states that directly.

## 12. Validation Appendix: Page Claim to Source Map

- Validation baseline: repo HEAD `0ae974c`
- Validation rule for this revision: only current route files, page components, UI helpers, and route-bound server behavior were used as implementation evidence.
- Validation directories used: `apps/web/src/app/`, `apps/web/src/components/`, `apps/web/src/lib/`, and API/auth files where a documented page depends on server behavior.
- Status legend:
  - `Standalone`: implemented as its own route
  - `Embedded`: implemented inside another current route or tab
  - `Legacy redirect`: old route exists but redirects to the current route
  - `Not available`: no standalone current route exists at this validation baseline; the listed files show the nearest related implementation
- Top-level shell validation source: `apps/web/src/components/nav/app-sidebar.tsx`

### A. Auth and shell surfaces

| Guide section | Status | Current implementation | Source files |
|---|---|---|---|
| Login | Standalone | `/login` | `apps/web/src/app/login/page.tsx`<br>`apps/web/src/components/auth/login-page-client.tsx`<br>`apps/web/src/app/api/auth/login/route.ts` |
| Forgot password / reset password | Standalone | `/login/reset` | `apps/web/src/app/login/reset/page.tsx`<br>`apps/web/src/components/auth/password-reset-page-client.tsx`<br>`apps/web/src/app/api/auth/password-reset/request/route.ts` |
| MFA / OTP verification if applicable | Embedded | Step-up re-authentication inside `/channels/mappings`; no standalone MFA/OTP page | `apps/web/src/app/channels/mappings/page.tsx`<br>`apps/api/src/auth/jwt.ts`<br>`apps/api/src/auth/auth.service.ts` |
| Session expired / unauthorized page | Embedded | Login reason banner and account-locked flow; no standalone session-expired page | `apps/web/src/app/login/page.tsx`<br>`apps/web/src/components/auth/login-page-client.tsx`<br>`apps/web/src/app/login/locked/page.tsx`<br>`apps/web/src/components/auth/account-locked-page-client.tsx` |
| Dashboard | Standalone | `/dashboard` | `apps/web/src/app/dashboard/page.tsx` |
| Notifications / alerts center | Not available | No standalone notifications route; alerts are embedded as local banners and inline notices | `apps/web/src/app/` route inventory at HEAD `0ae974c`<br>`apps/web/src/app/connectors/page.tsx`<br>`apps/web/src/app/admin/plan/page.tsx` |
| User profile / account settings | Not available | No standalone profile or account-settings route; privacy is separate | `apps/web/src/app/` route inventory at HEAD `0ae974c`<br>`apps/web/src/app/admin/privacy/page.tsx`<br>`apps/web/src/components/settings/data-privacy-page-client.tsx` |

### B. Catalog and product workspace

| Guide section | Status | Current implementation | Source files |
|---|---|---|---|
| Product list | Standalone | `/catalog/products` | `apps/web/src/app/catalog/products/page.tsx`<br>`apps/web/src/components/product/products-tab.tsx` |
| Saved views | Embedded | Query-based view chips inside Product Workbench | `apps/web/src/components/product/products-tab.tsx` |
| Product details overview | Standalone | `/products/[id]` | `apps/web/src/app/products/[id]/page.tsx` |
| Basic information tab | Embedded | `Content` tab inside Product Detail | `apps/web/src/app/products/[id]/page.tsx` |
| Attributes tab | Embedded | `Attributes` tab inside Product Detail | `apps/web/src/app/products/[id]/page.tsx` |
| Variants tab | Embedded | `Variants` tab inside Product Detail | `apps/web/src/app/products/[id]/page.tsx` |
| Media tab | Embedded | `Media` tab inside Product Detail, linked to media workspace | `apps/web/src/app/products/[id]/page.tsx`<br>`apps/web/src/app/media/page.tsx` |
| Compliance / mandatory data tab | Embedded | `Quality` tab inside Product Detail | `apps/web/src/app/products/[id]/page.tsx` |
| Channel-readiness / completeness tab | Embedded | `Channels` tab inside Product Detail plus readiness components | `apps/web/src/app/products/[id]/page.tsx`<br>`apps/web/src/components/channel/product-readiness-summary-bar.tsx` |
| Pricing / inventory info view if applicable | Embedded | Variant pricing/inventory fields inside `Variants` tab | `apps/web/src/app/products/[id]/page.tsx` |
| Audit/history tab | Embedded | `Activity` tab inside Product Detail | `apps/web/src/app/products/[id]/page.tsx` |
| Linked categories / taxonomy section | Embedded | Product category display in Product Detail and taxonomy workspaces | `apps/web/src/app/products/[id]/page.tsx`<br>`apps/web/src/app/catalog/categories/page.tsx` |
| Related products / bundles if applicable | Not available | No related-products or bundles surface validated in current routes | `apps/web/src/app/` route inventory at HEAD `0ae974c` |
| Product create page | Embedded | Inline create flow inside Product Workbench | `apps/web/src/app/catalog/products/page.tsx`<br>`apps/web/src/components/product/CreateProductForm.tsx` |
| Product edit flow | Embedded | Versioned edit flow across Product Detail tabs | `apps/web/src/app/products/[id]/page.tsx` |
| Product duplicate flow | Not available | No validated duplicate-product action or route | `apps/web/src/app/` route inventory at HEAD `0ae974c` |
| Archive / delete flow | Not available | Status supports `archived`, but no dedicated archive/delete product page was validated | `apps/web/src/app/products/[id]/page.tsx` |

### C. Taxonomy and media management

| Guide section | Status | Current implementation | Source files |
|---|---|---|---|
| Category list | Standalone | `/catalog/categories` | `apps/web/src/app/catalog/categories/page.tsx` |
| Category create/edit page | Embedded / Not available | Create is embedded on Category List; no standalone edit page validated | `apps/web/src/app/catalog/categories/page.tsx` |
| Category tree / hierarchy page | Not available | No standalone tree page; hierarchy shown through parent selection and path fields | `apps/web/src/app/catalog/categories/page.tsx` |
| Attribute list | Standalone | `/catalog/attributes` | `apps/web/src/app/catalog/attributes/page.tsx` |
| Attribute group management | Not available | No standalone attribute-group management page | `apps/web/src/app/` route inventory at HEAD `0ae974c` |
| Attribute create/edit page | Embedded / Not available | Create is embedded on Attribute List; no standalone edit page validated | `apps/web/src/app/catalog/attributes/page.tsx` |
| Attribute assignment to categories | Embedded | Category-scoped attribute management on Attribute List | `apps/web/src/app/catalog/attributes/page.tsx` |
| Mandatory vs optional rule setup | Embedded | `Required` flag inside attribute-definition form | `apps/web/src/app/catalog/attributes/page.tsx` |
| Validation rule setup | Not available | No standalone validation-rule editor | `apps/web/src/app/` route inventory at HEAD `0ae974c`<br>`apps/web/src/app/quality/validation/page.tsx` |
| Variant attribute setup | Embedded | Attribute definitions with `Applies To = variant` plus product variant entry | `apps/web/src/app/catalog/attributes/page.tsx`<br>`apps/web/src/app/products/[id]/page.tsx` |
| Media library | Standalone | `/catalog/media` re-exports `/media` | `apps/web/src/app/catalog/media/page.tsx`<br>`apps/web/src/app/media/page.tsx` |
| Media upload page | Embedded | Upload card inside Media Library | `apps/web/src/app/media/page.tsx` |
| Media detail page | Not available | No dedicated asset-detail route; details shown in Media table and validation panel | `apps/web/src/app/media/page.tsx` |
| Media tagging / organization | Not available | No standalone tagging/folder UI validated | `apps/web/src/app/` route inventory at HEAD `0ae974c` |
| Product-media linking flow | Embedded | Product/variant-scoped upload and bulk association inside Media Library | `apps/web/src/app/media/page.tsx` |
| Media validation issues view | Embedded | Channel Validation area inside Media Library | `apps/web/src/app/media/page.tsx` |

### D. Quality and workflow

| Guide section | Status | Current implementation | Source files |
|---|---|---|---|
| Issues / quality inbox | Standalone | `/quality/issues` | `apps/web/src/app/quality/issues/page.tsx` |
| Product review page | Not available | No separate product-review route; review work uses Product Detail and Approval Queue | `apps/web/src/app/products/[id]/page.tsx`<br>`apps/web/src/app/quality/approvals/page.tsx` |
| Approval queue | Standalone | `/quality/approvals` | `apps/web/src/app/quality/approvals/page.tsx` |
| Approval details page | Not available | No standalone approval-detail route | `apps/web/src/app/products/[id]/page.tsx`<br>`apps/web/src/app/quality/approvals/page.tsx` |
| Rejection / rework flow | Standalone / Embedded | Rejection insights at `/rejection`; rework happens in Product Detail and Issue Inbox | `apps/web/src/app/rejection/page.tsx`<br>`apps/web/src/app/products/[id]/page.tsx`<br>`apps/web/src/app/quality/issues/page.tsx` |
| Completeness dashboard | Standalone | `/quality/completeness` | `apps/web/src/app/quality/completeness/page.tsx` |
| Data quality reports | Not available | No standalone reports page; current quality reporting is spread across Quality routes and Dashboard | `apps/web/src/app/quality/completeness/page.tsx`<br>`apps/web/src/app/quality/validation/page.tsx`<br>`apps/web/src/app/quality/issues/page.tsx`<br>`apps/web/src/app/dashboard/page.tsx` |
| Workflow history / audit logs | Embedded / Not available | Workflow history is split across Activity, Jobs, Submissions, and Audit summary; no single combined route | `apps/web/src/app/products/[id]/page.tsx`<br>`apps/web/src/app/operations/jobs/page.tsx`<br>`apps/web/src/app/channels/submissions/page.tsx`<br>`apps/web/src/app/admin/audit/page.tsx` |

### E. Bulk operations

| Guide section | Status | Current implementation | Source files |
|---|---|---|---|
| Bulk edit landing page | Standalone | `/operations/bulk-edit` | `apps/web/src/app/operations/bulk-edit/page.tsx` |
| Bulk edit configuration page | Embedded | Top-of-page config form inside Bulk Edit | `apps/web/src/app/operations/bulk-edit/page.tsx` |
| Bulk edit preview page | Embedded | Diff preview inside Bulk Edit | `apps/web/src/app/operations/bulk-edit/page.tsx` |
| Bulk edit execution result page | Embedded | Post-apply result state on Bulk Edit page | `apps/web/src/app/operations/bulk-edit/page.tsx` |
| Bulk import landing page | Standalone | `/operations/imports` | `apps/web/src/app/operations/imports/page.tsx` |
| File upload / import mapping page | Not available | No standalone upload wizard or import-mapping page in current UI | `apps/web/src/app/` route inventory at HEAD `0ae974c`<br>`apps/web/src/app/operations/imports/page.tsx` |
| Import validation result page | Embedded | Import Jobs table and Row Repair Console | `apps/web/src/app/operations/imports/page.tsx` |
| Import job status page | Embedded | Import jobs list and row drill-in by `bulkJobId` | `apps/web/src/app/operations/imports/page.tsx`<br>`apps/web/src/app/operations/repair/page.tsx` |
| Export page / export history page | Not available | No standalone export center; export/submission activity is split across product, channels, and jobs pages | `apps/web/src/app/products/[id]/page.tsx`<br>`apps/web/src/app/channels/submissions/page.tsx`<br>`apps/web/src/app/operations/jobs/page.tsx` |
| Job logs / operation logs | Standalone | `/operations/jobs` | `apps/web/src/app/operations/jobs/page.tsx` |

### F. Channels and connectors

| Guide section | Status | Current implementation | Source files |
|---|---|---|---|
| Connectors list | Standalone | `/channels/connectors` re-exports current connectors page | `apps/web/src/app/channels/connectors/page.tsx`<br>`apps/web/src/app/connectors/page.tsx` |
| Connector installation detail page | Standalone | `/channels/connectors/[installationId]` | `apps/web/src/app/channels/connectors/[installationId]/page.tsx` |
| Connector settings page | Embedded | Governance settings live under Admin Connector Access and connector detail | `apps/web/src/app/admin/connectors/page.tsx`<br>`apps/web/src/app/channels/connectors/[installationId]/page.tsx` |
| Channel attribute mapping page | Standalone | `/channels/mappings` | `apps/web/src/app/channels/mappings/page.tsx` |
| Category mapping page | Embedded | Category and taxonomy mapping inside Mapping Manager | `apps/web/src/app/channels/mappings/page.tsx` |
| Listing readiness page | Embedded | Product-level readiness in Product Detail; channel-level readiness in Channel Health | `apps/web/src/app/products/[id]/page.tsx`<br>`apps/web/src/components/channel/product-readiness-summary-bar.tsx`<br>`apps/web/src/app/channels/health/page.tsx` |
| Submission/job history page | Standalone / Embedded | Business-facing history in Channels Submissions; connector-local history in connector detail | `apps/web/src/app/channels/submissions/page.tsx`<br>`apps/web/src/app/channels/connectors/[installationId]/page.tsx` |
| Error / reconciliation page | Embedded | Current reconciliation workflow is split across Repair, Jobs, Issues, and Rejection Insights | `apps/web/src/app/operations/repair/page.tsx`<br>`apps/web/src/app/operations/jobs/page.tsx`<br>`apps/web/src/app/quality/issues/page.tsx`<br>`apps/web/src/app/rejection/page.tsx` |
| Retry / republish flow | Embedded | Retry/process actions live in Product Detail > Channels and operational follow-up pages | `apps/web/src/app/products/[id]/page.tsx`<br>`apps/web/src/app/operations/jobs/page.tsx`<br>`apps/web/src/app/operations/repair/page.tsx` |

### G. Reporting and admin/governance

| Guide section | Status | Current implementation | Source files |
|---|---|---|---|
| Reports home | Legacy redirect | `/reports` redirects to `/dashboard` | `apps/web/src/app/reports/page.tsx` |
| Catalog health report | Embedded | Current catalog-health reporting is Dashboard plus Completeness | `apps/web/src/app/dashboard/page.tsx`<br>`apps/web/src/app/quality/completeness/page.tsx` |
| Missing attributes report | Embedded | Current missing-attribute visibility is in Issue Inbox, Validation, and Product Detail | `apps/web/src/app/quality/issues/page.tsx`<br>`apps/web/src/app/quality/validation/page.tsx`<br>`apps/web/src/app/products/[id]/page.tsx` |
| Channel readiness report | Embedded / Standalone | Channel-level readiness is `/channels/health`; product-level readiness is Product Detail | `apps/web/src/app/channels/health/page.tsx`<br>`apps/web/src/app/products/[id]/page.tsx` |
| Approval turnaround report | Not available | No standalone turnaround report route validated | `apps/web/src/app/` route inventory at HEAD `0ae974c`<br>`apps/web/src/app/quality/approvals/page.tsx` |
| Import/export performance report | Embedded | KPI visibility is spread across Imports and Jobs pages | `apps/web/src/app/operations/imports/page.tsx`<br>`apps/web/src/app/operations/jobs/page.tsx` |
| User activity / audit report | Embedded / Not available | Audit summary exists; detailed explorer/report page does not | `apps/web/src/app/admin/audit/page.tsx` |
| Admin overview | Standalone | `/admin` governance landing page | `apps/web/src/app/admin/page.tsx` |
| Users list | Standalone | `/admin/users` | `apps/web/src/app/admin/users/page.tsx` |
| User create / edit page | Not available | No standalone user create/edit CRUD page validated | `apps/web/src/app/` route inventory at HEAD `0ae974c`<br>`apps/web/src/app/admin/users/page.tsx` |
| Roles & permissions page | Embedded | Role matrix is in Users & Roles; connector permissions are in Connector Access | `apps/web/src/app/admin/users/page.tsx`<br>`apps/web/src/app/admin/connectors/page.tsx` |
| Team / workspace settings | Standalone | `/admin/workspace` | `apps/web/src/app/admin/workspace/page.tsx` |
| Approval settings | Not available | No standalone approval-settings page validated | `apps/web/src/app/` route inventory at HEAD `0ae974c` |
| Workflow settings | Not available | No standalone workflow-settings page validated | `apps/web/src/app/` route inventory at HEAD `0ae974c` |
| Taxonomy settings | Embedded | Taxonomy governance currently lives in Categories and Attributes pages | `apps/web/src/app/catalog/categories/page.tsx`<br>`apps/web/src/app/catalog/attributes/page.tsx` |
| Import/export settings | Not available | No standalone import/export settings page validated | `apps/web/src/app/` route inventory at HEAD `0ae974c` |
| Connector defaults / settings | Embedded | Current connector defaults/governance are split across Connector Access, connectors list, and connector detail | `apps/web/src/app/admin/connectors/page.tsx`<br>`apps/web/src/app/connectors/page.tsx`<br>`apps/web/src/app/channels/connectors/[installationId]/page.tsx` |
| Notification settings | Not available | No standalone notification-settings page validated | `apps/web/src/app/` route inventory at HEAD `0ae974c` |
| Audit / security settings | Embedded | Current security/audit visibility is in Audit summary plus auth/privacy flows | `apps/web/src/app/admin/audit/page.tsx`<br>`apps/web/src/app/admin/privacy/page.tsx`<br>`apps/web/src/app/login/page.tsx` |
| API / token settings if applicable | Not available | No user-facing API/token settings page validated | `apps/web/src/app/` route inventory at HEAD `0ae974c` |
| Billing / subscription page if applicable | Standalone | `/admin/plan` | `apps/web/src/app/admin/plan/page.tsx` |
| Privacy | Standalone | `/admin/privacy` | `apps/web/src/app/admin/privacy/page.tsx`<br>`apps/web/src/components/settings/data-privacy-page-client.tsx` |
| Audit Logs | Standalone | `/admin/audit` | `apps/web/src/app/admin/audit/page.tsx` |

### H. Legacy route validation used by the guide

| Legacy route | Current behavior | Source files |
|---|---|---|
| `/catalog` | Redirects to `/catalog/products` | `apps/web/src/app/catalog/page.tsx` |
| `/settings` | Redirects to `/admin` | `apps/web/src/app/settings/page.tsx` |
| `/settings/plan` | Redirects to `/admin/plan` | `apps/web/src/app/settings/plan/page.tsx` |
| `/settings/connectors` | Redirects to `/admin/connectors` | `apps/web/src/app/settings/connectors/page.tsx` |
| `/catalog/media` | Re-exports `/media` | `apps/web/src/app/catalog/media/page.tsx`<br>`apps/web/src/app/media/page.tsx` |
| `/channels/connectors` | Re-exports current connectors implementation from `/connectors` | `apps/web/src/app/channels/connectors/page.tsx`<br>`apps/web/src/app/connectors/page.tsx` |
| `/connectors/[installationId]/mapping` | Redirects to `/channels/mappings` with carried scope | `apps/web/src/app/connectors/[installationId]/mapping/page.tsx` |
