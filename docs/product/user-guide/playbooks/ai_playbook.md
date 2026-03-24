# Page Action Playbook

## Page
- Route: `/ai`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/ai/page.tsx`
- Title: AI Optimization

## What this page is used for
- Execute operational workflows and mutations listed below.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getAiAttributeEnrichment`, `getAiCategorySuggestion`, `getAiTitleSuggestion`, `getProducts`.
3. Configure filters/form inputs using labels: `Product`; selects: `productId`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Apply ai repair (`applyAiRepairAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Product`.
3. Review preview/diff (if shown), then submit update/apply.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in TEJ PIM project.
- Visible labels: `Product`
- Field names (technical): `productId`
- Select names: `productId`
- Placeholders: Information not available in TEJ PIM project.
- Links: Information not available in TEJ PIM project.

## Related components
- `ui/button`, `ui/card`, `ui/select`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
