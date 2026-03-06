/**
 * PIM1 i18n Keys - ALL seller-facing strings must use these constants.
 * Never hardcode visible text. Add new keys here before using them.
 * English values are in src/i18n/en.ts.
 */

export const K = {
  // Global
  save: 'global.save',
  saving: 'global.saving',
  saved: 'global.saved',
  saveFailedRetry: 'global.save_failed_retry',
  offlineWillSync: 'global.offline_will_sync',
  backOnline: 'global.back_online',
  offlineBanner: 'global.offline_banner',
  unsavedChanges: 'global.unsaved_changes',
  leaveWithoutSaving: 'global.leave_without_saving',
  saveAndLeave: 'global.save_and_leave',
  stayOnPage: 'global.stay_on_page',
  cancel: 'global.cancel',
  confirm: 'global.confirm',
  delete: 'global.delete',
  upgrade: 'global.upgrade',
  retry: 'global.retry',
  loading: 'global.loading',
  errorRetry: 'global.error_retry',
  noResults: 'global.no_results',
  clearFilters: 'global.clear_filters',

  // Nav
  navHome: 'nav.home',
  navCatalog: 'nav.catalog',
  navIssues: 'nav.issues',
  navChannels: 'nav.channels',
  navSubmissions: 'nav.submissions',
  navMedia: 'nav.media',
  navBulkOps: 'nav.bulk_ops',
  navInsights: 'nav.insights',
  navSettings: 'nav.settings',

  // Badges
  badgeReady: 'badge.ready',
  badgeBlocked: 'badge.blocked',
  badgeWarning: 'badge.warning',
  badgePending: 'badge.pending',
  badgeNotConnected: 'badge.not_connected',
  badgeExpired: 'badge.expired',
  badgeSuccess: 'badge.success',
  badgeRejected: 'badge.rejected',
  badgeError: 'badge.error',
  badgeSuppressed: 'badge.suppressed',
  badgeActive: 'badge.active',
  badgeStatusAria: 'badge.status_aria',

  // Source labels
  sourceLiveApi: 'source.live_api',
  sourceLocalRules: 'source.local_rules',
  sourceHistoricalData: 'source.historical_data',
  sourceHeuristic: 'source.heuristic_fallback',
  sourceHeuristicTip: 'source.heuristic_tip',

  // Completeness
  completenessGood: 'completeness.good',
  completenessNeedsWork: 'completeness.needs_work',
  completenessIncomplete: 'completeness.incomplete',
  completenessAriaLabel: 'completeness.aria_label',
  completenessOpenPanel: 'completeness.open_panel',

  // Catalog
  catalogEmpty: 'catalog.empty',
  catalogEmptyAction: 'catalog.empty_action',
  catalogFiltersEmpty: 'catalog.filters_empty',
  catalogAddProduct: 'catalog.add_product',
  catalogSkuLimitNearing: 'catalog.sku_limit_nearing',

  // Product detail
  pdValidate: 'product.validate',
  pdPublish: 'product.publish',
  pdReconnect: 'product.reconnect',

  // Channels
  channelReadiness: 'channel.readiness',
  channelConnect: 'channel.connect',
  channelManage: 'channel.manage',
  channelReconnect: 'channel.reconnect',
  channelCredExpired: 'channel.cred_expired',
  channelCapPublish: 'channel.cap.publish',
  channelCapValidate: 'channel.cap.validate',
  channelCapWebhook: 'channel.cap.webhook',
  channelCapExcelExport: 'channel.cap.excel_export',
  channelCapStatusSync: 'channel.cap.status_sync',
  channelAccountsCount: 'channel.accounts_count',

  // Meesho
  meeshoGenerateExport: 'meesho.generate_export',
  meeshoExportSummaryIncluded: 'meesho.export_summary.included',
  meeshoExportSummaryExcluded: 'meesho.export_summary.excluded',
  meeshoExportProceed: 'meesho.export_proceed',
  meeshoExportCancelFix: 'meesho.export_cancel_fix',
  meeshoExportNote: 'meesho.export_note',
  meeshoCapNote: 'meesho.cap_note',
  meeshoExportReady: 'meesho.export_ready',

  // Plan limits
  planLimitTitle: 'plan.limit_title',
  planLimitBody: 'plan.limit_body',
  planLimitUpgrade: 'plan.limit_upgrade',
  planLimitMaybeLater: 'plan.limit_maybe_later',
  planResourceSkus: 'plan.resource_skus',
  planResourceSubmissions: 'plan.resource_submissions',
  planResourceStorage: 'plan.resource_storage',
  planResourceUsers: 'plan.resource_users',
  planYourPlan: 'plan.your_plan',
  planLimitWarning80: 'plan.warning_80',
  planUsageResets: 'plan.usage_resets',

  // DPDP / Consent
  consentTitle: 'consent.title',
  consentBody1: 'consent.body1',
  consentBody2: 'consent.body2',
  consentBody3: 'consent.body3',
  consentCheckbox: 'consent.checkbox',
  consentContinue: 'consent.continue',
  consentDecline: 'consent.decline',
  consentRequired: 'consent.required_banner',
  dataExportTitle: 'data.export_title',
  dataExportBody: 'data.export_body',
  dataExportBtn: 'data.export_btn',
  dataExportInProgress: 'data.export_in_progress',
  dataExportEmailNote: 'data.export_email_note',
  dataDeleteTitle: 'data.delete_title',
  dataDeleteBody: 'data.delete_body',
  dataDeleteBtn: 'data.delete_btn',
  dataDeleteConfirmModal: 'data.delete_confirm_modal',
  dataDeleteTypeConfirm: 'data.delete_type_confirm',
  dataDeleteScheduled: 'data.delete_scheduled',

  // Notifications
  notifPlanLimitWarning: 'notif.plan_limit_warning',
  notifPlanLimitReached: 'notif.plan_limit_reached',
  notifConsentRequired: 'notif.consent_required',
  notifViewPlan: 'notif.view_plan',
  notifReview: 'notif.review',

  // Auth
  loginRateLimited: 'auth.rate_limited',
  loginAccountLocked: 'auth.account_locked',
  loginResendUnlock: 'auth.resend_unlock',
  loginUnlockSent: 'auth.unlock_sent',
  loginWrongCredentials: 'auth.wrong_credentials',
  loginForgotPassword: 'auth.forgot_password',

  // Pagination
  paginationRowsPerPage: 'pagination.rows_per_page',
  paginationRange: 'pagination.range',
  paginationPrevPage: 'pagination.prev_page',
  paginationNextPage: 'pagination.next_page',
} as const

export type I18nKey = typeof K[keyof typeof K]
