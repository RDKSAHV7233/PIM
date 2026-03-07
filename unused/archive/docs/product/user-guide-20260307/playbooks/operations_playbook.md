# Page Action Playbook

## Page
- Route: `/operations`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/operations/page.tsx`
- Title: Operations

## What this page is used for
- Read/monitor data and navigate to downstream workflow pages.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getBulkImportJobs`, `getDeadLetterSubmissions`, `getSubmissions`.
3. Use available cards/tables/links to inspect state.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Input and control reference
- Buttons: Information not available in PIM1 project.
- Visible labels: Information not available in PIM1 project.
- Field names (technical): Information not available in PIM1 project.
- Select names: Information not available in PIM1 project.
- Placeholders: Information not available in PIM1 project.
- Links: `/operations/imports`, `/operations/bulk-edit`, `/operations/jobs`, `/operations/repair`

## Related components
- `ui/card`, `ui/page-header`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
