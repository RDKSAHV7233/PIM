# Page Action Playbook

## Page
- Route: `/catalog/products`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/catalog/products/page.tsx`
- Title: Products

## What this page is used for
- Read/monitor data and navigate to downstream workflow pages.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getCategories`, `getInstalledConnectors`, `getProducts`, `getStats`.
3. Configure filters/form inputs using labels: `Hide test data`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Input and control reference
- Buttons: Information not available in Vexa PIM project.
- Visible labels: `Hide test data`
- Field names (technical): Information not available in Vexa PIM project.
- Select names: Information not available in Vexa PIM project.
- Placeholders: Information not available in Vexa PIM project.
- Links: `/operations/bulk-edit`, `/quality/issues`, `/quality/approvals`, `/admin/plan`

## Related components
- `product/products-tab`, `ui/page-header`, `ui/button`, `channel/product-channel-readiness-cell`, `product/CreateProductForm`, `ui/empty-state`, `ui/status-chip`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
