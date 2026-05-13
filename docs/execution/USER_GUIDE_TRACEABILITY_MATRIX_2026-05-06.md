# Vexa PIM User Guide Traceability Matrix

- Date: 2026-05-06
- Basis: current repo state only
- Validation mode: route, component, API, integration-test, and browser-proof audit
- Commercial boundary: controlled paid pilot and early SMB / mid-market sellability only
- Not supported as a claim from this matrix: enterprise-ready

## 1. Claim Boundary

Safe claim from the current repo:

`Vexa PIM is sellable for controlled paid pilot / early SMB-midmarket customers with proven catalog, import, approval, connector, publish, audit, account-security, and recovery workflows. Enterprise readiness remains future-scope.`

## 2. Traceability Matrix

| Capability | Target role | Route / page | Current proof | Status | Sellability score | Sellability impact | Corrected claim wording |
|---|---|---|---|---|---:|---|---|
| 1. Login and account security | Admin, Editor, Reviewer, Viewer | `/login`, `/admin/auth-policy` | [login/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/login/page.tsx), [auth.workspace.spec.js](/C:/Users/Om%20Computers/PIM1/apps/web/test/e2e/auth.workspace.spec.js), [admin-auth-policy-route-contract.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/admin-auth-policy-route-contract.test.cjs) | Partial | 4 | Pilot-safe | Password login, session timeout posture, and stored auth policy are implemented. MFA and OIDC runtime enforcement remain future scope. |
| 2. Dashboard | All authenticated roles | `/dashboard` | [dashboard/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/dashboard/page.tsx), [dashboard-route-contract.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/dashboard-route-contract.test.cjs), [dashboard-priority-drilldown.spec.js](/C:/Users/Om%20Computers/PIM1/apps/web/test/e2e/dashboard-priority-drilldown.spec.js) | Pass | 4 | Pilot-safe | Dashboard is workflow-safe for triage, health, and drill-down. |
| 3. Product creation and editing | Admin, Editor | `/catalog/products`, `/products/[id]` | [products-tab.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/components/product/products-tab.tsx), [products/[id]/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/products/[id]/page.tsx), [product-workbench-ui.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/product-workbench-ui.test.cjs) | Pass | 4 | Pilot-safe | Product creation is inline in the workbench and editing is strong on product detail. |
| 4. Variant management | Admin, Editor, Viewer (read) | `/products/[id]` | [products/[id]/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/products/[id]/page.tsx), [actions.ts](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/actions.ts), [access-policy-remediation.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/api/test/integration/access-policy-remediation.test.cjs) | Partial | 3 | Demo-safe | Variant CRUD and permissions are implemented, but the workflow is more integration-proven than browser-proven. |
| 5. Category and taxonomy management | Admin | `/catalog/categories` | [catalog/categories/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/catalog/categories/page.tsx), [catalog-delete.spec.js](/C:/Users/Om%20Computers/PIM1/apps/web/test/e2e/catalog-delete.spec.js) | Pass | 4 | Pilot-safe | Category management is implemented and delete-state handling is browser-proven. |
| 6. Attribute management | Admin | `/catalog/attributes` | [catalog/attributes/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/catalog/attributes/page.tsx), route-contract coverage in the web suite | Partial | 3 | Demo-safe | Attribute definitions are implemented, but the current evidence is stronger in integration than browser proof. |
| 7. Media management | Admin, Editor | `/catalog/media`, product detail media context | [catalog/media/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/catalog/media/page.tsx), [media-governance-ui.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/media-governance-ui.test.cjs) | Partial | 3 | Demo-safe | Media governance and association flows exist, but the product should not be sold as a DAM replacement. |
| 8. Bulk import | Admin, Editor | `/operations/imports` | [operations/imports/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/operations/imports/page.tsx), [bulk-import-preflight-ui.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/bulk-import-preflight-ui.test.cjs), [bulk-import-staged-workflow-ui.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/bulk-import-staged-workflow-ui.test.cjs), [operations-import-repair.spec.js](/C:/Users/Om%20Computers/PIM1/apps/web/test/e2e/operations-import-repair.spec.js) | Pass | 5 | Production-safe | Validate-before-import, staged import flow, result summary, and repair handoff are implemented and proven. |
| 9. Failed-row repair | Admin, Editor | `/operations/repair` | [operations/repair/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/operations/repair/page.tsx), [operations-repair-route-contract.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/operations-repair-route-contract.test.cjs), [operations-import-repair.spec.js](/C:/Users/Om%20Computers/PIM1/apps/web/test/e2e/operations-import-repair.spec.js) | Pass | 5 | Production-safe | Repair Center is implemented with clear backlog and recovery guidance. |
| 10. Bulk edit | Admin, Editor | `/operations/bulk-edit` | [operations/bulk-edit/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/operations/bulk-edit/page.tsx), [operations-bulk-edit-route-contract.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/operations-bulk-edit-route-contract.test.cjs), [bulk-edit-diff-preview.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/components/bulk-edit/bulk-edit-diff-preview.tsx) | Partial | 4 | Pilot-safe | Structured preview and apply exist, but the advanced diff surface is still best described as operator-safe rather than enterprise batch orchestration. |
| 11. Quality and compliance validation | Admin, Editor, Reviewer, Viewer | `/quality/issues`, `/quality/validation`, product detail quality | [quality/issues/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/quality/issues/page.tsx), [quality-issues-route-contract.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/quality-issues-route-contract.test.cjs), [issue-inbox-ui.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/issue-inbox-ui.test.cjs) | Pass | 4 | Pilot-safe | Validation and issue triage are implemented with grouped impact and fix guidance. |
| 12. Approval and reviewer workflow | Reviewer, Admin, Editor | `/quality/approvals` | [quality/approvals/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/quality/approvals/page.tsx), [approval-evidence-drawer.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/quality/approvals/approval-evidence-drawer.tsx), [approval-evidence-workspace-ui.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/approval-evidence-workspace-ui.test.cjs), [reviewer-approvals.spec.js](/C:/Users/Om%20Computers/PIM1/apps/web/test/e2e/reviewer-approvals.spec.js) | Pass | 5 | Production-safe | Approval queue, revision evidence, reviewer note capture, and blocker-aware decisions are implemented and proven. |
| 13. Publish and export readiness | Admin, Editor | `/products/[id]?tab=channels` | [channels-tab.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/products/[id]/_components/channels-tab.tsx), [publish-export-pilot-proof-ui.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/publish-export-pilot-proof-ui.test.cjs) | Pass | 4 | Pilot-safe | Publish readiness and export summary are implemented with explicit guidance and recovery context. |
| 14. Connector setup and connector health | Admin, Editor, Viewer | `/connectors`, `/connectors/setup`, `/channels/connectors/[installationId]`, `/channels/health` | [connectors/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/connectors/page.tsx), [connectors/setup/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/connectors/setup/page.tsx), [channels/health/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/channels/health/page.tsx), connector honesty and setup tests | Pass | 4 | Pilot-safe | Connector setup, health, and capability honesty are implemented for current supported lanes. |
| 15. Mapping workflow | Admin, Editor | `/channels/mappings` | [channels/mappings/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/channels/mappings/page.tsx), [mapping-workflow-ui.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/mapping-workflow-ui.test.cjs), [channels-mapping-publish.spec.js](/C:/Users/Om%20Computers/PIM1/apps/web/test/e2e/channels-mapping-publish.spec.js) | Pass | 5 | Production-safe | Mapping authoring, validate/publish, and version lifecycle are implemented and browser-proven. |
| 16. Notifications | All authenticated roles | Header notification center | [notification-center.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/components/nav/notification-center.tsx), [notification-center-ui.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/notification-center-ui.test.cjs), [notifications.spec.js](/C:/Users/Om%20Computers/PIM1/apps/web/test/e2e/notifications.spec.js) | Pass | 4 | Pilot-safe | Notification center is implemented for real event follow-up. |
| 17. API keys | Admin | `/admin/api-keys` | [admin/api-keys/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/admin/api-keys/page.tsx), [admin-api-keys-route-contract.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/admin-api-keys-route-contract.test.cjs), [admin-api-keys.spec.js](/C:/Users/Om%20Computers/PIM1/apps/web/test/e2e/admin-api-keys.spec.js) | Pass | 4 | Pilot-safe | Tenant API key governance is implemented for machine access and auditability. |
| 18. Webhooks | Admin | `/admin/webhooks` | [admin/webhooks/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/admin/webhooks/page.tsx), [admin-webhooks-route-contract.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/admin-webhooks-route-contract.test.cjs), [admin-webhooks.spec.js](/C:/Users/Om%20Computers/PIM1/apps/web/test/e2e/admin-webhooks.spec.js) | Pass | 4 | Pilot-safe | Outbound webhook management, test delivery, and delivery visibility are implemented. |
| 19. Audit logs and CSV export | Admin, Editor, Viewer (summary visibility varies by route) | `/admin/audit` | [admin/audit/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/admin/audit/page.tsx), [audit-explorer-ui.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/audit-explorer-ui.test.cjs), [audit-explorer.spec.js](/C:/Users/Om%20Computers/PIM1/apps/web/test/e2e/audit-explorer.spec.js) | Pass | 4 | Pilot-safe | Audit explorer, filters, and CSV export are implemented for governance evidence. |
| 20. Billing, usage, and plan | Admin | `/admin/plan` | [admin/plan/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/admin/plan/page.tsx), admin plan browser tests | Partial | 3 | Demo-safe | Usage visibility and commercial request handling are implemented, but self-serve billing remains out of scope. |
| 21. Users and roles | Admin | `/admin/users` | [admin/users/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/admin/users/page.tsx), [admin-users-route-contract.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/admin-users-route-contract.test.cjs), [admin-users-lifecycle.spec.js](/C:/Users/Om%20Computers/PIM1/apps/web/test/e2e/admin-users-lifecycle.spec.js) | Pass | 4 | Pilot-safe | Workspace user lifecycle and role changes are implemented for four current roles. |
| 22. Role-based permissions | Admin | `/admin/users`, `/admin/connectors` | [role-aware-frontend-alignment-ui.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/role-aware-frontend-alignment-ui.test.cjs), [access-policy-remediation.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/api/test/integration/access-policy-remediation.test.cjs) | Pass | 4 | Pilot-safe | Role and delegated-scope enforcement is implemented, but it is still a bounded four-role model. |
| 23. Vendor / category-manager / product-admin / system-admin behavior | Sales, Ops, Admin | N/A as dedicated shells | [admin/users/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/admin/users/page.tsx) documents delegated scopes and future-scope shells | Future scope | 1 | Not sellable yet | Do not claim dedicated vendor, category-manager, product-admin, or system-admin shells. Current model is admin, editor, reviewer, viewer plus delegated scopes. |
| 24. Account deletion and privacy export | Admin and account owner contexts | `/admin/privacy`, `/settings/privacy` | [admin/privacy/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/admin/privacy/page.tsx), [admin-privacy-export.spec.js](/C:/Users/Om%20Computers/PIM1/apps/web/test/e2e/admin-privacy-export.spec.js) | Pass | 4 | Pilot-safe | Privacy export and deletion request workflows are implemented and tested. |
| 25. MFA and advanced account security | Admin | `/admin/auth-policy` | [admin/auth-policy/page.tsx](/C:/Users/Om%20Computers/PIM1/apps/web/src/app/admin/auth-policy/page.tsx), [admin-auth-policy-route-contract.test.cjs](/C:/Users/Om%20Computers/PIM1/apps/web/test/integration/admin-auth-policy-route-contract.test.cjs) | Partial | 2 | Not sellable yet as a hardened security claim | MFA and OIDC posture can be stored and audited, but runtime enforcement is not fully active yet. |

## 3. Claims Safe For Sales And Demo

- Multi-tenant catalog operations workspace with dashboard, product workbench, quality review, mapping, connector setup, publish/export follow-up, jobs recovery, and admin governance.
- Validate-before-import workflow with staged summary, import result visibility, and failed-row repair.
- Evidence-based approval queue with reviewer note capture and revision-aware before/after context.
- Honest connector posture for Amazon India, Flipkart, Shopify, and Meesho export-only support.
- Audit logs, outbound webhooks, API keys, and role-based governance are implemented.
- Responsive core workflows and keyboard shell navigation are browser-proven.

## 4. Claims To Remove Or Soften

- `enterprise-ready`
- `production-ready for all customer segments`
- `self-serve billing`
- `full MFA enforcement`
- `dedicated vendor / category-manager / product-admin / system-admin shells`
- `WooCommerce implemented` or any live-connector implication not backed by the current UI and connector tests
- `full DAM replacement`

## 5. Top UX Gaps That Still Reduce Sellability

1. Some advanced operational surfaces remain stronger in integration proof than broad browser proof, especially variants and some admin detail flows.
2. Billing and commercial ops are implemented as controlled-admin workflows, not a self-serve commercial SaaS lane.
3. MFA / OIDC posture is honest but still stored-and-audited more than fully enforced.

## 6. Top Documentation Gaps That Reduced Trust Before This Refresh

1. Public-facing release posture still implied production-readiness more broadly than the current commercial target.
2. The master user guide still described only three technical roles and understated the approval workspace.
3. Audit explorer and CSV export were under-described in the older guide.

## 7. Final Verdict

- Sellable today: Yes
- Sellable to: controlled paid pilot and early SMB / mid-market customers with bounded governance expectations
- Not safe to claim yet: enterprise readiness, self-serve billing, or fully enforced MFA / OIDC
- Best commercial wording: `Vexa PIM is sellable for controlled paid pilot / early SMB-midmarket customers with proven catalog, import, approval, connector, publish, audit, account-security, and recovery workflows. Enterprise readiness remains future-scope.`
