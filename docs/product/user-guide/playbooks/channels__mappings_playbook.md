# Page Action Playbook

## Page
- Route: `/channels/mappings`
- Source: `C:/Users/Om Computers/PIM1/apps/web/src/app/channels/mappings/page.tsx`
- Title: Mappings

## What this page is used for
- Maintain the canonical lifecycle mapping workspace for channel publishing.
- This is the only editable mapping surface; legacy connector mapping routes redirect here.

## How to use this page (step-by-step)
1. Open the route from left navigation or direct URL.
2. Wait for data to load from: `getCategoryAttributes`, `getConnectorDefinitions`, `getConnectorMappingVersions`, `getCategories`, `getMarketplaceChannelMapping`, `getMarketplaceChannels`, `getUnmappedConnectorTaxonomy`.
3. Configure filters/form inputs using labels: `Step-up re-authentication`, `Category`, `Channel`, `Taxonomy search`, `Mapping type`, `Category scope`, `Publish category`, `Channel compatibility`, `Allow fallback mapping`, `Fallback confirmation`; selects: `categoryId`, `channel`, `mappingLevel`, `targetCategory`, `compatibilityState`, `fallbackEnabled`, `fallbackAckRequired`.
4. Use row-level actions/links where available.
5. Confirm success by checking updated status, table rows, and/or history sections.

## Action runbooks
### Archive connector mapping version (`archiveConnectorMappingVersionAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Step-up re-authentication`, `Category`, `Channel`, `Taxonomy search`, `Mapping type`, `Category scope`, `Publish category`, `Channel compatibility`.
3. Submit the action and confirm success feedback on screen.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Create connector mapping version (`createConnectorMappingVersionAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Step-up re-authentication`, `Category`, `Channel`, `Taxonomy search`, `Mapping type`, `Category scope`, `Publish category`, `Channel compatibility`.
3. Complete the creation form and submit.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Publish connector mapping version (`publishConnectorMappingVersionAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Step-up re-authentication`, `Category`, `Channel`, `Taxonomy search`, `Mapping type`, `Category scope`, `Publish category`, `Channel compatibility`.
3. Submit the action and confirm success feedback on screen.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Rollback connector mapping version (`rollbackConnectorMappingVersionAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Step-up re-authentication`, `Category`, `Channel`, `Taxonomy search`, `Mapping type`, `Category scope`, `Publish category`, `Channel compatibility`.
3. Submit the action and confirm success feedback on screen.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

### Validate connector mapping version (`validateConnectorMappingVersionAction`)
1. Open this page and review the relevant section for the action.
2. Fill the required fields shown on screen: `Step-up re-authentication`, `Category`, `Channel`, `Taxonomy search`, `Mapping type`, `Category scope`, `Publish category`, `Channel compatibility`.
3. Run validation and review returned issues before next action.
4. Verify the page refreshes with updated state (status chip/table row/history).
Expected result:
- Mutation is accepted and corresponding list/detail status updates on reload.
Failure handling:
- If server returns error code/message, correct inputs/permissions and retry.

## Input and control reference
- Buttons: Information not available in PIM1 project.
- Visible labels: `Step-up re-authentication`, `Category`, `Channel`, `Taxonomy search`, `Mapping type`, `Category scope`, `Publish category`, `Channel compatibility`, `Allow fallback mapping`, `Fallback confirmation`, `Default fallback category`, `Fallback label`, `Confirmation message`, `Override mapping rules (JSON)`, `Override fallback behavior (JSON)`, `Archive reason`, `Rollback reason`
- Field names (technical): `connectorSlug`, `versionId`, `redirectTo`, `requiredField`, `taxonomyRequiredAttribute`, `connectorDefinitionId`, `connectorDefinitionVersion`, `confirm`, `fallbackAckMessage`, `mappingRules`, `fallbackPolicy`, `stepUpPassword`, `taxonomyQ`, `categoryScope`, `targetCategory`, `fallbackDefaultCategory`, `fallbackWarningTag`, `reason`
- Select names: `categoryId`, `channel`, `mappingLevel`, `targetCategory`, `compatibilityState`, `fallbackEnabled`, `fallbackAckRequired`
- Placeholders: `Enter your password`, `Search category path...`, `Enter target channel category id`, `Optional fallback category id`
- Links: `/channels/connectors`, `/catalog/products`

## Related components
- `ui/button`, `ui/card`, `ui/filter-bar`, `ui/input`, `ui/page-header`, `ui/select`, `ui/status-chip`, `ui/textarea`

## Validation source
- Derived from route source + first-level component source imports.
- No behavior is added beyond validated code references.
- Connector workflow note: `/channels/mappings` is the canonical lifecycle mapping route in the current PIM1 UX.
