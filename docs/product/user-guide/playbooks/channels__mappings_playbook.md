# Page Action Playbook

## Page
- Route: `/channels/mappings`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/channels/mappings/page.tsx`
- Title: Mappings

## What this page is used for
- Execute operational workflows and mutations listed below.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getCategories`, `getMarketplaceChannelMapping`, `getMarketplaceChannels`, `getMarketplaceTemplates`.
3. Configure filters/form inputs using labels: `Category`, `Channel`, `Template Name`, `Required Fields (JSON array)`, `Field Map (JSON object)`, `Set as default`; selects: `categoryId`, `channel`, `isDefault`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Clone mapping template (`cloneMappingTemplateAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Category`, `Channel`, `Template Name`, `Required Fields (JSON array)`, `Field Map (JSON object)`, `Set as default`.
3. Submit the action and confirm success feedback on screen.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Create mapping template (`createMappingTemplateAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Category`, `Channel`, `Template Name`, `Required Fields (JSON array)`, `Field Map (JSON object)`, `Set as default`.
3. Complete the creation form and submit.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Delete mapping template (`deleteMappingTemplateAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Category`, `Channel`, `Template Name`, `Required Fields (JSON array)`, `Field Map (JSON object)`, `Set as default`.
3. Locate the target record, complete any confirmation checkbox/text, then submit delete.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Update mapping template (`updateMappingTemplateAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Category`, `Channel`, `Template Name`, `Required Fields (JSON array)`, `Field Map (JSON object)`, `Set as default`.
3. Review preview/diff (if shown), then submit update/apply.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in PIM1 project.
- Visible labels: `Category`, `Channel`, `Template Name`, `Required Fields (JSON array)`, `Field Map (JSON object)`, `Set as default`
- Field names (technical): `categoryId`, `channel`, `templateId`, `redirectTo`, `isDefault`, `name`, `requiredFields`, `fieldMap`
- Select names: `categoryId`, `channel`, `isDefault`
- Placeholders: Information not available in PIM1 project.
- Links: `/channels/connectors`, `/catalog/products`

## Related components
- `ui/button`, `ui/card`, `ui/filter-bar`, `ui/input`, `ui/page-header`, `ui/select`, `ui/status-chip`, `ui/textarea`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
