# Page User Guide

## Route
- /channels/mappings

## Source File
- C:/Users/Om Computers/PIM1/apps/web/src/app/channels/mappings

## Page Title (Validated)
- Mappings

## Purpose
- Canonical lifecycle mapping workspace for channel publishing.
- Use this page to create, validate, publish, archive, and rollback mapping versions.
- This is the only editable mapping surface in the current Vexa PIM UX.

## Functionality (Validated from Page Imports/Actions)
- Data retrieval/API helpers used on this page:
  - ApiHttpError
  - type AppRole
  - type AttributeDefinition
  - type ConnectorTaxonomyItem
  - type MarketplaceChannel
  - evaluateConnectorMappingPreflight
  - evaluateConnectorPublishReadiness
  - getCategoryAttributes
  - getConnectorDefinitions
  - getConnectorMappingVersions
  - getCategories
  - getMarketplaceChannelMapping
  - getMarketplaceChannels
  - getUnmappedConnectorTaxonomy
  - resolveConnectorMapping
  - searchConnectorTaxonomy
- Mutation actions used on this page:
  - archiveConnectorMappingVersionAction
  - createConnectorMappingVersionAction
  - publishConnectorMappingVersionAction
  - rollbackConnectorMappingVersionAction
  - validateConnectorMappingVersionAction

## User Actions
- createConnectorMappingVersionAction
- validateConnectorMappingVersionAction
- publishConnectorMappingVersionAction
- archiveConnectorMappingVersionAction
- rollbackConnectorMappingVersionAction

## Notes
- This document is generated from current route source and only contains validated references.
- `/connectors/[installationId]/mapping` is transition-only and redirects here.
- For exact API endpoint mapping, refer to docs/openapi.yaml and apps/web/src/lib/api.ts.
