# Page Action Playbook

## Page
- Route: `/quality/approvals`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/quality/approvals/page.tsx`
- Title: Approval Queue

## What this page is used for
- Execute operational workflows and mutations listed below.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getProducts`.
3. Use available cards/tables/links to inspect state.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Transition product status (`transitionProductStatusAction`)
1. Open this page and review the relevant section for the action.
2. Select target status and submit status transition.
3. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in PIM1 project.
- Visible labels: Information not available in PIM1 project.
- Field names (technical): `transition`, `productId`, `targetStatus`, `returnTo`
- Select names: Information not available in PIM1 project.
- Placeholders: Information not available in PIM1 project.
- Links: Information not available in PIM1 project.

## Related components
- `ui/button`, `ui/card`, `ui/empty-state`, `ui/kpi-card`, `ui/page-header`, `ui/status-chip`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
