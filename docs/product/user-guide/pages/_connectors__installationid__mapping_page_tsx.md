# Page User Guide

## Route
- /connectors/[installationId]/mapping

## Source File
- C:/Users/Om Computers/PIM1/apps/web/src/app/connectors/[installationId]/mapping

## Page Title (Validated)
- Mapping manager title is context-driven by selected installation and product/channel selection.

## Purpose
- Mapping manager page for a connector installation, including template create/update/clone/delete and payload preview.

## Functionality (Validated from Page Imports/Actions)
- Data retrieval/API helpers used on this page:
  - ApiHttpError
  - AppRole
  - ChannelMappingTemplate
  - MarketplaceChannel
  - getConnectorPayloadPreview
  - getInstalledConnectors
  - getMarketplaceChannelMapping
  - getMarketplaceTemplates
  - getProducts
- Mutation actions used on this page:
  - cloneMappingTemplateAction
  - createMappingTemplateAction
  - deleteMappingTemplateAction
  - updateMappingTemplateAction

## User Actions
- cloneMappingTemplateAction
- createMappingTemplateAction
- deleteMappingTemplateAction
- updateMappingTemplateAction

## Notes
- This document is generated from current route source and only contains validated references.
- For exact API endpoint mapping, refer to docs/openapi.yaml and apps/web/src/lib/api.ts.
