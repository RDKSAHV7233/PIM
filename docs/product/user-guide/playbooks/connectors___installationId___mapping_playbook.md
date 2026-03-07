# Page Action Playbook

## Page
- Route: `/connectors/[installationId]/mapping`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/connectors/[installationId]/mapping/page.tsx`
- Title: Mapping manager unavailable

## What this page is used for
- Execute operational workflows and mutations listed below.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getConnectorPayloadPreview`, `getInstalledConnectors`, `getMarketplaceChannelMapping`, `getMarketplaceTemplates`, `getProducts`.
3. Configure filters/form inputs using labels: `Product`, `Channel`, `Template`, `Template Name`, `Required Fields JSON`, `Field Map JSON`, `Default`; selects: `productId`, `channel`, `templateId`, `isDefault`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Clone mapping template (`cloneMappingTemplateAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Product`, `Channel`, `Template`, `Template Name`, `Required Fields JSON`, `Field Map JSON`, `Default`.
3. Submit the action and confirm success feedback on screen.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Create mapping template (`createMappingTemplateAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Product`, `Channel`, `Template`, `Template Name`, `Required Fields JSON`, `Field Map JSON`, `Default`.
3. Complete the creation form and submit.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Delete mapping template (`deleteMappingTemplateAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Product`, `Channel`, `Template`, `Template Name`, `Required Fields JSON`, `Field Map JSON`, `Default`.
3. Locate the target record, complete any confirmation checkbox/text, then submit delete.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Update mapping template (`updateMappingTemplateAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Product`, `Channel`, `Template`, `Template Name`, `Required Fields JSON`, `Field Map JSON`, `Default`.
3. Review preview/diff (if shown), then submit update/apply.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in PIM1 project.
- Visible labels: `Product`, `Channel`, `Template`, `Template Name`, `Required Fields JSON`, `Field Map JSON`, `Default`
- Field names (technical): `templateId`, `redirectTo`, `version`, `productId`, `categoryId`, `requiredFields`, `fieldMap`, `name`
- Select names: `productId`, `channel`, `templateId`, `isDefault`
- Placeholders: Information not available in PIM1 project.
- Links: `/dashboard`

## Related components
- `ui/button`, `ui/card`, `ui/empty-state`, `ui/input`, `ui/select`, `ui/textarea`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
