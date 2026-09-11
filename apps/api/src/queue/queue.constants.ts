export const QUEUE_NAMES = {
  BULK_IMPORT: "bulk-import",
  BULK_EDIT: "bulk-edit",
  MARKETPLACE_BULK_PUBLISH: "marketplace-bulk-publish",
  CONNECTOR_SUBMISSION: "connector-submission",
  CONNECTOR_WEBHOOK: "connector-webhook",
  WEBHOOK_EVENT: "webhook-event",
  INTERNAL_OPS_ALERT: "internal-ops-alert",
  AUTH_EMAIL: "auth-email",
  ACCOUNT_EXPORT: "account-export",
  ACCOUNT_DELETION_EXECUTION: "account-deletion-execution",
  SIGNUP_BILLING_PROVISION: "signup-billing-provision",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES] | string;
