# Page Action Playbook

## Page
- Route: `/channels/submissions`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/channels/submissions/page.tsx`
- Title: Submissions

## What this page is used for
- Read/monitor data and navigate to downstream workflow pages.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getSubmissions`.
3. Configure filters/form inputs using labels: `Status`, `Connector Slug`; selects: `status`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Input and control reference
- Buttons: Information not available in Vexa PIM project.
- Visible labels: `Status`, `Connector Slug`
- Field names (technical): `connectorSlug`
- Select names: `status`
- Placeholders: `amazon-in / flipkart / meesho`
- Links: `/channels/health`, `/operations/jobs`, `/channels/submissions`

## Related components
- `ui/card`, `ui/filter-bar`, `ui/kpi-card`, `ui/input`, `ui/page-header`, `ui/select`, `ui/status-chip`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
