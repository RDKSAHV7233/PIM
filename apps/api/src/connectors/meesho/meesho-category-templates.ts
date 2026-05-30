// apps/api/src/connectors/meesho/meesho-category-templates.ts
//
// Category-specific Excel template definitions for Meesho Supplier Panel upload.
//
// IMPORTANT — PO VERIFICATION REQUIRED BEFORE PRODUCTION:
//   Each template below was derived from the column structure documented in
//   RD-MEESHO-2. Column names must be verified against the actual template files
//   downloaded from: supplier.meesho.com → Catalog → Upload Catalog → Download Template.
//   Template version date is noted per category. Re-download and compare when:
//   (a) a seller reports upload rejection due to "invalid template", or
//   (b) more than 60 days have passed since last verification.
//
// CTO decision: local registry (same as Flipkart pattern). Meesho updates templates
// when category requirements change — the templateVerifiedAt date is the freshness signal.

export type MeeshoCategoryColumn = {
  /** Exact column header string used by Meesho Supplier Panel */
  header: string;
  /** Key into ProductPayload / variant attributes */
  key: string;
  /** Excel column width hint */
  width: number;
  /** If true, product fails validation when this field is empty */
  required: boolean;
  /** Max characters allowed; undefined = no documented limit */
  maxLength?: number;
  /** Allowed values for dropdown-type columns; undefined = free text */
  allowedValues?: string[];
};

export type MeeshoCategoryTemplate = {
  /** Meesho category slug (matches productType values used in PIM) */
  slug: string;
  /** Display name shown in Supplier Panel category selector */
  displayName: string;
  /**
   * ISO date of last template verification.
   * Show a staleness warning to operators when (today - templateVerifiedAt) > 60 days.
   */
  templateVerifiedAt: string;
  columns: MeeshoCategoryColumn[];
};

// ─── shared base columns (present in ALL Meesho category templates) ────────────

const BASE_COLUMNS: MeeshoCategoryColumn[] = [
  { header: "SKU ID",            key: "sku",            width: 20, required: true,  maxLength: 40 },
  { header: "Product Name",      key: "title",          width: 50, required: true,  maxLength: 70 },
  { header: "MRP",               key: "mrp",            width: 12, required: true  },
  { header: "Selling Price",     key: "sellingPrice",   width: 14, required: true  },
  { header: "Brand",             key: "brand",          width: 20, required: true  },
  { header: "HSN Code",          key: "hsnCode",        width: 14, required: true  },
  { header: "GST Rate (%)",      key: "gstRate",        width: 13, required: true,
    allowedValues: ["0", "5", "12", "18", "28"] },
  { header: "Country of Origin", key: "countryOfOrigin",width: 18, required: true  },
  { header: "Description",       key: "description",    width: 60, required: false, maxLength: 500 },
  { header: "Image URL 1",       key: "image1",         width: 60, required: true  },
  { header: "Image URL 2",       key: "image2",         width: 60, required: false },
  { header: "Image URL 3",       key: "image3",         width: 60, required: false },
  { header: "Image URL 4",       key: "image4",         width: 60, required: false },
  { header: "Image URL 5",       key: "image5",         width: 60, required: false },
];

// ─── category template registry ───────────────────────────────────────────────

export const MEESHO_CATEGORY_TEMPLATES: Record<string, MeeshoCategoryTemplate> = {

  // ── Kurtis ────────────────────────────────────────────────────────────────
  kurtis: {
    slug: "kurtis",
    displayName: "Kurtis",
    templateVerifiedAt: "2026-05-27",
    columns: [
      ...BASE_COLUMNS,
      { header: "Colour",    key: "colour",   width: 15, required: true,
        allowedValues: [
          "Red","Maroon","Pink","Peach","Orange","Yellow","Green","Olive","Teal",
          "Blue","Navy","Purple","Violet","White","Off-White","Ivory","Beige",
          "Brown","Grey","Black","Multi","Printed","Embroidered",
        ],
      },
      { header: "Size",      key: "size",     width: 12, required: true,
        allowedValues: ["XS","S","M","L","XL","XXL","XXXL","Free Size"],
      },
      { header: "Fabric",    key: "fabric",   width: 20, required: true,
        allowedValues: [
          "Cotton","Poly Cotton","Polyester","Rayon","Silk","Georgette","Crepe",
          "Chiffon","Net","Linen","Viscose","Chanderi","Khadi","Denim","Lycra",
          "Blended","Other",
        ],
      },
      { header: "Sleeve Type", key: "sleeveType", width: 18, required: false,
        allowedValues: ["Full Sleeve","Half Sleeve","3/4th Sleeve","Sleeveless","Cap Sleeve"],
      },
      { header: "Neckline",    key: "neckline",   width: 18, required: false,
        allowedValues: ["Round Neck","V Neck","Scoop Neck","Boat Neck","Square Neck","Collar","Mandarin Collar"],
      },
      { header: "Pattern",     key: "pattern",    width: 18, required: false,
        allowedValues: ["Solid","Printed","Embroidered","Striped","Checked","Floral","Geometric","Abstract","Tie & Dye","Ethnic"],
      },
      { header: "Occasion",    key: "occasion",   width: 18, required: false,
        allowedValues: ["Casual","Formal","Festive","Party","Wedding","Daily Wear"],
      },
    ],
  },

  // ── T-Shirts ──────────────────────────────────────────────────────────────
  tshirts: {
    slug: "tshirts",
    displayName: "T-Shirts",
    templateVerifiedAt: "2026-05-27",
    columns: [
      ...BASE_COLUMNS,
      { header: "Colour",    key: "colour",   width: 15, required: true,
        allowedValues: [
          "Red","Maroon","Pink","Orange","Yellow","Green","Teal","Blue","Navy",
          "Purple","White","Off-White","Beige","Brown","Grey","Black","Multi",
          "Printed","Graphic",
        ],
      },
      { header: "Size",      key: "size",     width: 12, required: true,
        allowedValues: ["XS","S","M","L","XL","XXL","XXXL"],
      },
      { header: "Fabric",    key: "fabric",   width: 20, required: true,
        allowedValues: [
          "Cotton","Poly Cotton","Polyester","Viscose","Lycra","Modal","Bamboo","Blended","Other",
        ],
      },
      { header: "Gender",    key: "gender",   width: 12, required: true,
        allowedValues: ["Men","Women","Unisex","Boys","Girls"],
      },
      { header: "Fit Type",  key: "fitType",  width: 15, required: false,
        allowedValues: ["Regular","Slim","Oversized","Relaxed"],
      },
      { header: "Sleeve Type", key: "sleeveType", width: 18, required: false,
        allowedValues: ["Full Sleeve","Half Sleeve","3/4th Sleeve","Sleeveless"],
      },
      { header: "Neck Type", key: "neckType", width: 15, required: false,
        allowedValues: ["Round Neck","V Neck","Polo","Henley","Scoop Neck"],
      },
      { header: "Pattern",   key: "pattern",  width: 18, required: false,
        allowedValues: ["Solid","Printed","Striped","Checked","Graphic","Embroidered","Tie & Dye"],
      },
    ],
  },

  // ── Sarees ────────────────────────────────────────────────────────────────
  sarees: {
    slug: "sarees",
    displayName: "Sarees",
    templateVerifiedAt: "2026-05-27",
    columns: [
      ...BASE_COLUMNS,
      { header: "Colour",    key: "colour",   width: 15, required: true,
        allowedValues: [
          "Red","Maroon","Pink","Peach","Orange","Yellow","Green","Olive","Teal",
          "Blue","Navy","Purple","Violet","White","Off-White","Ivory","Beige",
          "Brown","Grey","Black","Golden","Silver","Multi",
        ],
      },
      { header: "Fabric",    key: "fabric",   width: 20, required: true,
        allowedValues: [
          "Silk","Banarasi Silk","Kanjivaram Silk","Patola Silk","Chanderi Silk",
          "Cotton","Pure Cotton","Cotton Silk","Georgette","Chiffon","Crepe",
          "Net","Linen","Viscose","Satin","Organza","Tussar","Tant","Mysore Silk",
          "Pochampally","Ikkat","Blended","Other",
        ],
      },
      { header: "Saree Length (mtrs)", key: "sareeLength", width: 20, required: false,
        allowedValues: ["5.5","6","6.5","7","8","9"],
      },
      { header: "Blouse Piece",  key: "blousePiece",  width: 15, required: false,
        allowedValues: ["Yes","No"],
      },
      { header: "Blouse Length (mtrs)", key: "blouseLength", width: 20, required: false,
        allowedValues: ["0.8","0.9","1.0","1.2"],
      },
      { header: "Work",          key: "work",         width: 20, required: false,
        allowedValues: ["Zari","Embroidery","Printed","Plain","Handloom","Woven","Sequin","Stone Work","Bandhani"],
      },
      { header: "Occasion",      key: "occasion",     width: 18, required: false,
        allowedValues: ["Casual","Festive","Bridal","Party","Wedding","Daily Wear","Puja"],
      },
    ],
  },

  // ── Casual Shoes ──────────────────────────────────────────────────────────
  "casual-shoes": {
    slug: "casual-shoes",
    displayName: "Casual Shoes",
    templateVerifiedAt: "2026-05-27",
    columns: [
      ...BASE_COLUMNS,
      { header: "Colour",    key: "colour",   width: 15, required: true,
        allowedValues: [
          "Black","White","Brown","Tan","Beige","Grey","Navy","Blue","Red","Green",
          "Multi","Camouflage","Orange","Pink","Yellow",
        ],
      },
      { header: "Size (UK)", key: "shoeSize", width: 14, required: true,
        allowedValues: ["4","5","6","7","8","9","10","11","12","13"],
      },
      { header: "Gender",    key: "gender",   width: 12, required: true,
        allowedValues: ["Men","Women","Unisex","Boys","Girls"],
      },
      { header: "Upper Material", key: "upperMaterial", width: 20, required: false,
        allowedValues: ["Leather","Synthetic Leather","Canvas","Mesh","Textile","PU","Faux Leather"],
      },
      { header: "Sole Material",  key: "soleMaterial",  width: 20, required: false,
        allowedValues: ["Rubber","TPR","EVA","PU","Synthetic"],
      },
      { header: "Closure Type",   key: "closureType",   width: 18, required: false,
        allowedValues: ["Lace-Up","Slip-On","Velcro","Buckle","Hook & Loop"],
      },
      { header: "Toe Shape",      key: "toeShape",      width: 15, required: false,
        allowedValues: ["Round Toe","Square Toe","Pointed Toe","Open Toe"],
      },
    ],
  },

  // ── Leggings ──────────────────────────────────────────────────────────────
  leggings: {
    slug: "leggings",
    displayName: "Leggings",
    templateVerifiedAt: "2026-05-27",
    columns: [
      ...BASE_COLUMNS,
      { header: "Colour",    key: "colour",   width: 15, required: true,
        allowedValues: [
          "Black","Navy","White","Grey","Brown","Red","Maroon","Green","Blue","Teal",
          "Pink","Purple","Beige","Multi","Printed",
        ],
      },
      { header: "Size",      key: "size",     width: 12, required: true,
        allowedValues: ["XS","S","M","L","XL","XXL","XXXL","Free Size"],
      },
      { header: "Fabric",    key: "fabric",   width: 20, required: true,
        allowedValues: [
          "Cotton","Poly Cotton","Polyester","Viscose","Lycra","Modal","Nylon","Blended","Other",
        ],
      },
      { header: "Length",    key: "leggingsLength", width: 15, required: false,
        allowedValues: ["Full Length","3/4 Length","Ankle Length","Capri","Short"],
      },
      { header: "Waist Type", key: "waistType", width: 15, required: false,
        allowedValues: ["Elastic Waist","Drawstring","High Waist","Mid Waist","Low Rise"],
      },
      { header: "Pattern",   key: "pattern",  width: 18, required: false,
        allowedValues: ["Solid","Printed","Striped","Floral","Geometric","Tie & Dye"],
      },
    ],
  },

  // ── Home Decor ────────────────────────────────────────────────────────────
  "home-decor": {
    slug: "home-decor",
    displayName: "Home Decor",
    templateVerifiedAt: "2026-05-27",
    columns: [
      ...BASE_COLUMNS,
      { header: "Colour",    key: "colour",   width: 15, required: false,
        allowedValues: [
          "White","Off-White","Beige","Brown","Black","Grey","Golden","Silver",
          "Blue","Green","Red","Pink","Multi","Wooden","Natural",
        ],
      },
      { header: "Material",  key: "material", width: 20, required: true,
        allowedValues: [
          "Wood","MDF","Metal","Iron","Brass","Ceramic","Glass","Plastic","Resin",
          "Jute","Cotton","Polyester","Bamboo","Marble","Terracotta","Paper","Other",
        ],
      },
      { header: "Room Type", key: "roomType", width: 18, required: false,
        allowedValues: [
          "Living Room","Bedroom","Kitchen","Bathroom","Dining Room","Study Room",
          "Garden","Balcony","Office","Kids Room","Entrance","All Rooms",
        ],
      },
      { header: "Dimensions (LxWxH cm)", key: "dimensions", width: 24, required: false },
      { header: "Pack of",   key: "packOf",   width: 12, required: false,
        allowedValues: ["1","2","3","4","5","6","Set of 4","Set of 6"],
      },
      { header: "Assembly Required", key: "assemblyRequired", width: 20, required: false,
        allowedValues: ["Yes","No"],
      },
    ],
  },
};

// ─── generic fallback template ─────────────────────────────────────────────────

export const MEESHO_GENERIC_TEMPLATE: MeeshoCategoryTemplate = {
  slug: "general",
  displayName: "General",
  templateVerifiedAt: "2026-05-27",
  columns: [
    ...BASE_COLUMNS,
    { header: "Colour",   key: "colour",   width: 15, required: false },
    { header: "Size",     key: "size",     width: 10, required: false },
    { header: "Material", key: "material", width: 20, required: false },
  ],
};

// ─── lookup helpers ────────────────────────────────────────────────────────────

/**
 * Return the Meesho category template for a given productType slug.
 * Case-insensitive. Falls back to MEESHO_GENERIC_TEMPLATE for unmapped categories.
 *
 * Normalisation: "Kurtis", "KURTIS", "kurtis" → same template.
 * Also handles PIM productType slugs that may use underscores or spaces:
 *   "casual_shoes" → "casual-shoes", "T Shirts" → "tshirts"
 */
export function getMeeshoCategoryTemplate(productType: string): MeeshoCategoryTemplate {
  if (!productType || typeof productType !== "string") {
    return MEESHO_GENERIC_TEMPLATE;
  }
  const normalised = productType
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")      // "casual shoes" → "casual-shoes"
    .replace(/_/g, "-")        // "casual_shoes" → "casual-shoes"
    .replace(/[^a-z0-9-]/g, ""); // strip non-slug chars

  // Direct match
  if (MEESHO_CATEGORY_TEMPLATES[normalised]) {
    return MEESHO_CATEGORY_TEMPLATES[normalised];
  }

  // Aliases for common PIM productType values
  const SLUG_ALIASES: Record<string, string> = {
    "kurti":          "kurtis",
    "kurta":          "kurtis",
    "t-shirt":        "tshirts",
    "tshirt":         "tshirts",
    "t-shirts":       "tshirts",
    "shirt":          "tshirts",
    "saree":          "sarees",
    "sari":           "sarees",
    "shoes":          "casual-shoes",
    "footwear":       "casual-shoes",
    "sneakers":       "casual-shoes",
    "legging":        "leggings",
    "home":           "home-decor",
    "homedecor":      "home-decor",
    "home-decoration":"home-decor",
    "decor":          "home-decor",
  };

  const aliasKey = SLUG_ALIASES[normalised];
  if (aliasKey && MEESHO_CATEGORY_TEMPLATES[aliasKey]) {
    return MEESHO_CATEGORY_TEMPLATES[aliasKey];
  }

  return MEESHO_GENERIC_TEMPLATE;
}

/**
 * Returns true if the template is potentially stale (last verified > 60 days ago).
 */
export function isMeeshoTemplateStale(template: MeeshoCategoryTemplate): boolean {
  const STALE_THRESHOLD_DAYS = 60;
  const verifiedAt = new Date(template.templateVerifiedAt);
  const daysSince = (Date.now() - verifiedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince > STALE_THRESHOLD_DAYS;
}

/**
 * Sorted list of all supported category slugs (for validation UI and dropdowns).
 */
export function getMeeshoSupportedCategorySlugs(): string[] {
  return Object.keys(MEESHO_CATEGORY_TEMPLATES).sort();
}
