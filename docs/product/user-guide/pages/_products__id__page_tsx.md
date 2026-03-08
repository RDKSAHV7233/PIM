# Page User Guide

## Route
- /products/[id]

## Source File
- C:/Users/Om Computers/PIM1/apps/web/src/app/products/[id]

## Page Title (Validated)
- Product detail title is dynamic and uses product title from loaded product data.

## Purpose
- Product workspace page for editing catalog data, fixing blockers, reviewing channel readiness, and creating export/publish attempts.

## Functionality (Validated from Page Imports/Actions)
- Data retrieval/API helpers used on this page:
  - ApiHttpError
  - AppRole
  - evaluateConnectorPublishReadiness
  - getMarketplaceChannelMapping
  - getMarketplaceChannels
  - getMarketplaceExportJobs
  - getInstalledConnectors
  - getMarketplaceSimulation
  - getMarketplaceTemplates
  - getCategoryAttributes
  - getProduct
  - getProductVariants
  - MarketplaceChannel
- Mutation actions used on this page:
  - createExportJobAction
  - updateProductAction
  - createVariantAction
  - processExportJobAction
  - requeueExportJobAction
  - validateProductAction
  - createMappingTemplateAction (transition-only helper)

## User Actions
- createExportJobAction
- updateProductAction
- createVariantAction
- processExportJobAction
- requeueExportJobAction
- validateProductAction
- createMappingTemplateAction (transition-only helper)

## Notes
- This document is generated from current route source and only contains validated references.
- Primary mapping edits should be completed in `/channels/mappings`.
- Template helpers on the product page are transition-only and not the canonical mapping workflow.
- For exact API endpoint mapping, refer to docs/openapi.yaml and apps/web/src/lib/api.ts.
