export interface UserFacingError {
  title: string;
  description: string;
  action?: string;
}

const ERROR_MAP: Record<string, UserFacingError> = {
  VERSION_CONFLICT: {
    title: "Someone else updated this product",
    description: "This product was saved by another user while you were editing. Your changes were not applied.",
    action: "Reload the page to see the latest version, then make your changes again.",
  },
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
    "dead_letter",
    "retrying",
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
    dead_letter: "Export blocked. Fix errors first",
    failed: "Export failed",
  };
  return map[status] ?? status;
}
