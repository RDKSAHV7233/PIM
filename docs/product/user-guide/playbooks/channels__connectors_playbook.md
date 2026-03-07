# Page Action Playbook

## Page
- Route: `/channels/connectors`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/channels/connectors/page.tsx`
- Title: Channel Connectors

## What this page is used for
- Execute operational workflows and mutations listed below.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getConnectorDefinitions`, `getInstalledConnectors`, `getProducts`.
3. Configure filters/form inputs using labels: `Account Alias`, `External Account Ref`, `Confirm permanent delete`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Delete connector installation (`deleteConnectorInstallationAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Account Alias`, `External Account Ref`, `Confirm permanent delete`.
3. Locate the target record, complete any confirmation checkbox/text, then submit delete.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Install connector (`installConnectorAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Account Alias`, `External Account Ref`, `Confirm permanent delete`.
3. Pick connector/account details and submit the install form.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Reconnect connector (`reconnectConnectorAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Account Alias`, `External Account Ref`, `Confirm permanent delete`.
3. Locate the installed row and submit reconnect.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Uninstall connector (`uninstallConnectorAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Account Alias`, `External Account Ref`, `Confirm permanent delete`.
3. Locate the installed row and submit disable/uninstall.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in PIM1 project.
- Visible labels: `Account Alias`, `External Account Ref`, `Confirm permanent delete`
- Field names (technical): `slug`, `installationId`, `connectorSlug`, `confirmDelete`, `accountAlias`, `externalAccountRef`
- Select names: Information not available in PIM1 project.
- Placeholders: `Optional`
- Links: `/admin/connectors`, `/admin/plan`

## Related components
- `ui/button`, `ui/card`, `ui/empty-state`, `ui/input`, `ui/status-chip`, `ui/page-header`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
