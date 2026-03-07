# Page Action Playbook

## Page
- Route: `/rejection`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/rejection/page.tsx`
- Title: Rejection Insights

## What this page is used for
- Read/monitor data and navigate to downstream workflow pages.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getDashboardHealth`, `getProducts`, `getRejectionIntelligenceScore`.
3. Configure filters/form inputs using labels: `Product`, `Channel`; selects: `productId`, `channel`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Input and control reference
- Buttons: Information not available in PIM1 project.
- Visible labels: `Product`, `Channel`
- Field names (technical): Information not available in PIM1 project.
- Select names: `productId`, `channel`
- Placeholders: Information not available in PIM1 project.
- Links: `/quality/issues`

## Related components
- `ui/button`, `ui/card`, `ui/empty-state`, `ui/filter-bar`, `ui/kpi-card`, `ui/page-header`, `ui/select`, `ui/status-chip`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
