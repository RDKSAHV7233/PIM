import { RecordStatus } from "@prisma/client";

// Single source of truth for product workflow-status transitions. Previously duplicated
// between catalog.service.ts (canonical) and bulk-edit.service.ts (its own copy), which
// drifted out of sync — bulk-edit.service.ts's `approved` entry was missing "draft",
// causing it to reject a transition the single-product PATCH endpoint already allowed
// (#549). Both call sites now import from here so the two can't drift apart again.

export type WorkflowStatus = "draft" | "in_review" | "approved" | "rejected" | "archived";

export const WORKFLOW_TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  draft: ["in_review", "archived"],
  in_review: ["approved", "rejected", "draft", "archived"],
  approved: ["archived", "draft"],
  rejected: ["draft", "in_review", "archived"],
  archived: ["draft", "in_review"],
};

/** `active` isn't a distinct node in the transition graph — it canonicalizes to `approved`. */
export function canonicalWorkflowStatus(status: RecordStatus): WorkflowStatus {
  if (status === RecordStatus.active) {
    return "approved";
  }
  return status as WorkflowStatus;
}

export function isValidWorkflowTransition(currentStatus: RecordStatus, nextStatus: RecordStatus): boolean {
  if (currentStatus === nextStatus) {
    return true;
  }
  const currentCanonical = canonicalWorkflowStatus(currentStatus);
  const nextCanonical = canonicalWorkflowStatus(nextStatus);
  if (currentCanonical === nextCanonical) {
    return true;
  }
  const allowed = WORKFLOW_TRANSITIONS[currentCanonical] ?? [];
  return allowed.includes(nextCanonical);
}
