export const NOTIFICATION_EVENT_TYPES = [
  "import_completed",
  "import_failed",
  "import_repair_required",
  "publish_succeeded",
  "publish_failed",
  "approval_decision",
  "connector_down",
  "connector_credentials_expired",
  "scheduled_export_failed",
  "readiness_blocker_detected",
  "mapping_validation_failed",
  "queue_dlq_threshold_exceeded",
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];
