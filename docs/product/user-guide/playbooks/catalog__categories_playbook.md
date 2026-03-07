# Page Action Playbook

## Page
- Route: `/catalog/categories`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/catalog/categories/page.tsx`
- Title: No categories found

## What this page is used for
- Execute operational workflows and mutations listed below.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getCategories`.
3. Configure filters/form inputs using labels: `Category Name`, `Parent Category`; selects: `parentId`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Create category (`createCategoryAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Category Name`, `Parent Category`.
3. Complete the creation form and submit.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in PIM1 project.
- Visible labels: `Category Name`, `Parent Category`
- Field names (technical): `name`
- Select names: `parentId`
- Placeholders: `e.g. Men's Shirts`
- Links: Information not available in PIM1 project.

## Related components
- `ui/button`, `ui/card`, `category/category-tree-table`, `ui/empty-state`, `ui/input`, `ui/select`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
