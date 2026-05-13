# Page Action Playbook

## Page
- Route: `/admin/connectors`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/admin/connectors/page.tsx`
- Title: Connector Access

## What this page is used for
- Execute operational workflows and mutations listed below.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getConnectorDefinitions`, `getConnectorPermissions`.
3. Configure filters/form inputs using labels: `Connector`, `Principal Type`, `Principal Id`, `Action`, `Account Alias (optional)`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Grant connector permission (`grantConnectorPermissionAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Connector`, `Principal Type`, `Principal Id`, `Action`, `Account Alias (optional)`.
3. Enter principal/action/scope details and submit grant.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Revoke connector permission (`revokeConnectorPermissionAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Connector`, `Principal Type`, `Principal Id`, `Action`, `Account Alias (optional)`.
3. Select an existing policy/permission row and submit revoke.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in Vexa PIM project.
- Visible labels: `Connector`, `Principal Type`, `Principal Id`, `Action`, `Account Alias (optional)`
- Field names (technical): `principalId`, `accountAlias`, `permissionId`
- Select names: Information not available in Vexa PIM project.
- Placeholders: `e.g. editor or user@tenant`, `* (all aliases)`
- Links: `/dashboard`, `/admin`

## Related components
- `ui/card`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
