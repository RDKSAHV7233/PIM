# Page Action Playbook

## Page
- Route: `/products/[id]`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/products/[id]/page.tsx`
- Title: No issues found

## What this page is used for
- Edit product data, fix blockers, review channel readiness, and create export/publish attempts.
- Mapping edits should be completed in `/channels/mappings`; any template controls here are transition-only helpers.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getMarketplaceChannelMapping`, `getMarketplaceChannels`, `getMarketplaceExportJobs`, `getInstalledConnectors`, `getMarketplaceSimulation`, `getMarketplaceTemplates`, `getCategoryAttributes`, `getProduct`, `getProductVariants`.
3. Configure filters/form inputs using labels: `Product Title`, `Brand`, `Description`, `HSN Code`, `GST Rate`, `Status`, `Additional Attributes`, `Channel`, `Mapping`, `Max Retries`; selects: `status`, `channel`, `templateId`, `fallbackAcknowledged`, `isDefault`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Create export job (`createExportJobAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Product Title`, `Brand`, `Description`, `HSN Code`, `GST Rate`, `Status`, `Additional Attributes`, `Channel`.
3. Complete the creation form and submit.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Create mapping template (`createMappingTemplateAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Product Title`, `Brand`, `Description`, `HSN Code`, `GST Rate`, `Status`, `Additional Attributes`, `Channel`.
3. Complete the creation form and submit.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Update product (`updateProductAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Product Title`, `Brand`, `Description`, `HSN Code`, `GST Rate`, `Status`, `Additional Attributes`, `Channel`.
3. Review preview/diff (if shown), then submit update/apply.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Create variant (`createVariantAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Product Title`, `Brand`, `Description`, `HSN Code`, `GST Rate`, `Status`, `Additional Attributes`, `Channel`.
3. Complete the creation form and submit.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Process export job (`processExportJobAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Product Title`, `Brand`, `Description`, `HSN Code`, `GST Rate`, `Status`, `Additional Attributes`, `Channel`.
3. Run the queued job action and monitor job state on jobs/submissions pages.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Requeue export job (`requeueExportJobAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Product Title`, `Brand`, `Description`, `HSN Code`, `GST Rate`, `Status`, `Additional Attributes`, `Channel`.
3. Run the queued job action and monitor job state on jobs/submissions pages.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Validate product (`validateProductAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Product Title`, `Brand`, `Description`, `HSN Code`, `GST Rate`, `Status`, `Additional Attributes`, `Channel`.
3. Run validation and review returned issues before next action.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in Vexa PIM project.
- Visible labels: `Product Title`, `Brand`, `Description`, `HSN Code`, `GST Rate`, `Status`, `Additional Attributes`, `Channel`, `Mapping`, `Max Retries`, `Fallback confirmation`, `Template Name`, `Required Fields`, `Field Mapping`, `Default Template`, `SKU Code`, `Inventory Quantity`, `MRP`, `Selling Price`, `Variant Attributes`
- Field names (technical): `productId`, `categoryId`, `expectedVersion`, `attributesBase`, `jobId`, `description`, `requiredFields`, `fieldMap`, `attributes`, `title`, `brand`, `hsnCode`, `gstRate`, `maxRetries`, `name`, `skuCode`, `inventoryQty`, `mrp`, `sellingPrice`
- Select names: `status`, `channel`, `templateId`, `fallbackAcknowledged`, `isDefault`
- Placeholders: Information not available in Vexa PIM project.
- Links: `/dashboard`, `/catalog/products`, `/channels/health`

## Related components
- `ui/button`, `ui/card`, `channel/product-readiness-summary-bar`, `ui/empty-state`, `ui/input`, `ui/page-header`, `ui/plan-limit-modal`, `ui/select`, `ui/side-rail-card`, `ui/status-chip`, `ui/textarea`, `ui/validation-issue-panel`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
- Connector workflow note: `/channels/mappings` is the canonical lifecycle mapping route in the current Vexa PIM UX.
