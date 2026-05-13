---
title: Vexa PIM Jira Backlog - 2026-05-04
type: jira-ready-backlog
reviewer: codex
source: launch-readiness review
---

## Backlog Summary

Goal:

- Move Vexa PIM from `demo-capable and controlled-pilot capable` to `broad paid rollout ready`.

Prioritization model:

- `P0`: fix before broader external selling
- `P1`: improve before/through pilot
- `P2`: polish after pilot or alongside expansion

## Epic 1: New User Activation

### VXP-101 Dashboard-first onboarding checklist

- Priority: `P0`
- Area: Dashboard, Products
- Problem: Onboarding exists, but the strongest guidance currently lives in the product workbench instead of one first-stop activation surface.
- User story: As a new workspace admin, I want one guided checklist so I know exactly what to do next.
- Acceptance criteria:
- Dashboard shows checklist for import/create, completeness, issue resolution, connector setup, and publish readiness.
- Checklist progress reflects live product/workspace state.
- CTA links route directly into the next task surface.

### VXP-102 Shared readiness glossary and explainer copy

- Priority: `P1`
- Area: Dashboard, Quality, Product Detail, Channels
- Problem: Completeness, validation, approval, and publish readiness are strong but conceptually fragmented.
- User story: As an operator, I want plain-language explanations of readiness states so I can act confidently.
- Acceptance criteria:
- Shared help copy explains completeness, validation, approval, and connector readiness.
- Status chips and summary panels use consistent terminology.

## Epic 2: Product Workbench and Catalog UX

### VXP-201 Elevate workbench onboarding pattern into reusable shell

- Priority: `P1`
- Area: Products, Dashboard
- Problem: The product workbench has strong task framing that other pages do not match.
- Acceptance criteria:
- Reusable onboarding/progress component extracted.
- Dashboard and at least one more workflow page adopt the same pattern.

### VXP-202 Improve product create guidance

- Priority: `P1`
- Area: Product creation
- Problem: Create-product form is functional but still form-heavy for non-technical users.
- Acceptance criteria:
- Required fields are grouped more clearly.
- Category attribute guidance is more descriptive.
- Inline success state explains next recommended action.

### VXP-203 Add product-level workflow stepper

- Priority: `P1`
- Area: Product detail
- Problem: Product detail is powerful but still relies on users inferring sequence.
- Acceptance criteria:
- Overview or side rail shows stepper: content, validation, approval, channel readiness, export.
- Current step and blockers are clearly visible.

## Epic 3: Import, Repair, and Bulk Operations

### VXP-301 Add "what happens next" import summary

- Priority: `P1`
- Area: Operations Imports
- Problem: Import page is strong, but transition from import completion to repair or validation can be clearer.
- Acceptance criteria:
- Completed import state shows next recommended action based on results.
- Failed/dead-letter jobs link directly to repair context.

### VXP-302 Improve row-repair affordances

- Priority: `P1`
- Area: Operations Imports, Repair Center
- Problem: Repair is present, but prioritization and fix confidence can be stronger.
- Acceptance criteria:
- Rows needing repair show grouped error categories.
- Repair UI highlights highest-impact fixes first.

### VXP-303 Standardize bulk-edit preview messaging

- Priority: `P2`
- Area: Bulk Edit
- Problem: Preview-first workflow is correct but could feel technical.
- Acceptance criteria:
- Preview explains impacted products and fields in plain language.
- Destructive or workflow-sensitive edits display stronger warnings.

## Epic 4: Quality, Validation, and Approvals

### VXP-401 Tighten issue-to-fix-to-approve journey

- Priority: `P0`
- Area: Quality, Product Detail
- Problem: The quality system is good, but users still traverse multiple surfaces to finish decisions.
- Acceptance criteria:
- Issue inbox rows link directly to exact product detail tab and return context.
- Approval queue shows a clearer "ready for decision" state.

### VXP-402 Add approval decision confidence summary

- Priority: `P1`
- Area: Approval Queue
- Problem: Blocking rule is strong, but operators still need stronger decision confidence.
- Acceptance criteria:
- Approval queue summarizes blockers cleared, warnings remaining, connector readiness, and last validation.

### VXP-403 Surface quality trends more visibly

- Priority: `P2`
- Area: Quality Overview
- Problem: Daily progress exists, but trend visibility can better support team leads.
- Acceptance criteria:
- Quality overview shows directional trend cards for blockers, warnings, and resolved items.

## Epic 5: Mapping and Publish Readiness

### VXP-501 Add workspace-level publish readiness summary

- Priority: `P0`
- Area: Dashboard, Channels
- Problem: Product-level readiness is strong, but workspace-level publish confidence is less centralized.
- Acceptance criteria:
- Dashboard or channels overview shows count of ready, blocked, and at-risk products by channel.
- Links drill into mappings, products, or connector issues.

### VXP-502 Simplify mapping workbench first-time use

- Priority: `P1`
- Area: Channels Mappings
- Problem: Mapping workbench is strong but cognitively dense for first-time users.
- Acceptance criteria:
- First-use helper state explains scope, draft, validate, publish sequence.
- Required mappings are visually prioritized over optional ones.

### VXP-503 Add simplified publish preflight panel

- Priority: `P0`
- Area: Product channels tab, submissions
- Problem: Publish capability exists, but demo and operator clarity would improve with a simpler preflight layer.
- Acceptance criteria:
- Preflight summarizes approval status, product blockers, media blockers, mapping blockers, and connector account state.
- Publish/export CTA clearly states if action is blocked and why.

## Epic 6: Connector Portfolio and Channel Packaging

### VXP-601 Publish connector capability matrix in-product

- Priority: `P0`
- Area: Connectors
- Problem: Connector breadth is uneven and needs explicit buyer-safe positioning.
- Acceptance criteria:
- Each connector shows maturity, supported actions, and limitations.
- Meesho is clearly labeled export/manual only.
- No unsupported connector is implied as live.

### VXP-602 Decide and implement WooCommerce posture

- Priority: `P0`
- Area: Product, Sales, Connectors
- Problem: Requested review scope includes WooCommerce, but repo evidence does not.
- Acceptance criteria:
- WooCommerce is either implemented, explicitly marked planned, or removed from claims and demo scope.

### VXP-603 Improve connector detail storytelling

- Priority: `P1`
- Area: Connector detail
- Problem: Detail pages are operationally rich but can be more buyer-friendly.
- Acceptance criteria:
- Connector detail surfaces connection health, last sync, publication target context, and publish readiness in a concise summary block.

## Epic 7: Responsive and Frontend Polish

### VXP-701 Responsive data-grid pattern for core tables

- Priority: `P0`
- Area: Products, Jobs, Approvals, Media, Users, Webhooks, Audit
- Problem: Many critical pages use wide tables with `overflow-x-auto` and large `min-w` widths.
- Acceptance criteria:
- Small-screen layouts switch to stacked cards or condensed lists.
- Core actions remain visible without horizontal scroll where feasible.

### VXP-702 Shared loading, empty, and error state kit

- Priority: `P1`
- Area: Cross-app
- Problem: Async states exist but could be more standardized.
- Acceptance criteria:
- Shared primitives cover loading, empty, warning, outage, and recovery actions.
- Applied to dashboard, imports, quality, channels, and admin pages.

### VXP-703 Premium polish pass on admin and operations views

- Priority: `P2`
- Area: Admin, Operations
- Problem: Several enterprise pages feel functional but not premium.
- Acceptance criteria:
- Improve spacing, hierarchy, and summary framing on users, API keys, webhooks, jobs, and audit.

## Epic 8: Navigation and Information Architecture

### VXP-801 Reduce route alias ambiguity

- Priority: `P1`
- Area: Settings, Reports, legacy aliases
- Problem: Redirect aliases are honest but still add conceptual surface area.
- Acceptance criteria:
- Navigation model is documented and simplified.
- Non-canonical routes are minimized or clearly scoped as legacy.

### VXP-802 Add page-level "why am I here?" context blocks

- Priority: `P2`
- Area: High-complexity pages
- Problem: Some screens assume operator familiarity.
- Acceptance criteria:
- Mapping, audit, bulk edit, and approvals pages include concise context copy for first-time users.

## Epic 9: QA, Browser Validation, and Release Confidence

### VXP-901 Mobile/tablet browser validation suite

- Priority: `P0`
- Area: QA
- Problem: Responsive behavior is not sufficiently proven from current environment checks.
- Acceptance criteria:
- Browser QA covers products, imports, jobs, approvals, connectors, and audit on tablet and narrow desktop widths.

### VXP-902 Live connector smoke validation

- Priority: `P1`
- Area: QA, Connectors
- Problem: Local integration tests are strong, but live provider behavior is not proven here.
- Acceptance criteria:
- Staging smoke checks run against supported live connector flows where safe.
- Failures are captured in rollout evidence.

### VXP-903 New-user golden journey E2E

- Priority: `P0`
- Area: QA
- Problem: Individual surfaces are tested well, but the full new-user activation path should be protected end-to-end.
- Acceptance criteria:
- Browser journey covers signup/login, create/import, issue resolution, mapping, connector path, publish/export, and status tracking.

## Epic 10: Sales and Launch Packaging

### VXP-1001 Demo tenant and scripted story pack

- Priority: `P0`
- Area: Product Marketing, PO
- Problem: Strong product can still demo poorly without a curated tenant and story.
- Acceptance criteria:
- Seeded tenant includes ready, blocked, and in-review examples.
- Demo follows one clean operator story.

### VXP-1002 Buyer-safe connector messaging

- Priority: `P0`
- Area: Sales, Product
- Problem: Channel maturity must be explicit in pitch, website, and demo.
- Acceptance criteria:
- Supported actions per connector are documented.
- Partial/manual connectors are labeled consistently.

### VXP-1003 Pilot operations playbook

- Priority: `P1`
- Area: PO, Support, CS
- Problem: Controlled pilots need operational consistency.
- Acceptance criteria:
- Pilot checklist covers onboarding, success criteria, escalation path, and fallback guidance.

## Suggested Sprint Order

Sprint 1:

- VXP-101
- VXP-401
- VXP-501
- VXP-601
- VXP-701
- VXP-903
- VXP-1001
- VXP-1002

Sprint 2:

- VXP-202
- VXP-301
- VXP-402
- VXP-502
- VXP-503
- VXP-603
- VXP-801
- VXP-901

Sprint 3:

- VXP-201
- VXP-302
- VXP-702
- VXP-703
- VXP-902
- VXP-1003

Sprint 4:

- VXP-203
- VXP-303
- VXP-403
- VXP-802

## Release Gate Labels

Use these Jira labels:

- `launch-p0`
- `launch-p1`
- `launch-p2`
- `demo-readiness`
- `pilot-readiness`
- `ux-polish`
- `responsive`
- `connector-positioning`
- `qa-e2e`
