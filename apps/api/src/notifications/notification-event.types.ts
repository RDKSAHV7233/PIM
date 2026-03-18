export const NOTIFICATION_EVENT_TYPES = [
  "import_completed",
  "import_failed",
  "publish_succeeded",
  "publish_failed",
  "approval_decision",
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];
