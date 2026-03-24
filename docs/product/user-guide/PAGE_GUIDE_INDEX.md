# TEJ PIM Page-wise User Guide Index

Generated from apps/web/src/app route files.

This file is a reference inventory. For current action guidance, use:
- `PAGE_ACTION_PLAYBOOK_INDEX.md`
- `playbooks/*.md`

Connector-specific note:
- `/channels/mappings` is the canonical lifecycle mapping workspace.
- `/connectors/[installationId]/mapping` is transition-only and redirects into `/channels/mappings`.

| Route | Title | Guide File | API Functions | Action Functions |
|---|---|---|---|---|
| /admin/audit | Information not available in TEJ PIM project. | [_admin_audit_page_tsx.md](./pages/_admin_audit_page_tsx.md) |  |  |
| /admin/connectors | Information not available in TEJ PIM project. | [_admin_connectors_page_tsx.md](./pages/_admin_connectors_page_tsx.md) | ApiHttpError, getConnectorDefinitions, getConnectorPermissions | grantConnectorPermissionAction, revokeConnectorPermissionAction |
| /admin | Admin | [_admin_page_tsx.md](./pages/_admin_page_tsx.md) |  |  |
| /admin/plan | Information not available in TEJ PIM project. | [_admin_plan_page_tsx.md](./pages/_admin_plan_page_tsx.md) | ApiHttpError, getBillingUsage | setPlanTierAction |
| /admin/privacy | Information not available in TEJ PIM project. | [_admin_privacy_page_tsx.md](./pages/_admin_privacy_page_tsx.md) |  |  |
| /admin/users | Users & Roles | [_admin_users_page_tsx.md](./pages/_admin_users_page_tsx.md) | ApiHttpError, getBillingUsage, getConnectorPermissions |  |
| /admin/workspace | Workspace Settings | [_admin_workspace_page_tsx.md](./pages/_admin_workspace_page_tsx.md) |  |  |
| /ai | Information not available in TEJ PIM project. | [_ai_page_tsx.md](./pages/_ai_page_tsx.md) | ApiHttpError, AppRole, getAiAttributeEnrichment, getAiCategorySuggestion, getAiTitleSuggestion, getProducts | applyAiRepairAction |
| /catalog/attributes | Attributes | [_catalog_attributes_page_tsx.md](./pages/_catalog_attributes_page_tsx.md) | ApiHttpError, type AppRole, type AttributeDefinition, getCategories, getCategoryAttributes | createAttributeDefinitionAction |
| /catalog/categories | No categories found | [_catalog_categories_page_tsx.md](./pages/_catalog_categories_page_tsx.md) | ApiHttpError, getCategories | createCategoryAction |
| /catalog/media | Information not available in TEJ PIM project. | [_catalog_media_page_tsx.md](./pages/_catalog_media_page_tsx.md) |  |  |
| /catalog | Information not available in TEJ PIM project. | [_catalog_page_tsx.md](./pages/_catalog_page_tsx.md) |  |  |
| /catalog/products | Products | [_catalog_products_page_tsx.md](./pages/_catalog_products_page_tsx.md) | ApiHttpError, getCategories, getInstalledConnectors, getProducts, getStats |  |
| /channels/connectors/[installationId] | Connector detail page title is dynamic and uses installation display name. | [_channels_connectors__installationid__page_tsx.md](./pages/_channels_connectors__installationid__page_tsx.md) | ApiHttpError, getConnectorPermissions, getInstalledConnectors, getSubmissions |  |
| /channels/connectors | Channel Connectors | [_channels_connectors_page_tsx.md](./pages/_channels_connectors_page_tsx.md) | ApiHttpError, type MarketplaceChannel, getConnectorDefinitions, getInstalledConnectors, getProducts | deleteConnectorInstallationAction, installConnectorAction, reconnectConnectorAction, uninstallConnectorAction |
| /channels/health | Channel Health | [_channels_health_page_tsx.md](./pages/_channels_health_page_tsx.md) | ApiHttpError, getDashboardHealth |  |
| /channels/mappings | Mappings | [_channels_mappings_page_tsx.md](./pages/_channels_mappings_page_tsx.md) | ApiHttpError, type AppRole, type AttributeDefinition, type ConnectorTaxonomyItem, type MarketplaceChannel, evaluateConnectorMappingPreflight, evaluateConnectorPublishReadiness, getCategoryAttributes, getConnectorDefinitions, getConnectorMappingVersions, getCategories, getMarketplaceChannelMapping, getMarketplaceChannels, getUnmappedConnectorTaxonomy, resolveConnectorMapping, searchConnectorTaxonomy | archiveConnectorMappingVersionAction, createConnectorMappingVersionAction, publishConnectorMappingVersionAction, rollbackConnectorMappingVersionAction, validateConnectorMappingVersionAction |
| /channels | Channels | [_channels_page_tsx.md](./pages/_channels_page_tsx.md) | ApiHttpError, getDashboardHealth, getInstalledConnectors, getSubmissions |  |
| /channels/submissions | Submissions | [_channels_submissions_page_tsx.md](./pages/_channels_submissions_page_tsx.md) | ApiHttpError, getSubmissions |  |
| /connectors/[installationId]/mapping | Transition-only route that redirects to the canonical lifecycle mapping workspace. | [_connectors__installationid__mapping_page_tsx.md](./pages/_connectors__installationid__mapping_page_tsx.md) | ApiHttpError, getInstalledConnectors, getProduct | Read-only / redirect only |
| /connectors | Information not available in TEJ PIM project. | [_connectors_page_tsx.md](./pages/_connectors_page_tsx.md) |  |  |
| /consent | Information not available in TEJ PIM project. | [_consent_page_tsx.md](./pages/_consent_page_tsx.md) |  |  |
| /dashboard | Dashboard | [_dashboard_page_tsx.md](./pages/_dashboard_page_tsx.md) | ApiHttpError, getBillingUsage, getBulkImportJobs, getDashboardHealth, getDeadLetterSubmissions, getInstalledConnectors, getStats, getSubmissions |  |
| /internal/developer | Information not available in TEJ PIM project. | [_internal_developer_page_tsx.md](./pages/_internal_developer_page_tsx.md) |  |  |
| /login/locked | Information not available in TEJ PIM project. | [_login_locked_page_tsx.md](./pages/_login_locked_page_tsx.md) |  |  |
| /login | Information not available in TEJ PIM project. | [_login_page_tsx.md](./pages/_login_page_tsx.md) |  |  |
| /login/reset | Information not available in TEJ PIM project. | [_login_reset_page_tsx.md](./pages/_login_reset_page_tsx.md) |  |  |
| /media | Media | [_media_page_tsx.md](./pages/_media_page_tsx.md) | ApiHttpError, AppRole, getMediaAssets, getMediaAssetValidation, MediaAsset, getProducts, MarketplaceChannel | bulkAssociateMediaCsvAction, uploadMediaAssetAction |
| /ondc | Information not available in TEJ PIM project. | [_ondc_page_tsx.md](./pages/_ondc_page_tsx.md) | ApiHttpError, AppRole, getCategories, getOndcMappings, getOndcSimulation, getOndcVersions, getProducts | createOndcMappingAction, runOndcSimulationAction |
| /operations/bulk-edit | Information not available in TEJ PIM project. | [_operations_bulk-edit_page_tsx.md](./pages/_operations_bulk-edit_page_tsx.md) | ApiHttpError, getBulkEditOperations, getBulkEditPreview, getCategories, getProducts | applyBulkEditAction |
| /operations/imports | No import jobs found | [_operations_imports_page_tsx.md](./pages/_operations_imports_page_tsx.md) | ApiHttpError, getBulkImportJobRows, getBulkImportJobs |  |
| /operations/jobs | Jobs | [_operations_jobs_page_tsx.md](./pages/_operations_jobs_page_tsx.md) | ApiHttpError, getDeadLetterSubmissions, getSubmissions |  |
| /operations | Operations | [_operations_page_tsx.md](./pages/_operations_page_tsx.md) | ApiHttpError, getBulkImportJobs, getDeadLetterSubmissions, getSubmissions |  |
| /operations/repair | Repair Center | [_operations_repair_page_tsx.md](./pages/_operations_repair_page_tsx.md) | ApiHttpError, getBulkImportJobs, getDeadLetterSubmissions |  |
| / | Information not available in TEJ PIM project. | [_page_tsx.md](./pages/_page_tsx.md) |  |  |
| /products/[id] | Product detail title is dynamic and uses product title from loaded product data. | [_products__id__page_tsx.md](./pages/_products__id__page_tsx.md) | ApiHttpError, AppRole, evaluateConnectorPublishReadiness, getMarketplaceChannelMapping, getMarketplaceChannels, getMarketplaceExportJobs, getInstalledConnectors, getMarketplaceSimulation, getMarketplaceTemplates, getCategoryAttributes, getProduct, getProductVariants, MarketplaceChannel | createExportJobAction, updateProductAction, createVariantAction, processExportJobAction, requeueExportJobAction, validateProductAction, createMappingTemplateAction (transition-only helper) |
| /quality/approvals | Approval Queue | [_quality_approvals_page_tsx.md](./pages/_quality_approvals_page_tsx.md) | ApiHttpError, type Product, getProducts | transitionProductStatusAction |
| /quality/completeness | Completeness | [_quality_completeness_page_tsx.md](./pages/_quality_completeness_page_tsx.md) | ApiHttpError, getDashboardHealth, getStats |  |
| /quality/issues | Issue Inbox | [_quality_issues_page_tsx.md](./pages/_quality_issues_page_tsx.md) | ApiHttpError, type AppRole, type CatalogStatus, type IssueInboxSeverity, getCategories, getInstalledConnectors, getIssueInbox | resolveIssueInboxWarningsAction |
| /quality | Quality | [_quality_page_tsx.md](./pages/_quality_page_tsx.md) | ApiHttpError, getDashboardHealth, getIssueInbox, getStats |  |
| /quality/validation | Validation | [_quality_validation_page_tsx.md](./pages/_quality_validation_page_tsx.md) | ApiHttpError, getDashboardHealth, getIssueInbox |  |
| /rejection | Rejection Insights | [_rejection_page_tsx.md](./pages/_rejection_page_tsx.md) | ApiHttpError, getDashboardHealth, getProducts, getRejectionIntelligenceScore, MarketplaceChannel |  |
| /reports | Information not available in TEJ PIM project. | [_reports_page_tsx.md](./pages/_reports_page_tsx.md) |  |  |
| /settings/connectors | Information not available in TEJ PIM project. | [_settings_connectors_page_tsx.md](./pages/_settings_connectors_page_tsx.md) |  |  |
| /settings | Information not available in TEJ PIM project. | [_settings_page_tsx.md](./pages/_settings_page_tsx.md) |  |  |
| /settings/plan | Information not available in TEJ PIM project. | [_settings_plan_page_tsx.md](./pages/_settings_plan_page_tsx.md) |  |  |
| /settings/privacy | Information not available in TEJ PIM project. | [_settings_privacy_page_tsx.md](./pages/_settings_privacy_page_tsx.md) |  |  |

