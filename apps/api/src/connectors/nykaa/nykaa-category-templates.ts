// apps/api/src/connectors/nykaa/nykaa-category-templates.ts
import { ProductTypeSchema } from '../../connector-framework/connector.interface';
//
// Category-specific Excel template definitions for Nykaa Seller Portal upload.
//
// IMPORTANT — PO VERIFICATION REQUIRED BEFORE PRODUCTION:
//   Column headers and allowed values below are derived from publicly available
//   Nykaa seller guidelines and third-party integration documentation (Fynd, EasyEcom).
//   They MUST be verified against the actual XLSX templates downloaded from a real
//   Nykaa seller account (seller.nykaa.com → Catalogue Management → Catalogue Upload →
//   Download Template) before any seller uses this connector in production.
//   Update templateVerifiedAt and columns when real templates arrive (gate ST-NYKAA-001).

export type NykaaCategoryColumn = {
  header: string;
  key: string;
  width: number;
  required: boolean;
  maxLength?: number;
  allowedValues?: string[];
};

export type NykaaCategoryTemplate = {
  slug: string;
  displayName: string;
  templateVerifiedAt: string;
  columns: NykaaCategoryColumn[];
};

// ─── shared base columns (present in all Nykaa category templates) ────────────

const BASE_COLUMNS: NykaaCategoryColumn[] = [
  { header: 'Seller SKU',          key: 'sku',            width: 24, required: true,  maxLength: 64 },
  { header: 'Product Name',        key: 'title',          width: 60, required: true,  maxLength: 255 },
  { header: 'Brand',               key: 'brand',          width: 22, required: true  },
  { header: 'MRP (INR)',           key: 'mrp',            width: 14, required: true  },
  { header: 'Selling Price (INR)', key: 'sellingPrice',   width: 18, required: true  },
  { header: 'HSN Code',            key: 'hsnCode',        width: 14, required: true  },
  { header: 'GST Rate (%)',        key: 'gstRate',        width: 13, required: true,
    allowedValues: ['0', '5', '12', '18', '28'] },
  { header: 'Country of Origin',   key: 'countryOfOrigin',width: 18, required: true  },
  { header: 'Product Description', key: 'description',    width: 70, required: true,  maxLength: 5000 },
  { header: 'Image URL 1',         key: 'image1',         width: 70, required: true  },
  { header: 'Image URL 2',         key: 'image2',         width: 70, required: false },
  { header: 'Image URL 3',         key: 'image3',         width: 70, required: false },
  { header: 'Image URL 4',         key: 'image4',         width: 70, required: false },
  { header: 'Image URL 5',         key: 'image5',         width: 70, required: false },
];

// ─── category template registry ───────────────────────────────────────────────

export const NYKAA_CATEGORY_TEMPLATES: Record<string, NykaaCategoryTemplate> = {

  // ── Lipsticks / Lip Colour ────────────────────────────────────────────────
  lipstick: {
    slug: 'lipstick',
    displayName: 'Lipstick / Lip Colour',
    templateVerifiedAt: '2026-06-11', // [NEEDS_PO_VERIFICATION from real seller account]
    columns: [
      ...BASE_COLUMNS,
      {
        header: 'Shade Name',
        key: 'shadeName',
        width: 24,
        required: true,
        sellerMessage: 'Shade name is required for lip colour listings.',
      } as NykaaCategoryColumn,
      {
        header: 'Shade Number',
        key: 'shadeNumber',
        width: 18,
        required: false,
        maxLength: 20,
      },
      {
        header: 'Finish',
        key: 'finish',
        width: 16,
        required: true,
        allowedValues: ['Matte', 'Glossy', 'Satin', 'Sheer', 'Metallic', 'Velvet', 'Creamy', 'Glitter'],
      },
      {
        header: 'Net Weight / Volume',
        key: 'netWeight',
        width: 20,
        required: true,
      },
      {
        header: 'Skin Type',
        key: 'skinType',
        width: 18,
        required: false,
        allowedValues: ['All Skin Types', 'Dry', 'Oily', 'Combination', 'Sensitive', 'Normal'],
      },
      {
        header: 'Formulation',
        key: 'formulation',
        width: 18,
        required: false,
        allowedValues: ['Organic', 'Vegan', 'Cruelty-Free', 'Paraben-Free', 'Sulphate-Free', 'Regular'],
      },
      {
        header: 'Shelf Life (months)',
        key: 'shelfLife',
        width: 20,
        required: true,
      },
    ],
  },

  // ── Foundation / Concealer ────────────────────────────────────────────────
  foundation: {
    slug: 'foundation',
    displayName: 'Foundation / Concealer',
    templateVerifiedAt: '2026-06-11', // [NEEDS_PO_VERIFICATION from real seller account]
    columns: [
      ...BASE_COLUMNS,
      {
        header: 'Shade Name',
        key: 'shadeName',
        width: 24,
        required: true,
      } as NykaaCategoryColumn,
      {
        header: 'Coverage',
        key: 'coverage',
        width: 18,
        required: true,
        allowedValues: ['Full', 'Medium', 'Light', 'Buildable'],
      },
      {
        header: 'Finish',
        key: 'finish',
        width: 16,
        required: true,
        allowedValues: ['Matte', 'Dewy', 'Natural', 'Luminous', 'Satin', 'Radiant'],
      },
      {
        header: 'Skin Type',
        key: 'skinType',
        width: 18,
        required: true,
        allowedValues: ['All Skin Types', 'Dry', 'Oily', 'Combination', 'Sensitive', 'Normal'],
      },
      {
        header: 'Formulation',
        key: 'formulation',
        width: 18,
        required: false,
        allowedValues: ['Organic', 'Vegan', 'Cruelty-Free', 'Paraben-Free', 'Sulphate-Free', 'Regular'],
      },
      {
        header: 'SPF',
        key: 'spf',
        width: 12,
        required: false,
      } as NykaaCategoryColumn,
      {
        header: 'Net Weight / Volume',
        key: 'netWeight',
        width: 20,
        required: true,
      } as NykaaCategoryColumn,
      {
        header: 'Shelf Life (months)',
        key: 'shelfLife',
        width: 20,
        required: true,
      } as NykaaCategoryColumn,
    ],
  },

  // ── Skincare (moisturiser, serum, sunscreen) ───────────────────────────────
  skincare: {
    slug: 'skincare',
    displayName: 'Skincare',
    templateVerifiedAt: '2026-06-11', // [NEEDS_PO_VERIFICATION from real seller account]
    columns: [
      ...BASE_COLUMNS,
      {
        header: 'Product Type',
        key: 'productSubtype',
        width: 22,
        required: true,
        allowedValues: [
          'Moisturiser', 'Serum', 'Sunscreen', 'Face Wash', 'Toner',
          'Exfoliator', 'Eye Cream', 'Lip Balm', 'Sheet Mask', 'Peel-Off Mask',
          'Night Cream', 'Day Cream', 'BB Cream', 'CC Cream',
        ],
      } as NykaaCategoryColumn,
      {
        header: 'Skin Type',
        key: 'skinType',
        width: 18,
        required: true,
        allowedValues: ['All Skin Types', 'Dry', 'Oily', 'Combination', 'Sensitive', 'Normal', 'Acne-Prone'],
      },
      {
        header: 'Key Ingredients',
        key: 'keyIngredients',
        width: 40,
        required: false,
        maxLength: 500,
      } as NykaaCategoryColumn,
      {
        header: 'Formulation',
        key: 'formulation',
        width: 20,
        required: false,
        allowedValues: ['Organic', 'Vegan', 'Cruelty-Free', 'Paraben-Free', 'Sulphate-Free', 'Fragrance-Free', 'Regular'],
      },
      {
        header: 'SPF',
        key: 'spf',
        width: 12,
        required: false,
      } as NykaaCategoryColumn,
      {
        header: 'Net Weight / Volume',
        key: 'netWeight',
        width: 20,
        required: true,
      } as NykaaCategoryColumn,
      {
        header: 'Shelf Life (months)',
        key: 'shelfLife',
        width: 20,
        required: true,
      } as NykaaCategoryColumn,
    ],
  },

  // ── Haircare (shampoo, conditioner, hair oil) ─────────────────────────────
  haircare: {
    slug: 'haircare',
    displayName: 'Haircare',
    templateVerifiedAt: '2026-06-11', // [NEEDS_PO_VERIFICATION from real seller account]
    columns: [
      ...BASE_COLUMNS,
      {
        header: 'Product Type',
        key: 'productSubtype',
        width: 22,
        required: true,
        allowedValues: [
          'Shampoo', 'Conditioner', 'Hair Oil', 'Hair Serum', 'Hair Mask',
          'Hair Colour', 'Hair Spray', 'Dry Shampoo', 'Leave-In Conditioner',
          'Scalp Treatment', 'Hair Gel', 'Hair Wax',
        ],
      } as NykaaCategoryColumn,
      {
        header: 'Hair Type',
        key: 'hairType',
        width: 20,
        required: true,
        allowedValues: ['All Hair Types', 'Dry', 'Oily', 'Normal', 'Curly', 'Damaged', 'Colour-Treated', 'Fine', 'Thick'],
      },
      {
        header: 'Formulation',
        key: 'formulation',
        width: 20,
        required: false,
        allowedValues: ['Organic', 'Vegan', 'Cruelty-Free', 'Paraben-Free', 'Sulphate-Free', 'Regular'],
      },
      {
        header: 'Key Ingredients',
        key: 'keyIngredients',
        width: 40,
        required: false,
        maxLength: 500,
      } as NykaaCategoryColumn,
      {
        header: 'Net Weight / Volume',
        key: 'netWeight',
        width: 20,
        required: true,
      } as NykaaCategoryColumn,
      {
        header: 'Shelf Life (months)',
        key: 'shelfLife',
        width: 20,
        required: true,
      } as NykaaCategoryColumn,
    ],
  },

  // ── Personal Care (body wash, deodorant, intimate hygiene) ────────────────
  'personal-care': {
    slug: 'personal-care',
    displayName: 'Personal Care',
    templateVerifiedAt: '2026-06-11', // [NEEDS_PO_VERIFICATION from real seller account]
    columns: [
      ...BASE_COLUMNS,
      {
        header: 'Product Type',
        key: 'productSubtype',
        width: 24,
        required: true,
        allowedValues: [
          'Body Wash', 'Body Lotion', 'Deodorant', 'Antiperspirant', 'Body Scrub',
          'Body Oil', 'Hand Cream', 'Foot Cream', 'Intimate Wash', 'Sanitiser',
          'Soap', 'Shower Gel', 'Bath Salt',
        ],
      } as NykaaCategoryColumn,
      {
        header: 'Skin Type',
        key: 'skinType',
        width: 18,
        required: false,
        allowedValues: ['All Skin Types', 'Dry', 'Oily', 'Combination', 'Sensitive', 'Normal'],
      },
      {
        header: 'Fragrance',
        key: 'fragrance',
        width: 20,
        required: false,
        allowedValues: ['Floral', 'Fruity', 'Musky', 'Woody', 'Fresh', 'Citrus', 'Unscented', 'Fragrance-Free'],
      },
      {
        header: 'Formulation',
        key: 'formulation',
        width: 20,
        required: false,
        allowedValues: ['Organic', 'Vegan', 'Cruelty-Free', 'Paraben-Free', 'Sulphate-Free', 'Regular'],
      },
      {
        header: 'Net Weight / Volume',
        key: 'netWeight',
        width: 20,
        required: true,
      } as NykaaCategoryColumn,
      {
        header: 'Shelf Life (months)',
        key: 'shelfLife',
        width: 20,
        required: true,
      } as NykaaCategoryColumn,
    ],
  },
};

// ─── resolver ─────────────────────────────────────────────────────────────────

const DEFAULT_TEMPLATE: NykaaCategoryTemplate = {
  slug: 'default',
  displayName: 'Beauty & Personal Care',
  templateVerifiedAt: '2026-06-11',
  columns: [
    ...BASE_COLUMNS,
    {
      header: 'Net Weight / Volume',
      key: 'netWeight',
      width: 20,
      required: true,
    } as NykaaCategoryColumn,
    {
      header: 'Shelf Life (months)',
      key: 'shelfLife',
      width: 20,
      required: true,
    } as NykaaCategoryColumn,
  ],
};

export function getNykaaCategoryTemplate(productType: string): NykaaCategoryTemplate {
  const key = String(productType ?? '').trim().toLowerCase();
  return NYKAA_CATEGORY_TEMPLATES[key] ?? DEFAULT_TEMPLATE;
}

export function isNykaaTemplateStale(template: NykaaCategoryTemplate): boolean {
  const verifiedAt = new Date(template.templateVerifiedAt);
  const staleAfterMs = 60 * 24 * 60 * 60 * 1000; // 60 days
  return Date.now() - verifiedAt.getTime() > staleAfterMs;
}

// ─── ADR-0008 §1 bridge ───────────────────────────────────────────────────────

export function templateToProductTypeSchema(template: NykaaCategoryTemplate): ProductTypeSchema {
  const requiredAttributes = template.columns.filter((c) => c.required).map((c) => c.key);
  const optionalAttributes = template.columns.filter((c) => !c.required).map((c) => c.key);
  const validValues: Record<string, string[]> = {};
  for (const col of template.columns) {
    if (col.allowedValues && col.allowedValues.length > 0) {
      validValues[col.key] = col.allowedValues;
    }
  }
  return {
    productType: template.slug,
    requiredAttributes,
    optionalAttributes,
    validValues,
    schemaVersion: `LOCAL-${template.templateVerifiedAt}`,
  };
}
