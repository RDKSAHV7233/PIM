# Page Action Playbook

## Page
- Route: `/ondc`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/ondc/page.tsx`
- Title: ONDC Expansion

## What this page is used for
- Execute operational workflows and mutations listed below.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getCategories`, `getOndcMappings`, `getOndcSimulation`, `getOndcVersions`, `getProducts`.
3. Configure filters/form inputs using labels: `Mapping Name`, `Category`, `Node Type`, `Version`, `Required Fields`, `Field Mapping`, `Discovery Metadata`, `Default Mapping`, `Product`, `Mapping`; selects: `categoryId`, `nodeType`, `version`, `isDefault`, `productId`, `mappingId`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Create ondc mapping (`createOndcMappingAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Mapping Name`, `Category`, `Node Type`, `Version`, `Required Fields`, `Field Mapping`, `Discovery Metadata`, `Default Mapping`.
3. Complete the creation form and submit.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Run ondc simulation (`runOndcSimulationAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Mapping Name`, `Category`, `Node Type`, `Version`, `Required Fields`, `Field Mapping`, `Discovery Metadata`, `Default Mapping`.
3. Submit the action and confirm success feedback on screen.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in Vexa PIM project.
- Visible labels: `Mapping Name`, `Category`, `Node Type`, `Version`, `Required Fields`, `Field Mapping`, `Discovery Metadata`, `Default Mapping`, `Product`, `Mapping`
- Field names (technical): `requiredFields`, `fieldMap`, `discoveryMetadata`, `name`
- Select names: `categoryId`, `nodeType`, `version`, `isDefault`, `productId`, `mappingId`
- Placeholders: `e.g. ONDC Apparel Mapping`
- Links: Information not available in Vexa PIM project.

## Related components
- `ui/button`, `ui/card`, `ui/input`, `ui/select`, `ui/textarea`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
