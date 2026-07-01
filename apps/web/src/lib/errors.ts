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

  // ── Validation issues — compliance (GST/HSN rule codes emitted by compliance service) ──
  GST_HSN_REQUIRED: {
    title: "HSN code required",
    description: "Every product needs an HSN code for GST compliance.",
    action: "Add the 4, 6, or 8-digit HSN code in the product editor.",
  },
  GST_HSN_FORMAT: {
    title: "Invalid HSN format",
    description: "HSN codes must be exactly 4, 6, or 8 digits.",
    action: "Use the GST portal (cbic-gst.gov.in) to find the correct HSN code for this category.",
  },
  GST_RATE_REQUIRED: {
    title: "GST rate required",
    description: "A GST rate must be set before the product can be exported.",
    action: "Set the GST rate in the product editor. Common slabs: 0, 5, 12, 18, 28.",
  },
  GST_RATE_UNCOMMON: {
    title: "Unusual GST rate",
    description: "This GST rate is not a standard Indian GST slab (0%, 3%, 5%, 12%, 18%, 28%).",
    action: "Verify the rate is correct. If unsure, check with your CA or tax advisor.",
  },

  // ── Validation issues — pricing (emitted by compliance service pricing check) ──
  PRICING_NO_DEFAULT_PRICES: {
    title: "No prices set",
    description: "None of this product's variants have prices in the default price list.",
    action: "Open Settings → Pricing, find the default price list, and set MRP and selling price for all variants.",
  },
  PRICING_INCOMPLETE: {
    title: "Pricing incomplete",
    description: "Some variants are missing prices in the default price list.",
    action: "Open Settings → Pricing and set prices for the unpriced variants before exporting.",
  },

  // ── Validation issues — international tax codes (emitted by connector validation) ──
  TAX_CODE_MISSING: {
    title: "Tax code missing",
    description: "A marketplace-required tax code is not set for this product. Listings in that market may be rejected.",
    action: "Open the product editor → Content tab → International Tax Codes section and enter the required code.",
  },
  HS_CODE_MISSING: {
    title: "HS / commodity code not set",
    description:
      "No harmonized system code (HS code or commodity code) is set for this product. Shopify uses this for customs declarations on international shipments.",
    action:
      "Open the product editor → Content tab → International Tax Codes section and add an AE HS code, UK commodity code, or AU commodity code.",
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
  CONNECTOR_LAUNCH_STAGE_PLANNED: {
    title: "Connector not yet available",
    description: "This connector is on the roadmap but has not been released yet.",
    action: "Check the changelog for release updates or contact support for an ETA.",
  },
  CONNECTOR_PRODUCT_TYPE_SCHEMA_UNSUPPORTED: {
    title: "Product type not supported",
    description: "The selected product type does not have a schema defined for this connector.",
    action: "Choose a different product type or contact support to request schema support.",
  },
  MEESHO_CREDENTIALS_INCOMPLETE: {
    title: "Meesho credentials incomplete",
    description: "The Meesho connector is missing required API credentials.",
    action: "Go to Channels → Meesho → Settings and enter the API key and secret provided by Meesho.",
  },
  CONNECTOR_PERMISSION_DENIED: {
    title: "Connector permission denied",
    description: "You do not have permission to perform this action on the connector.",
    action: "Contact your workspace admin to request the required connector permissions.",
  },
  CONNECTOR_PERMISSION_INVALID_ROLE: {
    title: "Invalid role for connector access",
    description: "The role assigned does not grant access to this connector action.",
    action: "Ask your admin to assign a role that includes connector permissions.",
  },
  CONNECTOR_PERMISSION_USER_REQUIRED: {
    title: "User required for connector permission",
    description: "A specific user must be selected to grant this connector permission.",
    action: "Select a user from the list before saving the permission.",
  },
  CONNECTOR_PERMISSION_USER_NOT_FOUND: {
    title: "User not found",
    description: "The user specified for this connector permission could not be found.",
    action: "Check that the user exists in the workspace and try again.",
  },
  CONNECTOR_OAUTH_CALLBACK_UNSUPPORTED: {
    title: "OAuth not supported",
    description: "This connector does not support OAuth-based authentication.",
    action: "Use API key credentials for this connector instead.",
  },
  PRODUCT_TYPE_REQUIRED: {
    title: "Product type required",
    description: "A product type must be selected before using this connector feature.",
    action: "Choose a product type from the dropdown and try again.",
  },

  // ── Auth / session ────────────────────────────────────────────────────────────
  IP_RATE_LIMITED: {
    title: "Too many login attempts",
    description: "Too many requests have been made from this IP address. Access is temporarily blocked.",
    action: "Wait a few minutes before trying again. If this continues, contact support.",
  },
  ACCOUNT_LOCKED: {
    title: "Account locked",
    description: "This account has been locked after too many failed login attempts.",
    action: "Contact your workspace admin to unlock the account.",
  },
  TOKEN_REVOKED: {
    title: "Session expired",
    description: "Your session token has been revoked. You need to sign in again.",
    action: "Return to the login page and sign in with your credentials.",
  },
  CREDENTIALS_CHANGED: {
    title: "Credentials changed",
    description: "Your account credentials have been updated. You need to sign in again.",
    action: "Return to the login page and sign in with your new credentials.",
  },
  USER_INACTIVE: {
    title: "Account inactive",
    description: "This account has been deactivated and cannot be used to sign in.",
    action: "Contact your workspace admin to reactivate the account.",
  },
  USER_LOCKED: {
    title: "Account locked",
    description: "This account has been locked by an administrator.",
    action: "Contact your workspace admin to unlock the account.",
  },
  CONSENT_REQUIRED: {
    title: "Consent required",
    description: "You must accept the terms of service before continuing.",
    action: "Review and accept the terms of service to proceed.",
  },
  DELETE_CONFIRMATION_REQUIRED: {
    title: "Confirmation required",
    description: "You must confirm this action before it can be processed.",
    action: "Re-submit the request with the required confirmation token.",
  },
  AUTH_CREDENTIAL_MIGRATION_INCOMPLETE: {
    title: "Account migration incomplete",
    description: "Your account credentials have not been fully migrated to the current authentication system.",
    action: "Contact support to complete the account migration.",
  },
  MFA_ENROLLMENT_REQUIRED: {
    title: "Multi-factor authentication required",
    description: "Your workspace requires MFA to be enabled before you can continue.",
    action: "Go to account settings and enrol in multi-factor authentication.",
  },
  MFA_IDENTITY_NOT_FOUND: {
    title: "MFA identity not found",
    description: "No MFA identity was found for this account.",
    action: "Set up multi-factor authentication in account settings.",
  },
  MFA_ENROLLMENT_NOT_STARTED: {
    title: "MFA enrollment not started",
    description: "Multi-factor authentication enrollment has not been initiated.",
    action: "Start the MFA enrollment process in your account settings.",
  },
  MFA_NOT_ENABLED: {
    title: "MFA not enabled",
    description: "Multi-factor authentication is not enabled for this account.",
    action: "Enable MFA in account settings to use this feature.",
  },

  // ── Signup ────────────────────────────────────────────────────────────────────
  SIGNUP_RATE_LIMITED: {
    title: "Too many signup attempts",
    description: "You have submitted too many signup requests in a short period.",
    action: "Wait a few minutes and try again.",
  },
  SIGNUP_INTERNAL_ERROR: {
    title: "Signup failed",
    description: "An internal error occurred while creating your account.",
    action: "Try again in a few minutes. If the problem continues, contact support.",
  },

  // ── API key management ────────────────────────────────────────────────────────
  API_KEY_LABEL_REQUIRED: {
    title: "API key label required",
    description: "A descriptive label is required when creating an API key.",
    action: "Enter a label that identifies what this key will be used for.",
  },
  API_KEY_ADMIN_ROLE_FORBIDDEN: {
    title: "Admin role not allowed",
    description: "API keys cannot be created with the admin role.",
    action: "Choose a non-admin role for this API key.",
  },
  API_KEY_ID_REQUIRED: {
    title: "API key ID required",
    description: "An API key ID must be provided for this operation.",
    action: "Include the key ID and try again.",
  },
  API_KEY_NOT_FOUND: {
    title: "API key not found",
    description: "The specified API key does not exist or has already been deleted.",
    action: "Check the key ID and try again, or create a new API key.",
  },
  API_KEY_EXPIRY_INVALID: {
    title: "Invalid expiry date",
    description: "The expiry date format is not valid.",
    action: "Enter the expiry date in the correct format (YYYY-MM-DD).",
  },
  API_KEY_EXPIRY_IN_PAST: {
    title: "Expiry date is in the past",
    description: "The API key expiry date must be in the future.",
    action: "Choose a future expiry date.",
  },

  // ── User / RBAC management ────────────────────────────────────────────────────
  ADMIN_ROLE_REQUIRES_ADMIN: {
    title: "Admin base role required",
    description: "Only users with the admin base role can be assigned admin-level roles.",
    action: "Change the user's base role to admin before assigning admin-level access.",
  },
  CANNOT_CHANGE_OWN_ROLE: {
    title: "Cannot change your own role",
    description: "Administrators cannot change their own role to prevent accidental lock-out.",
    action: "Ask another admin to update your role.",
  },
  CANNOT_LOCK_SELF: {
    title: "Cannot lock your own account",
    description: "You cannot lock your own account.",
    action: "Ask another admin to lock the account if needed.",
  },
  CANNOT_DEACTIVATE_SELF: {
    title: "Cannot deactivate your own account",
    description: "You cannot deactivate your own account.",
    action: "Ask another admin to deactivate the account if needed.",
  },
  INVALID_ASSIGNED_ROLES: {
    title: "Invalid role assignment",
    description: "One or more of the selected roles are not valid for this user.",
    action: "Review the role list and remove any invalid selections.",
  },
  MULTI_ASSIGNED_ROLE_SET_NOT_SUPPORTED: {
    title: "Multiple role sets not supported",
    description: "This user configuration does not support multiple assigned role sets.",
    action: "Assign a single role set and try again.",
  },
  ASSIGNED_ROLE_DOES_NOT_WIDEN_BASE_ROLE: {
    title: "Assigned role too narrow",
    description: "The assigned role must grant permissions equal to or broader than the base role.",
    action: "Choose an assigned role that is compatible with the user's base role.",
  },
  ADMIN_BOUNDARY_ASSIGNED_ROLE_REQUIRES_ADMIN_BASE_ROLE: {
    title: "Admin base role required for this assignment",
    description: "Roles that cross the admin boundary can only be assigned to users with an admin base role.",
    action: "Set the user's base role to admin before assigning this role.",
  },
  MANAGED_ASSIGNED_ROLE_NOT_SUPPORTED: {
    title: "Managed role not supported",
    description: "This type of managed role assignment is not supported in the current configuration.",
    action: "Contact support if you need this role assignment.",
  },

  // ── Access scope ──────────────────────────────────────────────────────────────
  ACCESS_SCOPE_ACTION_INVALID: {
    title: "Invalid scope action",
    description: "The action specified for this access scope is not recognised.",
    action: "Choose a valid action from the allowed list.",
  },
  ACCESS_SCOPE_SUBJECT_REQUIRED: {
    title: "Scope subject required",
    description: "A subject (user or API key) must be specified for this access scope.",
    action: "Select a subject before saving the scope.",
  },
  ACCESS_SCOPE_DIMENSION_REQUIRES_ENFORCEMENT: {
    title: "Scope enforcement required",
    description: "This access scope dimension requires enforcement to be enabled.",
    action: "Enable enforcement for this dimension in the access policy settings.",
  },
  ACCESS_SCOPE_CATEGORY_REQUIRED: {
    title: "Category scope required",
    description: "This access policy requires a category to be specified.",
    action: "Select a category to scope this access rule.",
  },
  ACCESS_SCOPE_BRAND_REQUIRED: {
    title: "Brand scope required",
    description: "This access policy requires a brand to be specified.",
    action: "Enter a brand to scope this access rule.",
  },
  ACCESS_SCOPE_VENDOR_REQUIRED: {
    title: "Vendor scope required",
    description: "This access policy requires a vendor to be specified.",
    action: "Enter a vendor key to scope this access rule.",
  },
  ACCESS_SCOPE_CONNECTOR_ACCOUNT_REQUIRED: {
    title: "Connector account scope required",
    description: "This access policy requires a connector account to be specified.",
    action: "Select a connector account to scope this access rule.",
  },
  ACCESS_SCOPE_CATALOG_REQUIRED: {
    title: "Catalog scope required",
    description: "This access policy requires a catalog to be specified.",
    action: "Select a catalog to scope this access rule.",
  },

  // ── Billing / upgrade ─────────────────────────────────────────────────────────
  UPGRADE_REQUEST_STATUS_UPDATE_FAILED: {
    title: "Upgrade request update failed",
    description: "The status of the upgrade request could not be updated.",
    action: "Refresh the page and try again. If the problem persists, contact support.",
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
  const exact = ERROR_MAP[code];
  if (exact) {
    return exact;
  }

  // Dynamic compliance rule codes — generated from attribute/rule keys at runtime.
  if (code.startsWith("ATTR_REQUIRED_")) {
    const key = code.slice("ATTR_REQUIRED_".length).toLowerCase();
    return {
      title: "Required attribute missing",
      description: `The "${key}" attribute is required but has no value.`,
      action: `Add a value for "${key}" in the product editor's Attributes section.`,
    };
  }
  if (code.startsWith("ATTR_TYPE_")) {
    const key = code.slice("ATTR_TYPE_".length).toLowerCase();
    return {
      title: "Invalid attribute value",
      description: `The value for "${key}" is the wrong data type.`,
      action: `Correct the "${key}" value to match the expected format in the Attributes section.`,
    };
  }
  if (code.startsWith("ATTR_ALLOWED_")) {
    const key = code.slice("ATTR_ALLOWED_".length).toLowerCase();
    return {
      title: "Attribute value not in allowed list",
      description: `The value for "${key}" is not in the accepted options.`,
      action: `Choose one of the allowed values for "${key}" in the Attributes section.`,
    };
  }
  // Admin-configured compliance rules
  if (code.startsWith("RULE_")) {
    return {
      title: "Custom rule violation",
      description: "This product does not satisfy a configured compliance rule.",
      action: "Review the rule message and update the relevant field.",
    };
  }

  return {
    title: "Something went wrong",
    description: "An unexpected error occurred.",
    action: "Try again or contact support.",
  };
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
    "GST_HSN_REQUIRED",
    "GST_HSN_FORMAT",
    "GST_RATE_REQUIRED",
    "GST_RATE_UNCOMMON",
    "PRICING_NO_DEFAULT_PRICES",
    "PRICING_INCOMPLETE",
    "TAX_CODE_MISSING",
    "HS_CODE_MISSING",
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
    // Connector
    "CONNECTOR_LAUNCH_STAGE_PLANNED",
    "CONNECTOR_PRODUCT_TYPE_SCHEMA_UNSUPPORTED",
    "MEESHO_CREDENTIALS_INCOMPLETE",
    "CONNECTOR_PERMISSION_DENIED",
    "CONNECTOR_PERMISSION_INVALID_ROLE",
    "CONNECTOR_PERMISSION_USER_REQUIRED",
    "CONNECTOR_PERMISSION_USER_NOT_FOUND",
    "CONNECTOR_OAUTH_CALLBACK_UNSUPPORTED",
    "PRODUCT_TYPE_REQUIRED",
    // Auth / session
    "IP_RATE_LIMITED",
    "ACCOUNT_LOCKED",
    "TOKEN_REVOKED",
    "CREDENTIALS_CHANGED",
    "USER_INACTIVE",
    "USER_LOCKED",
    "CONSENT_REQUIRED",
    "DELETE_CONFIRMATION_REQUIRED",
    "AUTH_CREDENTIAL_MIGRATION_INCOMPLETE",
    "MFA_ENROLLMENT_REQUIRED",
    "MFA_IDENTITY_NOT_FOUND",
    "MFA_ENROLLMENT_NOT_STARTED",
    "MFA_NOT_ENABLED",
    // Signup
    "SIGNUP_RATE_LIMITED",
    "SIGNUP_INTERNAL_ERROR",
    // API key management
    "API_KEY_LABEL_REQUIRED",
    "API_KEY_ADMIN_ROLE_FORBIDDEN",
    "API_KEY_ID_REQUIRED",
    "API_KEY_NOT_FOUND",
    "API_KEY_EXPIRY_INVALID",
    "API_KEY_EXPIRY_IN_PAST",
    // User / RBAC management
    "ADMIN_ROLE_REQUIRES_ADMIN",
    "CANNOT_CHANGE_OWN_ROLE",
    "CANNOT_LOCK_SELF",
    "CANNOT_DEACTIVATE_SELF",
    "INVALID_ASSIGNED_ROLES",
    "MULTI_ASSIGNED_ROLE_SET_NOT_SUPPORTED",
    "ASSIGNED_ROLE_DOES_NOT_WIDEN_BASE_ROLE",
    "ADMIN_BOUNDARY_ASSIGNED_ROLE_REQUIRES_ADMIN_BASE_ROLE",
    "MANAGED_ASSIGNED_ROLE_NOT_SUPPORTED",
    // Access scope
    "ACCESS_SCOPE_ACTION_INVALID",
    "ACCESS_SCOPE_SUBJECT_REQUIRED",
    "ACCESS_SCOPE_DIMENSION_REQUIRES_ENFORCEMENT",
    "ACCESS_SCOPE_CATEGORY_REQUIRED",
    "ACCESS_SCOPE_BRAND_REQUIRED",
    "ACCESS_SCOPE_VENDOR_REQUIRED",
    "ACCESS_SCOPE_CONNECTOR_ACCOUNT_REQUIRED",
    "ACCESS_SCOPE_CATALOG_REQUIRED",
    // Billing / upgrade
    "UPGRADE_REQUEST_STATUS_UPDATE_FAILED",
    // Import row states
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

// CTO review remediation (CODE-004): bulk-edit previously used the shared
// translateJobStatus() above, which is phrased for imports ("Importing",
// "Import complete") — wrong copy for a bulk-edit operation in progress.
// Also needs its own "completed_with_errors" label now that apply() is
// queued and can finish partially failed.
export function translateBulkEditStatus(status: string): string {
  const map: Record<string, string> = {
    queued: "Waiting to start",
    processing: "Applying changes",
    completed: "Completed",
    completed_with_errors: "Completed with errors",
    failed: "Failed",
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
