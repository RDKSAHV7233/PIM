# Page Action Playbook

## Page
- Route: `/admin/plan`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/admin/plan/page.tsx`
- Title: Plan and Usage

## What this page is used for
- Execute operational workflows and mutations listed below.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getBillingUsage`.
3. Configure filters/form inputs using labels: `Plan Tier`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Set plan tier (`setPlanTierAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Plan Tier`.
3. Submit the action and confirm success feedback on screen.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in TEJ PIM project.
- Visible labels: `Plan Tier`
- Field names (technical): Information not available in TEJ PIM project.
- Select names: Information not available in TEJ PIM project.
- Placeholders: Information not available in TEJ PIM project.
- Links: `/dashboard`, `/admin`

## Related components
- `ui/card`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
