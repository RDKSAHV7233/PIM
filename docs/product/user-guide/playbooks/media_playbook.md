# Page Action Playbook

## Page
- Route: `/media`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/media/page.tsx`
- Title: Media

## What this page is used for
- Execute operational workflows and mutations listed below.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getMediaAssets`, `getMediaAssetValidation`, `getProducts`.
3. Configure filters/form inputs using labels: `Product`, `Variant ID`, `Image File`, `Width`, `Height`, `CSV Content`; selects: `productId`, `channel`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Bulk associate media csv (`bulkAssociateMediaCsvAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Product`, `Variant ID`, `Image File`, `Width`, `Height`, `CSV Content`.
3. Submit the action and confirm success feedback on screen.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Upload media asset (`uploadMediaAssetAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Product`, `Variant ID`, `Image File`, `Width`, `Height`, `CSV Content`.
3. Select file/media inputs, then submit upload.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in TEJ PIM project.
- Visible labels: `Product`, `Variant ID`, `Image File`, `Width`, `Height`, `CSV Content`
- Field names (technical): `productId`, `variantId`, `assetId`, `csvContent`, `sourceFile`, `width`, `height`
- Select names: `productId`, `channel`
- Placeholders: `Optional`, `Optional if PNG`, `Paste CSV rows`
- Links: `/catalog/products`, `/channels/health`

## Related components
- `ui/button`, `ui/card`, `ui/input`, `ui/page-header`, `ui/plan-limit-modal`, `ui/select`, `ui/textarea`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
