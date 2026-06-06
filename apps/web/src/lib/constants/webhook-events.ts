export const WEBHOOK_EVENT_LABELS: Record<string, string> = {
  import_completed: "Import completed",
  import_failed: "Import failed",
  import_repair_required: "Import repair required",
  publish_succeeded: "Publish succeeded",
  publish_failed: "Publish failed",
  approval_decision: "Approval decision",
};

/** Set for O(1) membership checks in server actions */
export const WEBHOOK_EVENT_TYPES = new Set(Object.keys(WEBHOOK_EVENT_LABELS));
