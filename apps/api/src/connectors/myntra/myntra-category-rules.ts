// apps/api/src/connectors/myntra/myntra-category-rules.ts
//
// Fashion attribute validation rules for Myntra Listing Management.
//
// IMPORTANT — PARTNER CONFIRMATION REQUIRED BEFORE PRODUCTION:
//   Column names and allowed-value enumerations below are derived from
//   Myntra's publicly available seller guidelines and third-party integration
//   documentation (Vinculum, Base PPMP guide). They must be verified against
//   the actual Listing Management API schema obtained during the Myntra
//   account-manager kickoff (gate ST-MYNTRA-001).
//   Update templateVerifiedAt and allowedValues once the Postman collection
//   and sandbox are available.

export type MyntraCategoryField = {
  fieldPath: string;
  label: string;
  required: boolean;
  maxLength?: number;
  allowedValues?: string[];
  sellerMessage: string;
};

export type MyntraCategoryRule = {
  slug: string;
  displayName: string;
  templateVerifiedAt: string;
  fields: MyntraCategoryField[];
};

// ─── shared base fields (required for all Myntra categories) ──────────────────

const BASE_FIELDS: MyntraCategoryField[] = [
  {
    fieldPath: 'sku',
    label: 'Style ID / SKU',
    required: true,
    maxLength: 40,
    sellerMessage: 'Style ID is required for all Myntra listings.',
  },
  {
    fieldPath: 'title',
    label: 'Product Name',
    required: true,
    maxLength: 500,
    sellerMessage: 'Product name is required.',
  },
  {
    fieldPath: 'brand',
    label: 'Brand',
    required: true,
    sellerMessage: 'Brand is required and must match an approved Myntra brand name.',
  },
  {
    fieldPath: 'mrp',
    label: 'MRP',
    required: true,
    sellerMessage: 'MRP is required and must be a positive number.',
  },
  {
    fieldPath: 'sellingPrice',
    label: 'Selling Price',
    required: true,
    sellerMessage: 'Selling price is required.',
  },
  {
    fieldPath: 'hsnCode',
    label: 'HSN Code',
    required: true,
    sellerMessage: 'HSN code is required for all Myntra listings (6–8 digits).',
  },
  {
    fieldPath: 'mainImageUrl',
    label: 'Primary Image URL',
    required: true,
    sellerMessage: 'Primary product image URL is required (HTTPS, square 1:1, min 1000×1000px recommended).',
  },
  {
    fieldPath: 'description',
    label: 'Product Description',
    required: true,
    maxLength: 5000,
    sellerMessage: 'Product description is required.',
  },
  {
    fieldPath: 'countryOfOrigin',
    label: 'Country of Origin',
    required: true,
    sellerMessage: 'Country of origin is required.',
  },
];

// ─── category-specific rule registry ──────────────────────────────────────────

// [NEEDS_PARTNER_CONFIRMATION] — colour/size allowedValues below are indicative.
// Obtain the exact accepted-values list from the Myntra Listing Management API
// (endpoint: GET /listing-api/v2/category-attributes?categoryId={id}) during onboarding.

export const MYNTRA_CATEGORY_RULES: Record<string, MyntraCategoryRule> = {

  // ── Apparel (tops, kurtis, shirts, t-shirts) ──────────────────────────────
  apparel: {
    slug: 'apparel',
    displayName: 'Apparel',
    templateVerifiedAt: '2026-06-11', // [NEEDS_PARTNER_CONFIRMATION]
    fields: [
      ...BASE_FIELDS,
      {
        fieldPath: 'attributes.gender',
        label: 'Gender',
        required: true,
        allowedValues: ['Men', 'Women', 'Boys', 'Girls', 'Unisex', 'Kids'],
        sellerMessage: 'Gender is required for apparel listings on Myntra.',
      },
      {
        fieldPath: 'attributes.colour',
        label: 'Colour',
        required: true,
        allowedValues: [
          'Red', 'Maroon', 'Burgundy', 'Pink', 'Rose', 'Peach', 'Orange', 'Coral',
          'Yellow', 'Gold', 'Mustard', 'Lime', 'Green', 'Olive', 'Teal', 'Mint',
          'Blue', 'Navy', 'Royal Blue', 'Sky Blue', 'Indigo', 'Purple', 'Violet',
          'Lavender', 'White', 'Off White', 'Ivory', 'Cream', 'Beige', 'Khaki',
          'Brown', 'Rust', 'Tan', 'Copper', 'Silver', 'Grey', 'Charcoal',
          'Black', 'Multi', 'Printed', 'Tie-Dye',
        ],
        sellerMessage: 'Colour is required for apparel listings on Myntra.',
      },
      {
        fieldPath: 'attributes.size',
        label: 'Size',
        required: true,
        allowedValues: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', 'Free Size'],
        sellerMessage: 'Size is required for apparel listings on Myntra.',
      },
      {
        fieldPath: 'attributes.fabric',
        label: 'Fabric',
        required: false,
        allowedValues: [
          'Cotton', 'Polyester', 'Silk', 'Chiffon', 'Georgette', 'Rayon',
          'Linen', 'Denim', 'Velvet', 'Satin', 'Viscose', 'Nylon',
          'Wool', 'Blended', 'Synthetic',
        ],
        sellerMessage: 'Fabric type is recommended for apparel listings.',
      },
      {
        fieldPath: 'attributes.fitType',
        label: 'Fit',
        required: false,
        allowedValues: ['Regular', 'Slim', 'Loose', 'Oversized', 'Relaxed', 'Bodycon'],
        sellerMessage: 'Fit type is recommended.',
      },
      {
        fieldPath: 'attributes.occasion',
        label: 'Occasion',
        required: false,
        allowedValues: ['Casual', 'Formal', 'Ethnic', 'Party', 'Festive', 'Sports', 'Beach', 'Lounge'],
        sellerMessage: 'Occasion helps buyers discover your product on Myntra.',
      },
      {
        fieldPath: 'attributes.styleCode',
        label: 'Style Code',
        required: false,
        maxLength: 50,
        sellerMessage: 'Unique style code for identifying this variant.',
      },
    ],
  },

  // ── Footwear ──────────────────────────────────────────────────────────────
  footwear: {
    slug: 'footwear',
    displayName: 'Footwear',
    templateVerifiedAt: '2026-06-11', // [NEEDS_PARTNER_CONFIRMATION]
    fields: [
      ...BASE_FIELDS,
      {
        fieldPath: 'attributes.gender',
        label: 'Gender',
        required: true,
        allowedValues: ['Men', 'Women', 'Boys', 'Girls', 'Unisex', 'Kids'],
        sellerMessage: 'Gender is required for footwear listings on Myntra.',
      },
      {
        fieldPath: 'attributes.colour',
        label: 'Colour',
        required: true,
        allowedValues: [
          'Black', 'Brown', 'Tan', 'White', 'Beige', 'Grey', 'Navy', 'Red',
          'Pink', 'Blue', 'Green', 'Multi', 'Gold', 'Silver', 'Copper',
        ],
        sellerMessage: 'Colour is required for footwear on Myntra.',
      },
      {
        fieldPath: 'attributes.shoeSize',
        label: 'Shoe Size (UK)',
        required: true,
        allowedValues: ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'],
        sellerMessage: 'Shoe size (UK) is required for footwear listings.',
      },
      {
        fieldPath: 'attributes.closureType',
        label: 'Closure',
        required: false,
        allowedValues: ['Lace-Up', 'Slip-On', 'Velcro', 'Buckle', 'Zip', 'Hook'],
        sellerMessage: 'Closure type helps buyers compare footwear options.',
      },
    ],
  },

  // ── Ethnic wear (sarees, lehengas, suits) ─────────────────────────────────
  'ethnic-wear': {
    slug: 'ethnic-wear',
    displayName: 'Ethnic Wear',
    templateVerifiedAt: '2026-06-11', // [NEEDS_PARTNER_CONFIRMATION]
    fields: [
      ...BASE_FIELDS,
      {
        fieldPath: 'attributes.gender',
        label: 'Gender',
        required: true,
        allowedValues: ['Women', 'Men', 'Girls', 'Boys'],
        sellerMessage: 'Gender is required for ethnic wear listings.',
      },
      {
        fieldPath: 'attributes.colour',
        label: 'Colour',
        required: true,
        allowedValues: [
          'Red', 'Maroon', 'Burgundy', 'Pink', 'Peach', 'Orange', 'Yellow',
          'Gold', 'Green', 'Teal', 'Blue', 'Navy', 'Purple', 'Violet',
          'White', 'Off White', 'Ivory', 'Cream', 'Beige', 'Brown', 'Rust',
          'Black', 'Grey', 'Multi', 'Printed',
        ],
        sellerMessage: 'Colour is required for ethnic wear on Myntra.',
      },
      {
        fieldPath: 'attributes.fabric',
        label: 'Fabric',
        required: true,
        allowedValues: [
          'Cotton', 'Silk', 'Banarasi Silk', 'Chiffon', 'Georgette', 'Crepe',
          'Net', 'Organza', 'Satin', 'Velvet', 'Tissue', 'Khadi', 'Linen',
          'Art Silk', 'Rayon', 'Polyester Silk', 'Blended',
        ],
        sellerMessage: 'Fabric is required for ethnic wear listings on Myntra.',
      },
      {
        fieldPath: 'attributes.occasion',
        label: 'Occasion',
        required: true,
        allowedValues: ['Casual', 'Festive', 'Wedding', 'Party', 'Traditional', 'Office'],
        sellerMessage: 'Occasion is required for ethnic wear on Myntra.',
      },
      {
        fieldPath: 'attributes.sareeLength',
        label: 'Saree Length (m)',
        required: false,
        allowedValues: ['5.5', '6', '6.5', '7', '7.5', '8', '9'],
        sellerMessage: 'Saree length (in metres) — required for saree sub-category.',
      },
    ],
  },
};

// ─── resolver ─────────────────────────────────────────────────────────────────

const DEFAULT_RULE: MyntraCategoryRule = {
  slug: 'default',
  displayName: 'Default',
  templateVerifiedAt: '2026-06-11',
  fields: BASE_FIELDS,
};

export function getMyntraCategoryRule(productType: string): MyntraCategoryRule {
  const key = String(productType ?? '').trim().toLowerCase();
  return MYNTRA_CATEGORY_RULES[key] ?? DEFAULT_RULE;
}
