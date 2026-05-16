// test/fixtures/products.ts
// Known-good and known-bad product fixtures used in integration tests and smoke tests.
// These fixtures must produce predictable results against Amazon sandbox.

import { ProductPayload } from '../../src/connector-framework/connector.interface';

/** Valid apparel product — should pass validation on all connectors */
export const VALID_APPAREL_PRODUCT: ProductPayload = {
  sku: 'TEST-APPAREL-001',
  title: 'Cotton Kurti for Women - Blue - M',
  description: 'Comfortable cotton kurti suitable for daily wear. Machine washable.',
  brand: 'TestBrand',
  hsnCode: '62044200',
  gstRate: 5,
  mrp: 999,
  sellingPrice: 799,
  mainImageUrl: 'https://your-cdn.example.com/test/apparel-001.jpg', // replace with real CDN URL
  // Sprint A fields — required by Amazon local validation (Sprint B)
  countryOfOrigin: 'India',
  condition: 'new',
  bulletPoints: [
    'Comfortable 100% cotton fabric suitable for daily wear',
    'Machine washable — easy care',
    'Available in multiple sizes',
  ],
  attributes: {
    color: 'Blue',
    material: 'Cotton',  // renamed from 'fabric' — Amazon requires attributes.material
    size: 'M',
    fabric: 'Cotton',    // kept for backward compatibility with non-Amazon connectors
    pattern: 'Solid',
    occasion: 'Casual',
    fit: 'Regular',
    countryOfOrigin: 'India', // kept in attributes for Flipkart/Meesho; top-level used by Amazon
  },
  productType: 'SHIRT', // Amazon product type — check SP-API definition catalogue
};

/** Product missing required image — should fail validation */
export const MISSING_IMAGE_PRODUCT: ProductPayload = {
  ...VALID_APPAREL_PRODUCT,
  sku: 'TEST-MISSING-IMAGE-001',
  mainImageUrl: '', // empty — should trigger validation error
};

/** Product missing title — should fail validation */
export const MISSING_TITLE_PRODUCT: ProductPayload = {
  ...VALID_APPAREL_PRODUCT,
  sku: 'TEST-MISSING-TITLE-001',
  title: '', // empty — should trigger validation error
};

/** Product with invalid HSN code — should fail compliance check */
export const INVALID_HSN_PRODUCT: ProductPayload = {
  ...VALID_APPAREL_PRODUCT,
  sku: 'TEST-INVALID-HSN-001',
  hsnCode: '00000000', // invalid — should fail GST/HSN rule
};

/** Meesho-specific: product for Excel export test */
export const MEESHO_EXPORT_PRODUCT: ProductPayload = {
  ...VALID_APPAREL_PRODUCT,
  sku: 'TEST-MEESHO-001',
  title: 'Cotton Kurti Blue M', // Meesho: max 70 chars
  attributes: {
    ...VALID_APPAREL_PRODUCT.attributes,
    meeshoCategory: 'Kurtis', // Meesho-specific category attribute
  },
};

// ─────────────────────────────────────────────
// SMOKE TENANT CONFIG
// ─────────────────────────────────────────────

export const SMOKE_TENANT_ID = 'smoke_tenant_test'; // must match seed data
export const SMOKE_CONNECTOR_SLUGS = ['amazon-in', 'flipkart', 'meesho'] as const;
