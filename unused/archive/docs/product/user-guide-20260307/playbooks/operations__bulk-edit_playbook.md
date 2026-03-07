# Page Action Playbook

## Page
- Route: `/operations/bulk-edit`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/operations/bulk-edit/page.tsx`
- Title: Operations Bulk Edit

## What this page is used for
- Execute operational workflows and mutations listed below.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getBulkEditOperations`, `getBulkEditPreview`, `getCategories`, `getProducts`.
3. Configure filters/form inputs using labels: `Category`, `Status`, `Brand Contains`, `Product IDs`, `Updates`, `I have reviewed the preview and I am ready to apply these changes.`; selects: `bulkEditCategoryId`, `bulkEditStatus`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Apply bulk edit (`applyBulkEditAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Category`, `Status`, `Brand Contains`, `Product IDs`, `Updates`, `I have reviewed the preview and I am ready to apply these changes.`.
3. Review preview/diff (if shown), then submit update/apply.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Apply (`applyAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Category`, `Status`, `Brand Contains`, `Product IDs`, `Updates`, `I have reviewed the preview and I am ready to apply these changes.`.
3. Review preview/diff (if shown), then submit update/apply.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in PIM1 project.
- Visible labels: `Category`, `Status`, `Brand Contains`, `Product IDs`, `Updates`, `I have reviewed the preview and I am ready to apply these changes.`
- Field names (technical): `bulkEditProductIds`, `bulkEditUpdates`, `bulkEditBrandContains`, `categoryId`, `status`, `brandContains`, `productIds`, `updates`
- Select names: `bulkEditCategoryId`, `bulkEditStatus`
- Placeholders: `Optional, comma or newline separated`
- Links: Information not available in PIM1 project.

## Related components
- `bulk-edit/bulk-edit-diff-preview`, `ui/button`, `ui/card`, `ui/input`, `ui/select`, `ui/textarea`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
