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
3. Review the current plan summary and usage meters.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Request commercial plan change
1. Open this page and review the current usage and plan summary.
2. Use the `Request upgrade` / commercial contact CTA.
3. Confirm the commercial request path includes enough tenant context for TEJ to act.
4. Verify follow-up happens through the TEJ commercial workflow rather than direct self-service plan mutation.
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in TEJ PIM project.
- Visible labels: `Request upgrade`, current plan summary, usage meters
- Field names (technical): Information not available in TEJ PIM project.
- Select names: Information not available in TEJ PIM project.
- Placeholders: Information not available in TEJ PIM project.
- Links: `/dashboard`, `/admin`

## Related components
- `ui/card`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
