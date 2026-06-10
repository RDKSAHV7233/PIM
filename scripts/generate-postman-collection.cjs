#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const spec = require("../docs/openapi.json");

const EXAMPLES = {
  LoginDto: { workspaceSlug: "vexa-demo", userId: "admin@example.com", password: "your-password", expiresInMinutes: 60 },
  ResendUnlockDto: { email: "user@example.com", workspaceSlug: "vexa-demo" },
  RequestPasswordResetDto: { email: "user@example.com" },
  ConfirmPasswordResetDto: { token: "reset-token-from-email", password: "NewSecureP@ss1" },
  RecordConsentDto: { accepted: true, policyVersion: "1.0", purpose: "data_processing" },
  RequestAccountExportDto: { format: "json" },
  DeleteAccountDto: { confirmation: "DELETE", reason: "No longer needed" },
  StepUpChallengeDto: { password: "your-password", scope: "mapping:high-risk" },
  UpdateAuthPolicyDto: { externalIdentityMode: false, mfaRequired: true, mfaGracePeriodDays: 14, sessionTimeoutMinutes: 60, allowedAuthMethods: ["password"] },
  SubmitMfaCodeDto: { code: "123456" },
  UpsertOidcConfigDto: { issuer: "https://login.example.com", clientId: "vexa-pim", clientSecret: "oidc-client-secret", callbackUrl: "https://app.vexa.io/api/v1/auth/oidc/callback", scopes: ["openid", "profile", "email"] },
  UpdateBillingContactDto: { billingContactEmail: "billing@example.com" },
  CreatePlanUpgradeRequestDto: { notes: "We need more users and submission capacity.", source: "admin_plan" },
  CreateCategoryDto: { name: "Electronics", parentId: null, attributes: {} },
  UpdateCategoryDto: { name: "Electronics (Updated)" },
  CreateAttributeDefinitionDto: { name: "Color", slug: "color", type: "enum", options: ["Red", "Blue", "Green"], required: true },
  UpdateAttributeDefinitionDto: { name: "Color (Updated)", required: false },
  CreateComplianceRuleDto: { ruleCode: "REQ_TITLE", name: "Title is required", categoryId: "cat_id", severity: "error", ruleType: "required_field", config: { field: "title" }, active: true },
  UpdateComplianceRuleDto: { name: "Title is required (updated)", severity: "error", ruleType: "required_field", config: { field: "title" }, active: true },
  ResolveIssueInboxDto: { issueIds: ["issue_1", "issue_2"] },
  InstallConnectorDto: { accountAlias: "My Shopify Store", shopDomain: "my-store.myshopify.com" },
  ConfigureConnectorDto: { marketplaceId: "A21TJRUUN4KGV", defaultProductType: "SHIRT" },
  UpdatePublicationTargetsDto: { targets: ["web", "pos"] },
  ConnectorPayloadPreviewDto: { productId: "prod_abc123" },
  GrantConnectorPermissionDto: { principalType: "user", principalId: "user_123", connectorSlug: "shopify", action: "install" },
  CreateConnectorMappingVersionDto: { mappings: {}, notes: "Initial version" },
  PublishConnectorMappingVersionDto: { notes: "Publishing v1" },
  RollbackConnectorMappingVersionDto: { reason: "Mapping errors detected" },
  ArchiveConnectorMappingVersionDto: { reason: "Superseded by v2" },
  ConnectorMappingPreflightDto: { productIds: ["prod_1", "prod_2"] },
  ConnectorPublishReadinessDto: { productIds: ["prod_1"] },
  CreateMappingTemplateDto: { name: "Default Template", mappings: {} },
  UpdateMappingTemplateDto: { name: "Updated Template", mappings: {} },
  CloneMappingTemplateDto: { name: "Clone of Template" },
  SimulateMarketplaceDto: { priceListId: "pl_123" },
  BatchMarketplaceReadinessDto: { productIds: ["prod_1", "prod_2"] },
  CreateExportJobDto: { installationId: "inst_123", productIds: ["prod_1"] },
  CreateExportJobAliasDto: { installationId: "inst_123", productIds: ["prod_1"] },
  RetryRecoveryGroupDto: { groupKey: "group_abc" },
  UpsertScheduleDto: { cronExpression: "0 */6 * * *", enabled: true },
  TriggerBulkPublishDto: { productIds: ["prod_1", "prod_2"] },
  ConfirmCatalogLinksDto: { links: [{ pimProductId: "prod_1", shopifyProductGid: "gid://shopify/Product/123" }] },
  CreateOutboundWebhookDto: { url: "https://hooks.example.com/vexa", events: ["product.created", "product.updated"], active: true },
  UpdateOutboundWebhookDto: { url: "https://hooks.example.com/vexa-v2", active: true },
  CreateBulkImportJobDto: { categoryId: "cat_electronics", sourceFormat: "csv", sourceName: "products.csv", csvContent: "title,brand,description\nWidget,Acme,A cool widget", chunkSize: 100 },
  ImportValidateDto: { categoryId: "cat_electronics", fileName: "products.csv", fileSize: 10240, mimeType: "text/csv" },
  CreateBulkImportTemplateDto: { name: "Electronics Template", mapping: { Title: "title", Brand: "brand" } },
  SuggestMappingDto: { headers: ["Product Name", "Brand Name", "Price"] },
  ProcessBulkImportJobDto: { dryRun: false },
  RequeueDlqDto: { rowIds: ["row_1", "row_2"] },
  RepairBulkImportRowDto: { data: { title: "Fixed Widget", brand: "Acme" } },
  CreateBulkImportRunJsonDto: { categoryId: "cat_electronics", rows: [{ title: "Widget", brand: "Acme", description: "Cool widget" }] },
  CreateBulkImportRunDto: { categoryId: "cat_electronics" },
  BulkEditPreviewDto: { scope: { categoryId: "cat_electronics", status: "draft" }, updates: { brand: "Updated Brand" } },
  BulkEditApplyDto: { scope: { categoryId: "cat_electronics", status: "draft" }, updates: { brand: "Updated Brand" } },
  CreateProductDto: {
    title: "Wireless Headphones",
    description: "Premium noise-cancelling wireless headphones",
    brand: "AudioTech",
    categoryId: "cat_electronics",
    hsnCode: "85183000",
    gstRate: 18,
    attributes: { color: "Black", weight: "250g" },
    status: "draft",
    taxCodes: [{ regimeKey: "IN", key: "HSN", value: "85183000", rate: 18 }],
  },
  UpdateProductDto: {
    expectedVersion: 1,
    title: "Wireless Headphones Pro",
    description: "Premium noise-cancelling wireless headphones (updated)",
    brand: "AudioTech",
    categoryId: "cat_electronics",
    hsnCode: "85183000",
    gstRate: 18,
    attributes: { color: "Black", weight: "250g" },
    status: "active",
  },
  DecideProductReviewDto: { status: "approved", note: "Meets all quality standards" },
  CreateApprovalCommentDto: { body: "Please update the product description to include warranty info." },
  AssignProductDto: { assigneeId: "user_editor_1" },
  RequestChangesDto: { reason: "Brand name does not match catalogue entry" },
  CreateVariantDto: { skuCode: "WH-PRO-BLK-001", attributes: { size: "One Size", color: "Black" }, mrp: 4999, sellingPrice: 3499, inventoryQty: 150, status: "active" },
  UpdateVariantDto: { skuCode: "WH-PRO-BLK-001", attributes: { size: "One Size", color: "Black" }, mrp: 4999, sellingPrice: 2999, inventoryQty: 200, status: "active" },
  CreateProductRelationshipDto: { targetProductId: "prod_accessory_1", type: "ACCESSORY", sortOrder: 0 },
  CreateMediaAssetDto: { productId: "prod_abc123", fileName: "headphones-front.jpg", mimeType: "image/jpeg", contentBase64: "<base64-encoded-image>", altText: "Front view", isMain: true, sortOrder: 0 },
  UpdateMediaAssetGovernanceDto: { altText: "Updated front view", isMain: true, sortOrder: 0, channelEligibility: ["shopify", "amazon"] },
  BulkMediaAssociationDto: { rows: [{ skuCode: "WH-PRO-BLK-001", imageUrl: "https://cdn.example.com/headphones.jpg" }] },
  CreatePlatformTenantDto: { tenantKey: "new-tenant", displayName: "New Tenant Inc." },
  CreateMarketDto: { code: "IN", locale: "en-IN", displayName: "India", isDefault: true, status: "active" },
  UpdateMarketDto: { displayName: "India (Updated)", status: "active" },
  CreateCurrencyDto: { code: "INR", symbol: "₹", displayName: "Indian Rupee", decimalPlaces: 2 },
  UpdateCurrencyDto: { symbol: "₹", displayName: "Indian Rupee", decimalPlaces: 2 },
  CreatePriceListDto: { name: "India Default Price List", marketId: "mkt_india", currencyId: "cur_inr", isDefault: true, status: "active" },
  UpdatePriceListDto: { name: "India Default Price List (Updated)", isDefault: true, status: "active" },
  UpsertProductPricesDto: { prices: [{ variantId: "var_abc123", mrp: 4999, sellingPrice: 3499 }] },
  CreatePublicSignupDto: { displayName: "Acme Corp", workspaceSlug: "acme-corp", adminEmail: "admin@acme.com", password: "SecureP@ss123", acceptedTerms: true },
  VerifyPublicSignupDto: { token: "verification-token-from-email" },
  ResendPublicSignupVerificationDto: { adminEmail: "admin@acme.com" },
  CreateWorkspaceUserDto: { userId: "newuser@example.com", role: "editor", assignedRoles: ["editor"] },
  UpdateWorkspaceUserRoleDto: { role: "admin", assignedRoles: ["admin", "product_admin"] },
  LockWorkspaceUserDto: { durationMinutes: 60, reason: "Suspicious activity detected" },
  SetUserPasswordDto: { password: "NewSecureP@ss1" },
  CreateAccessScopeAssignmentDto: { subjectType: "user", subjectId: "user_123", scopeType: "category", categoryId: "cat_electronics", actions: ["view", "edit", "create"] },
  CreateApiKeyDto: { label: "CI/CD Pipeline Key", role: "editor", expiresAt: "2027-01-01T00:00:00.000Z", scopes: ["catalog.read", "catalog.write"] },
};

const TAG_DESC = {
  System: "Health checks, metrics, and queue diagnostics",
  ApiKeys: "API key lifecycle -- create, list, revoke",
  Audit: "Audit logs and event exports",
  Auth: "Authentication -- login, MFA, password reset, consent, account export/deletion",
  AuthPolicy: "Tenant-level auth policy configuration",
  Mfa: "Multi-factor authentication enrollment and verification",
  Oidc: "OpenID Connect SSO configuration",
  Billing: "Plan usage, profiles, billing contacts, and upgrade requests",
  Taxonomy: "Categories and attribute definitions",
  Compliance: "Compliance rules, product validation, and issue inbox",
  Dashboard: "Dashboard readiness, catalog health, and operations summaries",
  Metrics: "KPI trend time-series",
  ConnectorWebhookRelay: "Inbound connector webhook relay",
  Connectors: "Connector installation, configuration, and permissions",
  Marketplace: "Channel mappings, templates, export jobs, sync, scheduling, and Shopify integration",
  Submissions: "Channel submission tracking and retries",
  Notifications: "In-app notification feed",
  Webhooks: "Outbound webhook management",
  BulkImport: "Bulk import jobs, validation, templates, and runs",
  BulkEdit: "Bulk edit preview and apply",
  Catalog: "Product CRUD, variants, relationships, reviews, and workflow SLA",
  Products: "Product read API (public / API-key)",
  Media: "Media asset upload, governance, and bulk association",
  Platform: "Platform tenant provisioning",
  Pricing: "Markets, currencies, price lists, and product pricing",
  RejectionIntelligence: "AI-powered rejection score",
  Signup: "Public self-service workspace signup",
  WorkspaceUsers: "Workspace user management -- create, roles, lock/unlock, deactivate",
  AutoSuggestions: "AI-powered product suggestions -- title, attributes, category, repair",
};

const TAG_ORDER = [
  "System", "Auth", "AuthPolicy", "Mfa", "Oidc", "Signup",
  "Billing", "WorkspaceUsers", "ApiKeys",
  "Catalog", "Products", "Media", "Taxonomy", "Compliance",
  "Connectors", "Marketplace", "ConnectorWebhookRelay", "Submissions",
  "BulkImport", "BulkEdit", "Pricing",
  "Dashboard", "Metrics", "Notifications", "Webhooks",
  "Audit", "Platform", "RejectionIntelligence", "AutoSuggestions",
];

const NO_AUTH_PATTERNS = [
  "/api/v1/health",
  "/api/v1/auth/login",
  "/api/v1/auth/password-reset/request",
  "/api/v1/auth/password-reset/confirm",
  "/api/v1/auth/resend-unlock",
  "/api/v1/signup/workspace/availability",
  "/api/v1/signup/workspace",
  "/api/v1/signup/verify",
  "/api/v1/signup/resend-verification",
  "/api/v1/auth/oidc/login",
  "/api/v1/auth/oidc/callback",
];

// ── Human-readable names for operationIds that lack @ApiOperation summary ──
const NAME_OVERRIDES = {
  AuthController_login: "Login",
  AuthController_refresh: "Refresh token",
  AuthController_resendUnlock: "Resend unlock email",
  AuthController_requestPasswordReset: "Request password reset",
  AuthController_confirmPasswordReset: "Confirm password reset",
  AuthController_recordConsent: "Record consent",
  AuthController_getPrivacyStatus: "Get privacy status",
  AuthController_requestAccountExport: "Request account export",
  AuthController_downloadAccountExport: "Download account export",
  AuthController_deleteAccount: "Delete account",
  AuthController_logout: "Logout",
  AuthController_issueStepUp: "Issue step-up challenge",
  AuthPolicyController_getPolicy: "Get auth policy",
  AuthPolicyController_updatePolicy: "Update auth policy",
  MfaController_getStatus: "Get MFA status",
  MfaController_requestEnrollmentToken: "Request MFA enrollment token",
  MfaController_beginEnrollment: "Begin MFA enrollment",
  MfaController_verifyEnrollment: "Verify MFA enrollment",
  MfaController_verifyLogin: "Verify MFA login code",
  MfaController_regenerateBackupCodes: "Regenerate MFA backup codes",
  OidcController_upsertConfig: "Upsert OIDC config",
  OidcController_getConfig: "Get OIDC config",
  OidcController_deleteConfig: "Delete OIDC config",
  OidcController_login: "OIDC login redirect",
  OidcController_callback: "OIDC callback",
  WorkspaceUsersController_listUsers: "List workspace users",
  WorkspaceUsersController_createUser: "Create workspace user",
  WorkspaceUsersController_getRoleCapabilities: "Get role capabilities",
  WorkspaceUsersController_updateUserRole: "Update user role",
  WorkspaceUsersController_lockUser: "Lock user",
  WorkspaceUsersController_unlockUser: "Unlock user",
  WorkspaceUsersController_deactivateUser: "Deactivate user",
  WorkspaceUsersController_setUserPassword: "Set user password",
  ApiKeysController_listKeys: "List API keys",
  ApiKeysController_createKey: "Create API key",
  ApiKeysController_revokeKey: "Revoke API key",
  CatalogController_stats: "Get catalog stats",
  CatalogController_deleteProduct: "Delete product",
  CatalogController_purgeProduct: "Purge product (hard delete)",
  CatalogController_listVariants: "List variants",
  CatalogController_createVariant: "Create variant",
  CatalogController_updateVariant: "Update variant",
  CatalogController_deleteVariant: "Delete variant",
  CatalogController_listRelationships: "List product relationships",
  CatalogController_createRelationship: "Create product relationship",
  CatalogController_deleteRelationship: "Delete product relationship",
  CatalogController_listRevisions: "List product revisions",
  CatalogController_getActivity: "Get product activity log",
  CatalogController_assignProduct: "Assign product to user",
  CatalogController_createChangeRequest: "Request changes on product",
  CatalogController_resolveChangeRequest: "Resolve change request",
  AuditController_listLogs: "List audit logs",
  AuditController_listEvents: "List audit events",
  AuditController_exportEvents: "Export audit events",
  TaxonomyController_listCategories: "List categories",
  TaxonomyController_createCategory: "Create category",
  TaxonomyController_getCategory: "Get category",
  TaxonomyController_updateCategory: "Update category",
  TaxonomyController_deleteCategory: "Delete category",
  TaxonomyController_listAttributeDefinitions: "List attribute definitions",
  TaxonomyController_createAttributeDefinition: "Create attribute definition",
  TaxonomyController_updateAttributeDefinition: "Update attribute definition",
  TaxonomyController_deleteAttributeDefinition: "Delete attribute definition",
  ComplianceController_listRules: "List compliance rules",
  ComplianceController_createRule: "Create compliance rule",
  ComplianceController_updateRule: "Update compliance rule",
  ComplianceController_deleteRule: "Delete compliance rule",
  ComplianceController_validateProduct: "Validate product compliance",
  ComplianceController_getProductIssues: "Get product compliance issues",
  ConnectorInstallerController_listDefinitions: "List connector definitions",
  ConnectorInstallerController_listInstalled: "List installed connectors",
  ConnectorInstallerController_uninstall: "Uninstall connector (by id)",
  ConnectorInstallerController_uninstallBySlugAndId: "Uninstall connector (by slug + id)",
  ConnectorInstallerController_reconnect: "Reconnect connector",
  ConnectorInstallerController_configure: "Configure connector",
  ConnectorInstallerController_getOAuthCallback: "Connector OAuth callback",
  ConnectorInstallerController_getProductTypeSchema: "Get product type schema",
  ConnectorInstallerController_getPublications: "Get connector publications",
  ConnectorInstallerController_getPublicationTargets: "Get publication targets",
  ConnectorInstallerController_updatePublicationTargets: "Update publication targets",
  MarketplaceController_previewShopifyProductChanges: "Preview Shopify product changes",
  MarketplaceController_queueDeltaSync: "Queue Shopify delta sync",
  MarketplaceController_queueConnectorDeltaSync: "Queue connector delta sync",
  MarketplaceController_importShopifyConfig: "Import Shopify config",
  MarketplaceController_scanCatalogLinks: "Scan Shopify catalog links",
  SubmissionsController_getSubmission: "Get submission",
  SubmissionsController_listSubmissions: "List submissions",
  SubmissionsController_listDeadLetter: "List dead-letter submissions",
  SubmissionsController_getSubmissionIssues: "Get submission issues",
  SubmissionsController_syncSubmission: "Sync submission from provider",
  SubmissionsController_retrySubmission: "Retry submission",
  NotificationsController_list: "List notifications",
  NotificationsController_markRead: "Mark notification read",
  NotificationsController_markAllRead: "Mark all notifications read",
  BulkImportController_listJobs: "List import jobs",
  BulkImportController_getJob: "Get import job",
  BulkImportController_getJobRows: "Get import job rows",
  BulkImportController_getJobErrorReport: "Get import job error report",
  BulkImportController_validateJob: "Validate import job",
  BulkImportController_processJob: "Process import job",
  BulkImportController_requeueDlq: "Requeue DLQ rows",
  BulkImportController_processRow: "Process single import row",
  BulkImportController_repairRow: "Repair import row",
  BulkImportController_listRuns: "List import runs",
  BulkImportController_getRun: "Get import run",
  BulkImportController_validateRun: "Validate import run",
  BulkImportController_startRun: "Start import run",
  BulkImportController_getRunRows: "Get import run rows",
  BulkImportController_getRunErrorReport: "Get import run error report",
  BulkImportController_listTemplates: "List import templates",
  BulkImportController_getTemplate: "Get import template",
  ProductsController_listProducts: "List products (API key)",
  ProductsController_getProduct: "Get product (API key)",
  ProductsController_listProductRevisions: "List product revisions (API key)",
  MediaController_listAssets: "List media assets",
  MediaController_getAsset: "Get media asset",
  MediaController_deleteAsset: "Delete media asset",
  RejectionIntelligenceController_getScore: "Get rejection score",
  AutoSuggestionsController_getTitleSuggestion: "Get title suggestion",
  AutoSuggestionsController_getAttributeEnrichment: "Get attribute enrichment",
  AutoSuggestionsController_getCategorySuggestion: "Get category suggestion",
  AutoSuggestionsController_applyRepair: "Apply AI repair",
  PricingController_listMarkets: "List markets",
  PricingController_getMarket: "Get market",
  PricingController_listCurrencies: "List currencies",
  PricingController_getCurrency: "Get currency",
  PricingController_listPriceLists: "List price lists",
  PricingController_getPriceList: "Get price list",
  PricingController_listPrices: "List prices in price list",
  PricingController_downloadPriceTemplate: "Download price template CSV",
  PricingController_importPrices: "Import prices from CSV",
  PricingController_getCoverage: "Get pricing coverage",
  OutboundWebhooksController_list: "List outbound webhooks",
  OutboundWebhooksController_getDeliveries: "List webhook deliveries",
  OutboundWebhooksController_get: "Get outbound webhook",
  OutboundWebhooksController_update: "Update outbound webhook",
  OutboundWebhooksController_delete: "Delete outbound webhook",
  OutboundWebhooksController_sendTestDelivery: "Send test webhook delivery",
  SignupController_checkAvailability: "Check workspace availability",
  SignupController_createSignup: "Create public signup",
  SignupController_verifySignup: "Verify public signup",
  SignupController_resendVerification: "Resend verification email",
  WorkspaceAccessScopesController_list: "List access scope assignments",
  WorkspaceAccessScopesController_create: "Create access scope assignment",
  WorkspaceAccessScopesController_delete: "Delete access scope assignment",
  ConnectorWebhookRelayController_relayWebhook: "Relay inbound connector webhook",
  MediaController_createAsset: "Upload media asset",
  MediaController_validateAsset: "Validate media asset",
  MediaController_updateGovernance: "Update media governance",
  MediaController_bulkAssociate: "Bulk associate media to SKUs",
  ConnectorInstallerController_listPermissions: "List connector permissions",
  ConnectorInstallerController_grantPermission: "Grant connector permission",
  ConnectorInstallerController_revokePermission: "Revoke connector permission",
  MarketplaceController_listChannels: "List marketplace channels",
  MarketplaceController_listConnectorMappingVersions: "List mapping versions",
  MarketplaceController_createConnectorMappingVersion: "Create mapping version",
  MarketplaceController_validateConnectorMappingVersion: "Validate mapping version",
  MarketplaceController_publishConnectorMappingVersion: "Publish mapping version",
  MarketplaceController_rollbackConnectorMappingVersion: "Rollback mapping version",
  MarketplaceController_archiveConnectorMappingVersion: "Archive mapping version",
  MarketplaceController_resolveConnectorMapping: "Resolve connector mapping",
  MarketplaceController_preflightConnectorMapping: "Preflight connector mapping",
  MarketplaceController_searchConnectorTaxonomy: "Search connector taxonomy",
  MarketplaceController_listUnmappedConnectorTaxonomy: "List unmapped connector taxonomy",
  MarketplaceController_evaluateConnectorPublishReadiness: "Evaluate publish readiness",
  MarketplaceController_getChannelMapping: "Get channel mapping",
  MarketplaceController_listTemplates: "List mapping templates",
  MarketplaceController_createTemplate: "Create mapping template",
  MarketplaceController_getTemplate: "Get mapping template",
  MarketplaceController_updateTemplate: "Update mapping template",
  MarketplaceController_deleteTemplate: "Delete mapping template",
  MarketplaceController_cloneTemplate: "Clone mapping template",
  MarketplaceController_simulateProductQuery: "Simulate product (GET)",
  MarketplaceController_simulateProductBody: "Simulate product (POST)",
  MarketplaceController_batchReadiness: "Batch readiness check",
  MarketplaceController_getExportJob: "Get export job",
  MarketplaceController_processExportJob: "Process export job",
  MarketplaceController_requeueExportJob: "Requeue export job",
  MarketplaceController_getRecoveryGroups: "List Shopify recovery groups",
  MarketplaceController_retryRecoveryGroup: "Retry Shopify recovery group",
  MarketplaceController_previewShopifyProductChanges: "Preview Shopify product changes",
  MarketplaceController_getDeltaSyncCandidates: "Get Shopify delta sync candidates",
  MarketplaceController_getShopifyDeltaSyncStatus: "Get Shopify delta sync status",
  MarketplaceController_queueDeltaSync: "Queue Shopify delta sync",
  MarketplaceController_getSyncStates: "Get Shopify sync states",
  MarketplaceController_getSchedule: "Get Shopify sync schedule",
  MarketplaceController_upsertSchedule: "Upsert Shopify sync schedule",
  MarketplaceController_deleteSchedule: "Delete Shopify sync schedule",
  MarketplaceController_getConnectorDeltaSyncCandidates: "Get connector delta sync candidates",
  MarketplaceController_getConnectorDeltaSyncStatus: "Get connector delta sync status",
  MarketplaceController_queueConnectorDeltaSync: "Queue connector delta sync",
  MarketplaceController_getConnectorSyncStates: "Get connector sync states",
  MarketplaceController_getConnectorSchedule: "Get connector sync schedule",
  MarketplaceController_upsertConnectorSchedule: "Upsert connector sync schedule",
  MarketplaceController_deleteConnectorSchedule: "Delete connector sync schedule",
  MarketplaceController_triggerBulkPublish: "Trigger bulk publish",
  MarketplaceController_importShopifyConfig: "Import Shopify config",
  MarketplaceController_getShopifyConfig: "Get Shopify config",
  MarketplaceController_scanCatalogLinks: "Scan Shopify catalog links",
  MarketplaceController_getProductLinks: "Get Shopify product links",
  MarketplaceController_confirmCatalogLinks: "Confirm Shopify catalog links",
  BulkImportController_validateJobInput: "Validate import input (preflight)",
  BulkImportController_createJob: "Create import job",
  BulkImportController_validateImport: "Validate import file",
  BulkImportController_createTemplate: "Create import template",
  BulkImportController_suggestMapping: "Get mapping suggestions",
  BulkImportController_listRows: "List import job rows",
  BulkImportController_getErrorReport: "Get import error report",
  BulkImportController_createRunFromJson: "Create import run (JSON)",
  BulkImportController_uploadRun: "Upload import run (file)",
  BulkImportController_listRunRows: "List import run rows",
  BulkEditController_preview: "Preview bulk edit",
  BulkEditController_apply: "Apply bulk edit",
  BulkEditController_listOperations: "List bulk edit operations",
  BulkEditController_getOperation: "Get bulk edit operation",
  NotificationsController_listNotifications: "List notifications",
  RejectionIntelligenceController_scoreProduct: "Score product rejection risk",
  OutboundWebhooksController_listEndpoints: "List webhook endpoints",
  OutboundWebhooksController_createEndpoint: "Create webhook endpoint",
  OutboundWebhooksController_listDeliveries: "List webhook deliveries",
  OutboundWebhooksController_updateEndpoint: "Update webhook endpoint",
  OutboundWebhooksController_deleteEndpoint: "Delete webhook endpoint",
  PlatformAdminController_createTenant: "Create platform tenant",
  WorkspaceAccessScopesController_listAccessScopes: "List access scope assignments",
  WorkspaceAccessScopesController_createAccessScope: "Create access scope assignment",
  WorkspaceAccessScopesController_deleteAccessScope: "Delete access scope assignment",
};

// ── Inline bodies for endpoints that use inline @Body() types (not DTO refs) ──
const INLINE_BODIES = {
  "PUT /api/v1/catalog/workflow/sla": { reviewTargetDays: 3 },
  "POST /api/v1/auto-suggestions/products/{id}/repair": { apply: true },
};

// ── Multipart file-upload endpoints (use form-data, not raw JSON) ──
const MULTIPART_ENDPOINTS = {
  "POST /api/v1/bulk-import/runs/upload": [
    { key: "categoryId", value: "cat_electronics", type: "text", description: "Category ID" },
    { key: "sourceFile", type: "file", description: "CSV or JSON file to import (max 32 MB)" },
  ],
  "POST /api/v1/pricing/price-lists/{id}/prices/import": [
    { key: "file", type: "file", description: "CSV file with variant_sku, mrp, selling_price columns (max 10 MB)" },
  ],
};

// ── Collection shell ──
const collection = {
  info: {
    name: "Vexa PIM API",
    description:
      "Complete Vexa PIM API collection -- auto-generated from OpenAPI spec with example request bodies derived from actual DTO source code.\n\n" +
      "**Auth:** Most endpoints require a Bearer JWT token. Use the Auth > Login request first, then the {{access_token}} variable is set automatically.\n\n" +
      "**Base URL:** Set {{base_url}} to your environment (e.g. http://localhost:3001 or https://staging.vexa.io).\n\n" +
      "**Roles:** admin | editor | publisher | approver | channel_manager | connector_admin | reviewer | viewer\n\n" +
      "Generated: 2026-06-10",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  auth: {
    type: "bearer",
    bearer: [{ key: "token", value: "{{access_token}}", type: "string" }],
  },
  variable: [
    { key: "base_url", value: "http://localhost:3001", description: "API base URL" },
    { key: "access_token", value: "", description: "JWT access token (auto-set by Login request)" },
  ],
  event: [
    {
      listen: "test",
      script: {
        type: "text/javascript",
        exec: [
          '// Auto-capture token from login response',
          'if ((pm.info.requestName === "Login" || pm.info.requestName === "AuthController_login") && pm.response.code === 201) {',
          "  const body = pm.response.json();",
          '  if (body.accessToken) {',
          '    pm.collectionVariables.set("access_token", body.accessToken);',
          '    console.log("Access token saved to collection variable.");',
          "  }",
          "}",
        ],
      },
    },
  ],
  item: [],
};

// ── Group paths by tag ──
const folders = {};
for (const [urlPath, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    const tag = (op.tags && op.tags[0]) || "Other";
    if (!folders[tag]) folders[tag] = [];
    folders[tag].push({ path: urlPath, method: method.toUpperCase(), op });
  }
}

// ── Build folders in defined order ──
const orderedTags = [...TAG_ORDER, ...Object.keys(folders).filter((t) => !TAG_ORDER.includes(t))];

for (const tag of orderedTags) {
  const endpoints = folders[tag];
  if (!endpoints) continue;

  const folder = {
    name: tag,
    description: TAG_DESC[tag] || "",
    item: [],
  };

  for (const { path: urlPath, method, op } of endpoints) {
    const opId = op.operationId || "";
    const name = op.summary || NAME_OVERRIDES[opId] || opId || `${method} ${urlPath}`;
    const routeKey = `${method} ${urlPath}`;

    // URL segments
    const pathSegments = urlPath
      .replace(/^\//, "")
      .split("/")
      .map((seg) => (seg.startsWith("{") && seg.endsWith("}") ? ":" + seg.slice(1, -1) : seg));

    // Query params
    const queryParams = (op.parameters || [])
      .filter((p) => p.in === "query")
      .map((p) => ({
        key: p.name,
        value: "",
        description: p.description || (p.required ? "(required)" : "(optional)"),
        disabled: !p.required,
      }));

    // Path variables
    const pathVars = (op.parameters || [])
      .filter((p) => p.in === "path")
      .map((p) => ({
        key: p.name,
        value: "",
        description: p.description || "Path parameter",
      }));

    const url = {
      raw:
        "{{base_url}}/" +
        pathSegments.join("/") +
        (queryParams.filter((q) => !q.disabled).length
          ? "?" + queryParams.filter((q) => !q.disabled).map((q) => q.key + "=").join("&")
          : ""),
      host: ["{{base_url}}"],
      path: pathSegments,
    };
    if (queryParams.length) url.query = queryParams;
    if (pathVars.length) url.variable = pathVars;

    const isMultipart = MULTIPART_ENDPOINTS[routeKey];
    const request = {
      method,
      header: isMultipart ? [] : [{ key: "Content-Type", value: "application/json" }],
      url,
      description: op.summary || "",
    };

    // Multipart file-upload endpoints
    if (isMultipart) {
      request.body = { mode: "formdata", formdata: isMultipart };
    }
    // Request body from OpenAPI $ref
    else if (op.requestBody) {
      const jsonContent = op.requestBody.content && op.requestBody.content["application/json"];
      if (jsonContent && jsonContent.schema) {
        const ref = jsonContent.schema["$ref"];
        if (ref) {
          const dtoName = ref.split("/").pop();
          const example = EXAMPLES[dtoName] || {};
          request.body = {
            mode: "raw",
            raw: JSON.stringify(example, null, 2),
            options: { raw: { language: "json" } },
          };
        }
      }
    }
    // Inline @Body() types not in OpenAPI schemas
    else if (INLINE_BODIES[routeKey]) {
      request.body = {
        mode: "raw",
        raw: JSON.stringify(INLINE_BODIES[routeKey], null, 2),
        options: { raw: { language: "json" } },
      };
    }

    // No-auth endpoints
    const isNoAuth = NO_AUTH_PATTERNS.some((pattern) => urlPath === pattern);
    if (isNoAuth) {
      request.auth = { type: "noauth" };
    }

    const item = { name, request };

    // Login auto-capture script
    if (urlPath === "/api/v1/auth/login" && method === "POST") {
      item.event = [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "if (pm.response.code === 201) {",
              "  const body = pm.response.json();",
              '  if (body.accessToken) {',
              '    pm.collectionVariables.set("access_token", body.accessToken);',
              '    console.log("Access token saved.");',
              "  }",
              "}",
            ],
          },
        },
      ];
    }

    folder.item.push(item);
  }

  collection.item.push(folder);
}

// ── Write collection ──
const outDir = path.join(__dirname, "..", "docs");
const outPath = path.join(outDir, "vexa-pim.postman_collection.json");
fs.writeFileSync(outPath, JSON.stringify(collection, null, 2), "utf8");

// ── Write environment files ──
function writeEnv(name, values) {
  const env = {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    values: Object.entries(values).map(([key, value]) => ({
      key,
      value,
      type: "default",
      enabled: true,
    })),
    _postman_variable_scope: "environment",
  };
  const envPath = path.join(outDir, `vexa-pim.${env.id}.postman_environment.json`);
  fs.writeFileSync(envPath, JSON.stringify(env, null, 2), "utf8");
  console.log(`  Environment: ${envPath}`);
}

writeEnv("Local", { base_url: "http://localhost:3001", access_token: "" });
writeEnv("Staging", { base_url: "https://staging.vexa.io", access_token: "" });
writeEnv("Production", { base_url: "https://app.vexa.io", access_token: "" });

// ── Summary ──
const requestCount = collection.item.reduce((sum, folder) => sum + folder.item.length, 0);
const folderCount = collection.item.length;
const namedCount = collection.item.reduce(
  (sum, folder) => sum + folder.item.filter((i) => !i.name.includes("Controller_")).length,
  0,
);
console.log(`Generated ${outPath}`);
console.log(`  ${folderCount} folders, ${requestCount} requests`);
console.log(`  ${namedCount}/${requestCount} human-readable names`);
console.log(`  ${Object.keys(EXAMPLES).length} request bodies with examples`);
