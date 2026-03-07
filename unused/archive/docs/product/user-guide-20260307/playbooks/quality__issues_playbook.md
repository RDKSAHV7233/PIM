# Page Action Playbook

## Page
- Route: `/quality/issues`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/quality/issues/page.tsx`
- Title: Issue Inbox

## What this page is used for
- Execute operational workflows and mutations listed below.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getCategories`, `getInstalledConnectors`, `getIssueInbox`.
3. Configure filters/form inputs using labels: `Severity`, `Connector Install`, `Category`, `Product Status`, `Page Size`; selects: `severity`, `installationId`, `categoryId`, `productStatus`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Resolve issue inbox warnings (`resolveIssueInboxWarningsAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Severity`, `Connector Install`, `Category`, `Product Status`, `Page Size`.
3. Choose the issue/job row to resolve and confirm the action.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in PIM1 project.
- Visible labels: `Severity`, `Connector Install`, `Category`, `Product Status`, `Page Size`
- Field names (technical): `returnTo`, `issueIds`, `limit`
- Select names: `severity`, `installationId`, `categoryId`, `productStatus`
- Placeholders: Information not available in PIM1 project.
- Links: `/quality/issues`

## Related components
- `ui/button`, `ui/card`, `ui/empty-state`, `ui/filter-bar`, `ui/kpi-card`, `ui/input`, `ui/page-header`, `ui/select`, `ui/status-chip`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
