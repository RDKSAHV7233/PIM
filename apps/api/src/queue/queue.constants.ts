export const QUEUE_NAMES = {
  BULK_IMPORT: "bulk-import",
  CONNECTOR_SUBMISSION: "connector-submission",
  CONNECTOR_WEBHOOK: "connector-webhook",
  WEBHOOK_EVENT: "webhook-event",
  AUTH_EMAIL: "auth-email",
  ACCOUNT_EXPORT: "account-export",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES] | string;
