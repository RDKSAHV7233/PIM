export interface UserFacingError {
  title: string;
  description: string;
  action?: string;
}

const ERROR_MAP: Record<string, UserFacingError> = {
  // ── Catalog / workflow ──────────────────────────────────────────────────────
  VERSION_CONFLICT: {
    title: "Someone else updated this product",
    description: "This product was saved by another user while you were editing. Your changes were not applied.",
    action: "Reload the page to see the latest version, then make your changes again.",
  },
  APPROVAL_BLOCKED: {
    title: "Approval blocked",
    description: "This product has open validation issues that must be resolved before it can be approved.",
    action: "Open the Quality tab, fix each blocking issue, then resubmit for approval.",
  },
  WORKFLOW_CONTENT_LOCKED: {
    title: "Content is locked",
    description: "Products in this workflow state cannot be edited directly.",
    action: "Change the workflow status to Draft first, then make your changes.",
  },
  WORKFLOW_ENTRY_INVALID: {
    title: "Invalid status transition",
    description: "This product cannot move to the requested workflow state from its current state.",
    action: "Check the current product status and choose a valid next step.",
  },

  // ── Bulk import ─────────────────────────────────────────────────────────────
  NO_ROWS: {
    title: "No data rows found",
    description: "The file or data you uploaded contains no importable rows.",
    action: "Check that the file is not empty and the correct sheet or format is selected.",
  },
  ROW_LIMIT_EXCEEDED: {
    title: "Too many rows",
    description: "The import exceeds the maximum number of rows allowed per job.",
    action: "Split the file into smaller batches and upload each one separately.",
  },
  UNMAPPED_FIELDS: {
    title: "Unmapped columns",
    description: "Some columns in your file are not mapped to product fields.",
    action: "Return to the mapping step and assign each column to a product field, or mark it as ignored.",
  },

  // ── Bulk edit ───────────────────────────────────────────────────────────────
  EMPTY_SCOPE: {
    title: "No products matched",
    description: "The filters you set did not match any products in your catalog.",
    action: "Widen the filter criteria and try again.",
  },

  // ── Marketplace / connector ─────────────────────────────────────────────────
  CONNECTOR_UPDATE_FAILED: {
    title: "Channel update failed",
    description: "The product could not be updated on the connected channel.",
    action: "Check the connector health page for error details, then retry the export.",
  },

  // ── Import job row states ───────────────────────────────────────────────────
  dead_letter: {
    title: "Could not be processed automatically",
    description: "These rows have errors that need your attention before they can be imported.",
    action: "Review each row below, correct the value, and click Retry.",
  },
  retrying: {
    title: "Retrying",
    description: "This row failed once and is being tried again automatically.",
    action: "Wait a moment. It will either succeed or appear in the error list.",
  },
  skipped: {
    title: "Skipped while access is suspended",
    description: "This export was intentionally not processed because the workspace is suspended.",
    action: "Resume the workspace first, then process the export again.",
  },

  // ── Validation issues (shown in Quality tab) ────────────────────────────────
  REQUIRED_FIELD: {
    title: "Required field missing",
    description: "This field must be filled before the product can be published.",
    action: "Enter a value and save again.",
  },
  INVALID_HSN: {
    title: "Invalid HSN code",
    description: "HSN codes must be 4, 6, or 8 digits. Check your code and try again.",
    action: "Use the GST portal (cbic-gst.gov.in) to find the correct HSN for this category.",
  },
  INVALID_GST_RATE: {
    title: "Unusual GST rate",
    description: "This GST rate is not a standard Indian GST slab (0%, 5%, 12%, 18%, 28%).",
    action: "Verify the rate is correct. If unsure, check with your CA.",
  },

  // ── Fallback ─────────────────────────────────────────────────────────────────
  UNKNOWN_ERROR: {
    title: "Something went wrong",
    description: "An unexpected error occurred.",
    action: "Try again. If the problem continues, contact support.",
  },
};

export function translateError(code: string | undefined | null): UserFacingError {
  if (!code) {
    return ERROR_MAP.UNKNOWN_ERROR;
  }
  return (
    ERROR_MAP[code] ?? {
      title: "Something went wrong",
      description: "An unexpected error occurred.",
      action: "Try again or contact support.",
    }
  );
}

export function extractErrorCode(input: string | undefined | null): string {
  const text = String(input ?? "");
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return "UNKNOWN_ERROR";
  }

  const known = [
    "VERSION_CONFLICT",
    "APPROVAL_BLOCKED",
    "WORKFLOW_CONTENT_LOCKED",
    "WORKFLOW_ENTRY_INVALID",
    "NO_ROWS",
    "ROW_LIMIT_EXCEEDED",
    "UNMAPPED_FIELDS",
    "EMPTY_SCOPE",
    "CONNECTOR_UPDATE_FAILED",
    "dead_letter",
    "retrying",
    "skipped",
    "REQUIRED_FIELD",
    "INVALID_HSN",
    "INVALID_GST_RATE",
  ];
  for (const code of known) {
    if (text.includes(code)) {
      return code;
    }
  }

  // Handle plain-language backend messages so sellers still get useful copy.
  if ((normalized.includes("required") || normalized.includes("must")) && normalized.includes("field")) {
    return "REQUIRED_FIELD";
  }
  if (normalized.includes(" is required")) {
    return "REQUIRED_FIELD";
  }
  if (normalized.includes("hsn") && (normalized.includes("invalid") || normalized.includes("digit"))) {
    return "INVALID_HSN";
  }
  if (normalized.includes("gst") && (normalized.includes("invalid") || normalized.includes("rate"))) {
    return "INVALID_GST_RATE";
  }
  if (normalized.includes("dead letter") || normalized.includes("dead_letter")) {
    return "dead_letter";
  }
  if (normalized.includes("retrying")) {
    return "retrying";
  }
  if (normalized.includes("skipped")) {
    return "skipped";
  }

  return "UNKNOWN_ERROR";
}

export function translateJobStatus(status: string): string {
  const map: Record<string, string> = {
    pending: "Waiting to start",
    queued: "Waiting to start",
    processing: "Importing",
    completed: "Import complete",
    retrying: "Retrying failed rows",
    dead_letter: "Needs your attention",
    failed: "Import failed",
  };
  return map[status] ?? status;
}

export function translateExportStatus(status: string): string {
  const map: Record<string, string> = {
    queued: "Queued for export",
    processing: "Preparing export",
    completed: "Ready to submit",
    retrying: "Retrying",
    skipped: "Skipped while workspace is suspended",
    dead_letter: "Export blocked. Fix errors first",
    failed: "Export failed",
  };
  return map[status] ?? status;
}
