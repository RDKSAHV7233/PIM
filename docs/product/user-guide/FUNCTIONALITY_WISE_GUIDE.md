# TEJ PIM Functionality Runbook (How-To)

This document explains how to perform core workflows across pages.

## 1. Log in and open your workspace
1. Open `/login`.
2. Enter `USER ID` and `PASSWORD` fields.
3. Click `Sign in`.
4. If redirected to `/login/locked` or `/login/reset`, complete unlock/reset flow before retry.

## 2. Create and update products
1. Open `/catalog/products`.
2. Use search/filter controls to locate or triage products.
3. Open product detail `/products/[id]`.
4. In product detail tabs (Overview/Content/Attributes/Variants/Media/Channels/Quality/Activity), edit data and run:
   - `updateProductAction`
   - `validateProductAction`
   - `createVariantAction` (when adding variants)
5. Confirm updated status and quality/readiness feedback on reload.

## 3. Manage taxonomy (categories/attributes)
1. Open `/catalog/categories` to create/manage categories (`createCategoryAction`).
2. Open `/catalog/attributes` to add category attribute definitions (`createAttributeDefinitionAction`).
3. Re-open affected products and fill newly required fields.

## 4. Install and manage channel connectors
1. Open `/channels/connectors`.
2. Install a connector (`installConnectorAction`) with account alias/external ref.
3. Use installed rows to `Reconnect` (`reconnectConnectorAction`) or `Disable` (`uninstallConnectorAction`).
4. For disabled installations, admin can permanently delete (`deleteConnectorInstallationAction`).
5. Open `/channels/connectors/[installationId]` for connector details.
6. If mapping changes are needed, continue to `/channels/mappings` (the canonical lifecycle mapping workspace).

## 5. Build and maintain channel mappings
1. Open `/channels/mappings`.
2. Create a mapping version (`createConnectorMappingVersionAction`).
3. Validate the version (`validateConnectorMappingVersionAction`).
4. Publish the version (`publishConnectorMappingVersionAction`) after step-up re-authentication.
5. Archive or rollback versions when required (`archiveConnectorMappingVersionAction`, `rollbackConnectorMappingVersionAction`).
6. Treat `/connectors/[installationId]/mapping` as a transition-only redirect, not a separate editor.

## 6. Run imports and bulk edits
1. Open `/operations/imports` to monitor import jobs and rows.
2. Open `/operations/bulk-edit`.
3. Set scope filters (category/status/brand/product IDs).
4. Enter JSON updates and click preview.
5. Apply changes via `applyBulkEditAction` from preview panel.
6. Validate operation in history table.

## 7. Manage quality and approvals
1. Open `/quality/issues` for issue inbox.
2. Resolve warnings in bulk using `resolveIssueInboxWarningsAction`.
3. Open `/quality/approvals` to transition status (`transitionProductStatusAction`).
4. Use `/quality/validation`, `/quality/completeness`, and `/rejection` for readiness and rejection insight loops.

## 8. Run channel submission/export jobs
1. From product detail, create export job (`createExportJobAction`).
2. Process queued job (`processExportJobAction`).
3. Requeue failed job (`requeueExportJobAction`) when needed.
4. Use `/channels/mappings` for mapping corrections if publish readiness blocks the product.
5. Track outcomes in `/channels/submissions` and `/operations/jobs`.

## 9. Admin governance workflows
1. Open `/admin/plan` to set plan tier (`setPlanTierAction`).
2. Open `/admin/connectors` to grant/revoke connector permissions (`grantConnectorPermissionAction`, `revokeConnectorPermissionAction`).
3. Use `/admin/users`, `/admin/audit`, `/admin/workspace`, `/admin/privacy` for governance views.

## 10. Media workflows
1. Open `/media` or `/catalog/media`.
2. Upload assets (`uploadMediaAssetAction`).
3. Associate in bulk when needed (`bulkAssociateMediaCsvAction`).
4. Validate media compliance via `getMediaAssetValidation` outputs.

## Full page playbooks
- `/admin/audit` -> [playbook](./playbooks/admin__audit_playbook.md)
- `/admin/connectors` -> [playbook](./playbooks/admin__connectors_playbook.md)
- `/admin` -> [playbook](./playbooks/admin_playbook.md)
- `/admin/plan` -> [playbook](./playbooks/admin__plan_playbook.md)
- `/admin/privacy` -> [playbook](./playbooks/admin__privacy_playbook.md)
- `/admin/users` -> [playbook](./playbooks/admin__users_playbook.md)
- `/admin/workspace` -> [playbook](./playbooks/admin__workspace_playbook.md)
- `/ai` -> [playbook](./playbooks/ai_playbook.md)
- `/catalog/attributes` -> [playbook](./playbooks/catalog__attributes_playbook.md)
- `/catalog/categories` -> [playbook](./playbooks/catalog__categories_playbook.md)
- `/catalog/media` -> [playbook](./playbooks/catalog__media_playbook.md)
- `/catalog` -> [playbook](./playbooks/catalog_playbook.md)
- `/catalog/products` -> [playbook](./playbooks/catalog__products_playbook.md)
- `/channels/connectors/[installationId]` -> [playbook](./playbooks/channels__connectors___installationId__playbook.md)
- `/channels/connectors` -> [playbook](./playbooks/channels__connectors_playbook.md)
- `/channels/health` -> [playbook](./playbooks/channels__health_playbook.md)
- `/channels/mappings` -> [playbook](./playbooks/channels__mappings_playbook.md)
- `/channels` -> [playbook](./playbooks/channels_playbook.md)
- `/channels/submissions` -> [playbook](./playbooks/channels__submissions_playbook.md)
- `/connectors/[installationId]/mapping` -> [playbook](./playbooks/connectors___installationId___mapping_playbook.md)
- `/connectors` -> [playbook](./playbooks/connectors_playbook.md)
- `/consent` -> [playbook](./playbooks/consent_playbook.md)
- `/dashboard` -> [playbook](./playbooks/dashboard_playbook.md)
- `/internal/developer` -> [playbook](./playbooks/internal__developer_playbook.md)
- `/login/locked` -> [playbook](./playbooks/login__locked_playbook.md)
- `/login` -> [playbook](./playbooks/login_playbook.md)
- `/login/reset` -> [playbook](./playbooks/login__reset_playbook.md)
- `/media` -> [playbook](./playbooks/media_playbook.md)
- `/ondc` -> [playbook](./playbooks/ondc_playbook.md)
- `/operations/bulk-edit` -> [playbook](./playbooks/operations__bulk-edit_playbook.md)
- `/operations/imports` -> [playbook](./playbooks/operations__imports_playbook.md)
- `/operations/jobs` -> [playbook](./playbooks/operations__jobs_playbook.md)
- `/operations` -> [playbook](./playbooks/operations_playbook.md)
- `/operations/repair` -> [playbook](./playbooks/operations__repair_playbook.md)
- `/` -> [playbook](./playbooks/root_page_playbook.md)
- `/products/[id]` -> [playbook](./playbooks/products___id__playbook.md)
- `/quality/approvals` -> [playbook](./playbooks/quality__approvals_playbook.md)
- `/quality/completeness` -> [playbook](./playbooks/quality__completeness_playbook.md)
- `/quality/issues` -> [playbook](./playbooks/quality__issues_playbook.md)
- `/quality` -> [playbook](./playbooks/quality_playbook.md)
- `/quality/validation` -> [playbook](./playbooks/quality__validation_playbook.md)
- `/rejection` -> [playbook](./playbooks/rejection_playbook.md)
- `/reports` -> [playbook](./playbooks/reports_playbook.md)
- `/settings/connectors` -> [playbook](./playbooks/settings__connectors_playbook.md)
- `/settings` -> [playbook](./playbooks/settings_playbook.md)
- `/settings/plan` -> [playbook](./playbooks/settings__plan_playbook.md)
- `/settings/privacy` -> [playbook](./playbooks/settings__privacy_playbook.md)
