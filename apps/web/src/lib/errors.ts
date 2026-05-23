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
  CONNECTOR_PUBLISH_FAILED: {
    title: "Channel publish failed",
    description: "The product could not be published to the connected channel.",
    action: "Check the connector health page for the full error response, fix the reported fields, then retry.",
  },
  LOCALE_TRANSLATION_FAILED: {
    title: "Translation failed",
    description: "A locale translation for this product could not be generated.",
    action: "Check the translation configuration and retry the export.",
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

  // ── Validation issues — shared (shown in Quality tab across all connectors) ──
  REQUIRED_FIELD: {
    title: "Required field missing",
    description: "This field must be filled before the product can be published.",
    action: "Enter a value and save again.",
  },
  // Backend emits REQUIRED_FIELD_MISSING; alias to the same copy.
  REQUIRED_FIELD_MISSING: {
    title: "Required field missing",
    description: "This field is required by the connected channel but has no value.",
    action: "Fill in the missing field in the product editor and re-export.",
  },
  CHANNEL_REQUIRED_FIELD: {
    title: "Required channel field missing",
    description: "A field required by this channel has no value.",
    action: "Fill in the missing field in the product editor and re-export.",
  },
  RECOMMENDED_FIELD_MISSING: {
    title: "Recommended field missing",
    description: "This field is strongly recommended by the channel but is currently empty.",
    action: "Adding this field improves listing quality and discoverability.",
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
  GST_RATE_INVALID: {
    title: "Invalid GST rate",
    description: "This GST rate value is not recognised.",
    action: "Enter a valid GST slab: 0, 5, 12, 18, or 28.",
  },
  HSN_CODE_RECOMMENDED: {
    title: "HSN code not set",
    description: "An HSN code is recommended for this product category.",
    action: "Add the correct HSN code in the product editor.",
  },

  // ── Validation issues — product fields ──────────────────────────────────────
  TITLE_REQUIRED: {
    title: "Title required",
    description: "The product must have a title before it can be published.",
    action: "Add a descriptive title in the product editor.",
  },
  TITLE_TOO_LONG: {
    title: "Title too long",
    description: "The product title exceeds the maximum length allowed by this channel.",
    action: "Shorten the title to 255 characters or fewer.",
  },
  DESCRIPTION_WHITESPACE_ONLY: {
    title: "Description is blank",
    description: "The description contains only whitespace and will not be accepted.",
    action: "Add a meaningful product description.",
  },
  BRAND_RECOMMENDED: {
    title: "Brand not set",
    description: "A brand or manufacturer name is recommended for this product.",
    action: "Add the brand name in the product editor.",
  },
  PRODUCT_TYPE_RECOMMENDED: {
    title: "Product type not set",
    description: "A product type improves discoverability on this channel.",
    action: "Set the product type in the product editor.",
  },
  PRODUCT_TYPE_TOO_LONG: {
    title: "Product type too long",
    description: "The product type value exceeds the channel's maximum length.",
    action: "Shorten the product type to 255 characters or fewer.",
  },
  ATTRIBUTES_INVALID: {
    title: "Invalid attributes",
    description: "One or more product attributes have invalid values.",
    action: "Review the attributes in the product editor and correct any invalid entries.",
  },
  ATTRIBUTE_VALUE_NOT_IN_LIST: {
    title: "Attribute value not allowed",
    description: "The value for this attribute is not in the channel's accepted list.",
    action: "Choose a value from the allowed list in the product editor.",
  },

  // ── Validation issues — pricing ──────────────────────────────────────────────
  SELLING_PRICE_ZERO_OR_MISSING: {
    title: "Selling price missing or zero",
    description: "This channel requires a non-zero selling price.",
    action: "Set a selling price greater than zero in the product editor.",
  },
  SELLING_PRICE_GT_MRP: {
    title: "Selling price exceeds MRP",
    description: "The selling price is higher than the maximum retail price.",
    action: "Reduce the selling price to be equal to or less than the MRP.",
  },
  PRICE_INVALID: {
    title: "Invalid price",
    description: "The selling price is not a valid number.",
    action: "Enter a valid price with up to 2 decimal places (e.g. 499.00).",
  },
  PRICE_NEGATIVE: {
    title: "Price must be positive",
    description: "The selling price cannot be zero or negative.",
    action: "Enter a price greater than zero.",
  },

  // ── Validation issues — images ───────────────────────────────────────────────
  IMAGE_URL_NOT_HTTPS: {
    title: "Image URL must be HTTPS",
    description: "This channel only accepts images served over HTTPS.",
    action: "Upload the image to a public HTTPS location or use the media library.",
  },
  IMAGE_URL_INVALID: {
    title: "Invalid image URL",
    description: "The main image URL is invalid or could not be reached.",
    action: "Ensure the image is a public HTTPS URL (minimum 800×800 px).",
  },
  IMAGE_TOO_SMALL: {
    title: "Image too small",
    description: "The image does not meet the channel's minimum size requirement.",
    action: "Upload a replacement image that is at least 800×800 px.",
  },
  TOO_MANY_IMAGES: {
    title: "Too many images",
    description: "This channel has a maximum number of images per product.",
    action: "Remove extra images to meet the channel's limit.",
  },

  // ── Validation issues — variants / SKU ──────────────────────────────────────
  SKU_REQUIRED: {
    title: "SKU required",
    description: "Each variant must have a unique SKU.",
    action: "Set a SKU for this variant in the product editor.",
  },
  SKU_DUPLICATE: {
    title: "Duplicate SKU",
    description: "This SKU is already used by another product or variant.",
    action: "Change the SKU to a unique value.",
  },
  BARCODE_INVALID: {
    title: "Invalid barcode format",
    description: "The barcode is not a valid EAN-13, UPC, or ISBN format.",
    action: "Check the barcode value and correct the format.",
  },
  BARCODE_DUPLICATE: {
    title: "Duplicate barcode",
    description: "This barcode is already used by another product in the channel.",
    action: "Each product must have a unique barcode. Update the value and retry.",
  },
  HANDLE_DUPLICATE: {
    title: "Product handle already in use",
    description: "The generated URL handle conflicts with an existing product in the channel.",
    action: "Rename the product title to generate a unique handle.",
  },
  VENDOR_TOO_LONG: {
    title: "Brand name too long",
    description: "The brand or vendor name exceeds the channel's maximum length.",
    action: "Shorten the brand name.",
  },
  WEIGHT_INVALID: {
    title: "Invalid weight",
    description: "The variant weight must be a positive number.",
    action: "Enter a valid positive weight value.",
  },

  // ── Validation issues — metafields ───────────────────────────────────────────
  METAFIELD_REQUIRED: {
    title: "Required metafield missing",
    description: "A metafield required by this channel has no value.",
    action: "Check the mapping editor and ensure all required channel fields are mapped.",
  },
  METAFIELD_TYPE_MISMATCH: {
    title: "Metafield type mismatch",
    description: "A metafield value does not match the expected type.",
    action: "Check the mapped field value and correct the data type.",
  },

  // ── Validation issues — Amazon-specific ──────────────────────────────────────
  BULLET_POINTS_MISSING: {
    title: "Bullet points required",
    description: "This Amazon listing requires at least one bullet point.",
    action: "Add bullet points to the product description.",
  },
  TOO_MANY_BULLET_POINTS: {
    title: "Too many bullet points",
    description: "Amazon has a maximum number of bullet points per listing.",
    action: "Remove extra bullet points to meet the limit.",
  },
  VARIATION_MISSING_PARENT_SKU: {
    title: "Parent SKU missing",
    description: "Variation listings require a parent SKU.",
    action: "Set the parent SKU in the product mapping.",
  },
  VARIATION_MISSING_THEME: {
    title: "Variation theme missing",
    description: "Variation listings require a variation theme (e.g. size, colour).",
    action: "Set the variation theme in the product mapping.",
  },
  INVALID_CONDITION: {
    title: "Invalid condition value",
    description: "The product condition is not one of the accepted values for this channel.",
    action: "Choose a valid condition from the channel's accepted list.",
  },

  // ── Validation issues — Flipkart-specific ────────────────────────────────────
  FLIPKART_OVERWRITE_WARNING: {
    title: "Overwrite warning",
    description: "Publishing will overwrite existing data on Flipkart.",
    action: "Review the changes before proceeding.",
  },

  // ── Connector / rate limiting ─────────────────────────────────────────────────
  RATE_LIMITED: {
    title: "Channel rate limit reached",
    description: "The channel API has temporarily throttled requests.",
    action: "The system will retry automatically. No action needed.",
  },
  PERMISSION_DENIED: {
    title: "App permission denied",
    description: "The connected app does not have permission to perform this action.",
    action: "Re-install the connector or check the app's permission scopes.",
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

  // Exact-code match: backend embeds the code as a word in the error message.
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
    "CONNECTOR_PUBLISH_FAILED",
    "LOCALE_TRANSLATION_FAILED",
    "REQUIRED_FIELD_MISSING",
    "REQUIRED_FIELD",
    "CHANNEL_REQUIRED_FIELD",
    "RECOMMENDED_FIELD_MISSING",
    "INVALID_HSN",
    "INVALID_GST_RATE",
    "GST_RATE_INVALID",
    "HSN_CODE_RECOMMENDED",
    "TITLE_REQUIRED",
    "TITLE_TOO_LONG",
    "DESCRIPTION_WHITESPACE_ONLY",
    "BRAND_RECOMMENDED",
    "PRODUCT_TYPE_RECOMMENDED",
    "PRODUCT_TYPE_TOO_LONG",
    "ATTRIBUTES_INVALID",
    "ATTRIBUTE_VALUE_NOT_IN_LIST",
    "SELLING_PRICE_ZERO_OR_MISSING",
    "SELLING_PRICE_GT_MRP",
    "PRICE_INVALID",
    "PRICE_NEGATIVE",
    "IMAGE_URL_NOT_HTTPS",
    "IMAGE_URL_INVALID",
    "IMAGE_TOO_SMALL",
    "TOO_MANY_IMAGES",
    "SKU_REQUIRED",
    "SKU_DUPLICATE",
    "BARCODE_INVALID",
    "BARCODE_DUPLICATE",
    "HANDLE_DUPLICATE",
    "VENDOR_TOO_LONG",
    "WEIGHT_INVALID",
    "METAFIELD_REQUIRED",
    "METAFIELD_TYPE_MISMATCH",
    "BULLET_POINTS_MISSING",
    "TOO_MANY_BULLET_POINTS",
    "VARIATION_MISSING_PARENT_SKU",
    "VARIATION_MISSING_THEME",
    "INVALID_CONDITION",
    "FLIPKART_OVERWRITE_WARNING",
    "RATE_LIMITED",
    "PERMISSION_DENIED",
    "dead_letter",
    "retrying",
    "skipped",
  ];
  for (const code of known) {
    if (text.includes(code)) {
      return code;
    }
  }

  // Plain-language backend messages (BadRequestException with a string body).
  if (normalized.includes("sku") && (normalized.includes("already exists") || normalized.includes("duplicate"))) {
    return "SKU_DUPLICATE";
  }
  if (normalized.includes("selling price") && (normalized.includes("exceed") || normalized.includes("mrp"))) {
    return "SELLING_PRICE_GT_MRP";
  }
  if (normalized.includes("selling price") && (normalized.includes("zero") || normalized.includes("missing") || normalized.includes("required"))) {
    return "SELLING_PRICE_ZERO_OR_MISSING";
  }
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
