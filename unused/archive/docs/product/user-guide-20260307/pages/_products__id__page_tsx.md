# Page User Guide

## Route
- /products/[id]

## Source File
- C:/Users/Om Computers/PIM1/apps/web/src/app/products/[id]

## Page Title (Validated)
- Product detail title is dynamic and uses product title from loaded product data.

## Purpose
- Product workspace page with tabbed detail sections: Overview, Content, Attributes, Variants, Media, Channels, Quality, Activity.

## Functionality (Validated from Page Imports/Actions)
- Data retrieval/API helpers used on this page:
  - ApiHttpError
  - AppRole
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
  - createMappingTemplateAction
  - updateProductAction
  - createVariantAction
  - processExportJobAction
  - requeueExportJobAction
  - validateProductAction

## User Actions
- createExportJobAction
- createMappingTemplateAction
- updateProductAction
- createVariantAction
- processExportJobAction
- requeueExportJobAction
- validateProductAction

## Notes
- This document is generated from current route source and only contains validated references.
- For exact API endpoint mapping, refer to docs/openapi.yaml and apps/web/src/lib/api.ts.
