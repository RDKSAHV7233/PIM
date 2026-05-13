# Page Action Playbook

## Page
- Route: `/quality/approvals`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/quality/approvals/page.tsx`
- Title: Approval Queue

## What this page is used for
- Read/monitor data and navigate to downstream workflow pages.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getIssueInbox`, `getStats`.
3. Use available cards/tables/links to inspect state.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Input and control reference
- Buttons: Information not available in Vexa PIM project.
- Visible labels: Information not available in Vexa PIM project.
- Field names (technical): Information not available in Vexa PIM project.
- Select names: Information not available in Vexa PIM project.
- Placeholders: Information not available in Vexa PIM project.
- Links: `/quality/issues?productStatus=in_review`, `/quality/validation`

## Related components
- `ui/card`, `ui/empty-state`, `ui/kpi-card`, `ui/page-header`, `ui/status-chip`, `ui/button`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
