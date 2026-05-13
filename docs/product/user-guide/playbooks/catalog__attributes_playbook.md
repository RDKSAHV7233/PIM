# Page Action Playbook

## Page
- Route: `/catalog/attributes`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/catalog/attributes/page.tsx`
- Title: Attributes

## What this page is used for
- Execute operational workflows and mutations listed below.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getCategories`, `getCategoryAttributes`.
3. Configure filters/form inputs using labels: `Category`, `Display Name`, `Key`, `Data Type`, `Applies To`, `Required`, `Allowed Values (JSON array)`; selects: `categoryId`, `dataType`, `appliesTo`, `required`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Create attribute definition (`createAttributeDefinitionAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Category`, `Display Name`, `Key`, `Data Type`, `Applies To`, `Required`, `Allowed Values (JSON array)`.
3. Complete the creation form and submit.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in Vexa PIM project.
- Visible labels: `Category`, `Display Name`, `Key`, `Data Type`, `Applies To`, `Required`, `Allowed Values (JSON array)`
- Field names (technical): `categoryId`, `name`, `key`
- Select names: `categoryId`, `dataType`, `appliesTo`, `required`
- Placeholders: Information not available in Vexa PIM project.
- Links: `/catalog/categories`, `/catalog/products`

## Related components
- `ui/button`, `ui/card`, `ui/page-header`, `ui/select`, `ui/status-chip`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
