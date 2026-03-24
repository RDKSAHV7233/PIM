# Page Action Playbook

## Page
- Route: `/operations/jobs`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/operations/jobs/page.tsx`
- Title: Jobs

## What this page is used for
- Read/monitor data and navigate to downstream workflow pages.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getDeadLetterSubmissions`, `getSubmissions`.
3. Configure filters/form inputs using labels: `Status`, `Connector Slug`, `Submission ID`; selects: `status`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Input and control reference
- Buttons: Information not available in TEJ PIM project.
- Visible labels: `Status`, `Connector Slug`, `Submission ID`
- Field names (technical): `connectorSlug`, `submissionId`
- Select names: `status`
- Placeholders: `amazon-in / flipkart / meesho`, `optional`
- Links: `/operations/repair`, `/channels/connectors`, `/operations/jobs`

## Related components
- `ui/card`, `ui/empty-state`, `ui/filter-bar`, `ui/kpi-card`, `ui/input`, `ui/page-header`, `ui/select`, `ui/status-chip`, `ui/button`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
