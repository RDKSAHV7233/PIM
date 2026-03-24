# TEJ PIM Page Action Playbook Index

This index focuses on **how to perform actions** page-by-page.

| Route | Title | Playbook | Actions Available |
|---|---|---|---|
| `/admin/audit` | Audit Logs | [admin__audit_playbook.md](./playbooks/admin__audit_playbook.md) | Read-only / navigation |
| `/admin/connectors` | Connector Access | [admin__connectors_playbook.md](./playbooks/admin__connectors_playbook.md) | `grantConnectorPermissionAction`, `revokeConnectorPermissionAction` |
| `/admin` | Admin | [admin_playbook.md](./playbooks/admin_playbook.md) | Read-only / navigation |
| `/admin/plan` | Plan and Usage | [admin__plan_playbook.md](./playbooks/admin__plan_playbook.md) | `setPlanTierAction` |
| `/admin/privacy` | Information not available in TEJ PIM project. | [admin__privacy_playbook.md](./playbooks/admin__privacy_playbook.md) | Read-only / navigation |
| `/admin/users` | Users & Roles | [admin__users_playbook.md](./playbooks/admin__users_playbook.md) | Live management surface — invite user, change role, lock, unlock, deactivate. Admin role required. |
| `/admin/workspace` | Workspace Settings | [admin__workspace_playbook.md](./playbooks/admin__workspace_playbook.md) | Read-only / navigation |
| `/ai` | AI Optimization | [ai_playbook.md](./playbooks/ai_playbook.md) | `applyAiRepairAction` |
| `/catalog/attributes` | Attributes | [catalog__attributes_playbook.md](./playbooks/catalog__attributes_playbook.md) | `createAttributeDefinitionAction` |
| `/catalog/categories` | Catalog Categories | [catalog__categories_playbook.md](./playbooks/catalog__categories_playbook.md) | `createCategoryAction` |
| `/catalog/media` | Information not available in TEJ PIM project. | [catalog__media_playbook.md](./playbooks/catalog__media_playbook.md) | Read-only / navigation |
| `/catalog` | Information not available in TEJ PIM project. | [catalog_playbook.md](./playbooks/catalog_playbook.md) | Read-only / navigation |
| `/catalog/products` | Products | [catalog__products_playbook.md](./playbooks/catalog__products_playbook.md) | Read-only / navigation |
| `/channels/connectors/[installationId]` | Information not available in TEJ PIM project. | [channels__connectors___installationId__playbook.md](./playbooks/channels__connectors___installationId__playbook.md) | Read-only / navigation |
| `/channels/connectors` | Information not available in TEJ PIM project. | [channels__connectors_playbook.md](./playbooks/channels__connectors_playbook.md) | Read-only / navigation |
| `/channels/health` | Channel Health | [channels__health_playbook.md](./playbooks/channels__health_playbook.md) | Read-only / navigation |
| `/channels/mappings` | Mappings | [channels__mappings_playbook.md](./playbooks/channels__mappings_playbook.md) | `archiveConnectorMappingVersionAction`, `createConnectorMappingVersionAction`, `publishConnectorMappingVersionAction`, `rollbackConnectorMappingVersionAction`, `validateConnectorMappingVersionAction` |
| `/channels` | Channels | [channels_playbook.md](./playbooks/channels_playbook.md) | Read-only / navigation |
| `/channels/submissions` | Submissions | [channels__submissions_playbook.md](./playbooks/channels__submissions_playbook.md) | Read-only / navigation |
| `/connectors/[installationId]/mapping` | Information not available in TEJ PIM project. | [connectors___installationId___mapping_playbook.md](./playbooks/connectors___installationId___mapping_playbook.md) | Read-only / navigation |
| `/connectors` | Channel Connectors | [connectors_playbook.md](./playbooks/connectors_playbook.md) | `deleteConnectorInstallationAction`, `installConnectorAction`, `reconnectConnectorAction`, `uninstallConnectorAction` |
| `/consent` | Information not available in TEJ PIM project. | [consent_playbook.md](./playbooks/consent_playbook.md) | Read-only / navigation |
| `/dashboard` | Dashboard | [dashboard_playbook.md](./playbooks/dashboard_playbook.md) | Read-only / navigation |
| `/internal/developer` | Internal Tools | [internal__developer_playbook.md](./playbooks/internal__developer_playbook.md) | Read-only / navigation |
| `/login/locked` | Information not available in TEJ PIM project. | [login__locked_playbook.md](./playbooks/login__locked_playbook.md) | Read-only / navigation |
| `/login` | Information not available in TEJ PIM project. | [login_playbook.md](./playbooks/login_playbook.md) | Read-only / navigation |
| `/login/reset` | Information not available in TEJ PIM project. | [login__reset_playbook.md](./playbooks/login__reset_playbook.md) | Read-only / navigation |
| `/media` | Media | [media_playbook.md](./playbooks/media_playbook.md) | `bulkAssociateMediaCsvAction`, `uploadMediaAssetAction` |
| `/ondc` | ONDC Expansion | [ondc_playbook.md](./playbooks/ondc_playbook.md) | `createOndcMappingAction`, `runOndcSimulationAction` |
| `/operations/bulk-edit` | Operations Bulk Edit | [operations__bulk-edit_playbook.md](./playbooks/operations__bulk-edit_playbook.md) | `applyBulkEditAction`, `applyAction` |
| `/operations/imports` | Operations Imports | [operations__imports_playbook.md](./playbooks/operations__imports_playbook.md) | Read-only / navigation |
| `/operations/jobs` | Jobs | [operations__jobs_playbook.md](./playbooks/operations__jobs_playbook.md) | Read-only / navigation |
| `/operations` | Operations | [operations_playbook.md](./playbooks/operations_playbook.md) | Read-only / navigation |
| `/operations/repair` | Repair Center | [operations__repair_playbook.md](./playbooks/operations__repair_playbook.md) | Read-only / navigation |
| `/` | Information not available in TEJ PIM project. | [root_page_playbook.md](./playbooks/root_page_playbook.md) | Read-only / navigation |
| `/products/[id]` | No issues found | [products___id__playbook.md](./playbooks/products___id__playbook.md) | `createExportJobAction`, `createMappingTemplateAction`, `updateProductAction`, `createVariantAction`, `processExportJobAction`, `requeueExportJobAction`, `validateProductAction` |
| `/quality/approvals` | Approval Queue | [quality__approvals_playbook.md](./playbooks/quality__approvals_playbook.md) | Read-only / navigation |
| `/quality/completeness` | Completeness | [quality__completeness_playbook.md](./playbooks/quality__completeness_playbook.md) | Read-only / navigation |
| `/quality/issues` | Issue Inbox | [quality__issues_playbook.md](./playbooks/quality__issues_playbook.md) | `resolveIssueInboxWarningsAction` |
| `/quality` | Quality | [quality_playbook.md](./playbooks/quality_playbook.md) | Read-only / navigation |
| `/quality/validation` | Validation | [quality__validation_playbook.md](./playbooks/quality__validation_playbook.md) | Read-only / navigation |
| `/rejection` | Rejection Insights | [rejection_playbook.md](./playbooks/rejection_playbook.md) | Read-only / navigation |
| `/reports` | Information not available in TEJ PIM project. | [reports_playbook.md](./playbooks/reports_playbook.md) | Read-only / navigation |
| `/settings/connectors` | Information not available in TEJ PIM project. | [settings__connectors_playbook.md](./playbooks/settings__connectors_playbook.md) | Read-only / navigation |
| `/settings` | Information not available in TEJ PIM project. | [settings_playbook.md](./playbooks/settings_playbook.md) | Read-only / navigation |
| `/settings/plan` | Information not available in TEJ PIM project. | [settings__plan_playbook.md](./playbooks/settings__plan_playbook.md) | Read-only / navigation |
| `/settings/privacy` | Information not available in TEJ PIM project. | [settings__privacy_playbook.md](./playbooks/settings__privacy_playbook.md) | Read-only / navigation |
