/**
 * Canonical connector slug constants.
 *
 * Use these instead of inline string literals so a typo is caught at compile time
 * and a rename only needs to happen in one place.
 */
export const CONNECTOR_SLUGS = {
  AMAZON: "amazon-in",
  FLIPKART: "flipkart",
  MEESHO: "meesho",
  MYNTRA: "myntra",
  NYKAA: "nykaa",
  ODOO: "odoo",
  SHOPIFY: "shopify",
  WOOCOMMERCE: "woocommerce",
} as const;

export type ConnectorSlug = (typeof CONNECTOR_SLUGS)[keyof typeof CONNECTOR_SLUGS];
