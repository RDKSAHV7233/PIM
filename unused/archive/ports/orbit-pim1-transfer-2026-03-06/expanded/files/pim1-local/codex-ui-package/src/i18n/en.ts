/**
 * English string map - all seller-facing text.
 * Keys match src/i18n/keys.ts K constants.
 */
export const en: Record<string, string> = {
  // Global
  'global.save': 'Save',
  'global.saving': 'Saving…',
  'global.saved': 'Saved ?',
  'global.save_failed_retry': 'Save failed — retry',
  'global.offline_will_sync': 'Offline — will save on reconnect',
  'global.back_online': 'Back online',
  'global.offline_banner': 'You appear to be offline. Changes will sync when you reconnect.',
  'global.unsaved_changes': 'You have unsaved changes. Leave without saving?',
  'global.leave_without_saving': 'Leave',
  'global.save_and_leave': 'Save and leave',
  'global.stay_on_page': 'Stay',
  'global.cancel': 'Cancel',
  'global.confirm': 'Confirm',
  'global.delete': 'Delete',
  'global.upgrade': 'Upgrade',
  'global.retry': 'Retry',
  'global.loading': 'Loading…',
  'global.error_retry': 'Something went wrong. Try again.',
  'global.no_results': 'No results',
  'global.clear_filters': 'Clear filters',

  // Nav
  'nav.home': 'Home',
  'nav.catalog': 'Catalog',
  'nav.issues': 'Issues',
  'nav.channels': 'Channels',
  'nav.submissions': 'Submissions',
  'nav.media': 'Media',
  'nav.bulk_ops': 'Bulk ops',
  'nav.insights': 'Insights',
  'nav.settings': 'Settings',

  // Badges
  'badge.ready': 'Ready',
  'badge.blocked': 'Blocked',
  'badge.warning': 'Warning',
  'badge.pending': 'Pending',
  'badge.not_connected': 'Not connected',
  'badge.expired': 'Expired',
  'badge.success': 'Success',
  'badge.rejected': 'Rejected',
  'badge.error': 'Error',
  'badge.suppressed': 'Suppressed',
  'badge.active': 'Active',
  'badge.status_aria': 'Status: {status}',

  // Source labels
  'source.live_api': 'Live API',
  'source.local_rules': 'Local rules',
  'source.historical_data': 'Your data',
  'source.heuristic_fallback': 'Estimated',
  'source.heuristic_tip': 'This estimate is based on general rules, not your actual rejections.',

  // Completeness
  'completeness.good': 'Good',
  'completeness.needs_work': 'Needs work',
  'completeness.incomplete': 'Incomplete',
  'completeness.aria_label': 'Completeness: {score} out of 100. {status}.',
  'completeness.open_panel': 'Open completeness breakdown. Score: {score} out of 100.',

  // Catalog
  'catalog.empty': 'Your catalog is empty.',
  'catalog.empty_action': 'Import products',
  'catalog.filters_empty': 'No products match this filter.',
  'catalog.add_product': 'Add product',
  'catalog.sku_limit_nearing': '{current} of {limit} SKUs used',

  // Product
  'product.validate': 'Validate',
  'product.publish': 'Publish',
  'product.reconnect': 'Reconnect',

  // Channels
  'channel.readiness': 'Channel ready',
  'channel.connect': 'Connect',
  'channel.manage': 'Manage',
  'channel.reconnect': 'Reconnect',
  'channel.cred_expired': 'Credential expired — reconnect required',
  'channel.cap.publish': 'Publish',
  'channel.cap.validate': 'Validate',
  'channel.cap.webhook': 'Webhook',
  'channel.cap.excel_export': 'Excel export',
  'channel.cap.status_sync': 'Status sync',
  'channel.accounts_count': '{count} accounts',

  // Meesho (NEVER say Publish on Meesho CTAs)
  'meesho.generate_export': 'Generate export file',
  'meesho.export_summary.included': '{n} products included',
  'meesho.export_summary.excluded': '{n} products excluded',
  'meesho.export_proceed': 'Download {n} products',
  'meesho.export_cancel_fix': 'Cancel — fix all {n} first',
  'meesho.export_note': 'Meesho uses manual Excel upload via Supplier Panel. This generates the upload file.',
  'meesho.cap_note': 'New product creation is Excel-upload-only. This connector generates the upload file.',
  'meesho.export_ready': 'Export ready',

  // Plan limits
  'plan.limit_title': 'You’ve reached your {resource} limit',
  'plan.limit_body': 'Your {plan} plan includes {limit} {resource}. You are currently using {current}.',
  'plan.limit_upgrade': 'Upgrade plan',
  'plan.limit_maybe_later': 'Maybe later',
  'plan.resource_skus': 'SKUs',
  'plan.resource_submissions': 'monthly submissions',
  'plan.resource_storage': 'storage',
  'plan.resource_users': 'users',
  'plan.your_plan': 'your plan',
  'plan.warning_80': 'You’re using {n}% of your {resource} limit.',
  'plan.usage_resets': 'Resets on {date}',

  // DPDP / Consent
  'consent.title': 'How PIM1 uses your data',
  'consent.body1': 'We collect the product data you enter, your connector credentials (encrypted), and your email and name.',
  'consent.body2': 'We use it only to sync your listings to Amazon, Flipkart, and Meesho. Nothing else without asking you again.',
  'consent.body3': 'You can export all your data or delete your account from Settings at any time. We will process the request within 72 hours.',
  'consent.checkbox': 'I understand how PIM1 uses my data and give my consent.',
  'consent.continue': 'Continue to PIM1',
  'consent.decline': 'I don’t consent — delete my account',
  'consent.required_banner': 'Our privacy terms have been updated. Please review and re-consent to continue.',
  'data.export_title': 'Your data',
  'data.export_body': 'You have the right to a copy of all the data PIM1 holds about you and your team.',
  'data.export_btn': 'Export my data',
  'data.export_in_progress': 'Export in progress…',
  'data.export_email_note': 'We’ll email you a download link within 30 minutes.',
  'data.delete_title': 'Delete account',
  'data.delete_body': 'Deleting your account removes your personal information from PIM1 within 72 hours. Your listing history is retained in anonymised form. This cannot be undone.',
  'data.delete_btn': 'Delete my account',
  'data.delete_confirm_modal': 'Delete your PIM1 account?',
  'data.delete_type_confirm': 'Type your email address to confirm',
  'data.delete_scheduled': 'Your account deletion has been scheduled. All personal data will be removed by {date}.',

  // Notifications
  'notif.plan_limit_warning': 'You’re using {n}% of your {resource} limit. Upgrade to continue growing.',
  'notif.plan_limit_reached': 'You’ve reached your {resource} limit. New {actions} are paused until you upgrade.',
  'notif.consent_required': 'Our privacy terms have been updated. Please review and re-consent to continue using PIM1.',
  'notif.view_plan': 'View plan',
  'notif.review': 'Review',

  // Auth
  'auth.rate_limited': 'Too many login attempts from this network. Please wait {n} minutes.',
  'auth.account_locked': 'This account has been locked for security. We’ve sent an unlock email to {email}.',
  'auth.resend_unlock': 'Resend unlock email',
  'auth.unlock_sent': 'Email sent.',
  'auth.wrong_credentials': 'Invalid email or password.',
  'auth.forgot_password': 'Forgot password?',

  // Pagination
  'pagination.rows_per_page': 'Rows per page:',
  'pagination.range': '{from}-{to} of {total}',
  'pagination.prev_page': 'Previous page',
  'pagination.next_page': 'Next page',
}
