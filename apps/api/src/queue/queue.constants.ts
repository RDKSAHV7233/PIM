export const QUEUE_NAMES = {
  BULK_IMPORT: "bulk-import",
  CONNECTOR_SUBMISSION: "connector-submission",
  WEBHOOK_EVENT: "webhook-event",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES] | string;
