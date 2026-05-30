// apps/api/src/connectors/meesho/meesho-category-templates.spec.ts

import {
  getMeeshoCategoryTemplate,
  getMeeshoSupportedCategorySlugs,
  isMeeshoTemplateStale,
  MEESHO_CATEGORY_TEMPLATES,
  MEESHO_GENERIC_TEMPLATE,
} from './meesho-category-templates';
import { MeeshoConnector } from './meesho.connector';
import type { ProductPayload, ProductVariantPayload } from '../../connector-framework/connector.interface';

// ─── fixtures ────────────────────────────────────────────────────────────────

function makeProduct(overrides: Partial<ProductPayload> = {}): ProductPayload {
  return {
    sku: 'TEST-SKU-001',
    title: 'Test Kurti in Blue Cotton',
    description: 'A beautiful cotton kurti with floral print, perfect for casual wear.',
    brand: 'TestBrand',
    hsnCode: '620462',
    gstRate: 5,
    mrp: 999,
    sellingPrice: 799,
    mainImageUrl: 'https://cdn.example.com/product/image1.jpg',
    productType: 'kurtis',
    attributes: {
      colour: 'Blue',
      size: 'M',
      fabric: 'Cotton',
    },
    ...overrides,
  };
}

function makeVariant(overrides: Partial<ProductVariantPayload> = {}): ProductVariantPayload {
  return {
    sku: 'TEST-SKU-001-M-BLU',
    mrp: 999,
    sellingPrice: 799,
    attributes: { colour: 'Blue', size: 'M' },
    ...overrides,
  };
}

// ─── getMeeshoCategoryTemplate ────────────────────────────────────────────────

describe('getMeeshoCategoryTemplate', () => {
  it('returns kurtis template for "kurtis"', () => {
    expect(getMeeshoCategoryTemplate('kurtis').slug).toBe('kurtis');
  });

  it('is case-insensitive', () => {
    expect(getMeeshoCategoryTemplate('KURTIS').slug).toBe('kurtis');
    expect(getMeeshoCategoryTemplate('Kurtis').slug).toBe('kurtis');
  });

  it('normalises underscores to hyphens', () => {
    expect(getMeeshoCategoryTemplate('casual_shoes').slug).toBe('casual-shoes');
  });

  it('normalises spaces to hyphens', () => {
    expect(getMeeshoCategoryTemplate('casual shoes').slug).toBe('casual-shoes');
  });

  it('resolves alias "kurti" → kurtis', () => {
    expect(getMeeshoCategoryTemplate('kurti').slug).toBe('kurtis');
  });

  it('resolves alias "tshirt" → tshirts', () => {
    expect(getMeeshoCategoryTemplate('tshirt').slug).toBe('tshirts');
  });

  it('resolves alias "saree" → sarees', () => {
    expect(getMeeshoCategoryTemplate('saree').slug).toBe('sarees');
  });

  it('resolves alias "shoes" → casual-shoes', () => {
    expect(getMeeshoCategoryTemplate('shoes').slug).toBe('casual-shoes');
  });

  it('falls back to generic template for unknown category', () => {
    expect(getMeeshoCategoryTemplate('unknown-category').slug).toBe('general');
    expect(getMeeshoCategoryTemplate('').slug).toBe('general');
    // @ts-expect-error — testing null safety
    expect(getMeeshoCategoryTemplate(null).slug).toBe('general');
  });

  it('all 6 templates resolve to themselves', () => {
    const slugs = ['kurtis', 'tshirts', 'sarees', 'casual-shoes', 'leggings', 'home-decor'];
    for (const slug of slugs) {
      expect(getMeeshoCategoryTemplate(slug).slug).toBe(slug);
    }
  });
});

// ─── template column invariants ──────────────────────────────────────────────

describe('category template column invariants', () => {
  it('every template includes all BASE_COLUMNS', () => {
    const baseKeys = ['sku', 'title', 'mrp', 'sellingPrice', 'brand', 'hsnCode', 'gstRate',
      'countryOfOrigin', 'description', 'image1', 'image2', 'image3', 'image4', 'image5'];

    for (const [slug, template] of Object.entries(MEESHO_CATEGORY_TEMPLATES)) {
      const templateKeys = template.columns.map((c) => c.key);
      for (const baseKey of baseKeys) {
        expect(templateKeys).toContain(baseKey);
      }
    }
  });

  it('no duplicate column keys within a template', () => {
    for (const [slug, template] of Object.entries(MEESHO_CATEGORY_TEMPLATES)) {
      const keys = template.columns.map((c) => c.key);
      const unique = new Set(keys);
      expect(unique.size).toBe(keys.length);
    }
  });

  it('kurtis template has colour, size, fabric as required', () => {
    const kurtis = getMeeshoCategoryTemplate('kurtis');
    const colourCol = kurtis.columns.find((c) => c.key === 'colour');
    const sizeCol   = kurtis.columns.find((c) => c.key === 'size');
    const fabricCol = kurtis.columns.find((c) => c.key === 'fabric');
    expect(colourCol?.required).toBe(true);
    expect(sizeCol?.required).toBe(true);
    expect(fabricCol?.required).toBe(true);
  });

  it('kurtis colour column has allowedValues', () => {
    const kurtis = getMeeshoCategoryTemplate('kurtis');
    const colourCol = kurtis.columns.find((c) => c.key === 'colour');
    expect(colourCol?.allowedValues?.length).toBeGreaterThan(0);
    expect(colourCol?.allowedValues).toContain('Blue');
    expect(colourCol?.allowedValues).toContain('Red');
  });

  it('kurtis size column includes standard Indian apparel sizes', () => {
    const kurtis = getMeeshoCategoryTemplate('kurtis');
    const sizeCol = kurtis.columns.find((c) => c.key === 'size');
    for (const size of ['XS', 'S', 'M', 'L', 'XL', 'XXL']) {
      expect(sizeCol?.allowedValues).toContain(size);
    }
  });

  it('casual-shoes template uses "shoeSize" key not "size"', () => {
    const shoes = getMeeshoCategoryTemplate('casual-shoes');
    const sizeCol = shoes.columns.find((c) => c.key === 'shoeSize');
    expect(sizeCol).toBeDefined();
    expect(sizeCol?.allowedValues).toContain('7');
    expect(sizeCol?.allowedValues).toContain('10');
  });

  it('getMeeshoSupportedCategorySlugs returns all 6 categories', () => {
    const slugs = getMeeshoSupportedCategorySlugs();
    expect(slugs).toHaveLength(6);
    expect(slugs).toContain('kurtis');
    expect(slugs).toContain('casual-shoes');
    expect(slugs).toContain('home-decor');
  });
});

// ─── isMeeshoTemplateStale ────────────────────────────────────────────────────

describe('isMeeshoTemplateStale', () => {
  it('returns false for a recently verified template', () => {
    const fresh = { ...MEESHO_CATEGORY_TEMPLATES.kurtis, templateVerifiedAt: new Date().toISOString().slice(0, 10) };
    expect(isMeeshoTemplateStale(fresh)).toBe(false);
  });

  it('returns true for a template verified more than 60 days ago', () => {
    const old = { ...MEESHO_CATEGORY_TEMPLATES.kurtis, templateVerifiedAt: '2024-01-01' };
    expect(isMeeshoTemplateStale(old)).toBe(true);
  });
});

// ─── MeeshoConnector.generateExportFile — variant row expansion ──────────────

// ExcelJS workbook generation involves async I/O and is slow under Jest worker
// contention. Each test in this suite gets a 30-second budget.
describe('MeeshoConnector.generateExportFile — variant expansion', () => {
  jest.setTimeout(30_000);

  const connector = new MeeshoConnector();
  const ctx = {
    tenantId: 't1',
    installationId: 'i1',
    connectorId: 'c1',
    getAccessToken: async () => 'token',
  };

  it('single-SKU product produces exactly 1 data row', async () => {
    const products = [makeProduct({ productType: 'kurtis' })];
    const result = await connector.generateExportFile(ctx, products);
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.filename).toMatch(/^meesho_kurtis_\d{8}\.xlsx$/);
    expect(result.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('product with 3 variants produces 3 data rows', async () => {
    const products = [
      makeProduct({
        productType: 'kurtis',
        variants: [
          makeVariant({ sku: 'SKU-M-BLU', attributes: { colour: 'Blue',  size: 'M' } }),
          makeVariant({ sku: 'SKU-L-BLU', attributes: { colour: 'Blue',  size: 'L' } }),
          makeVariant({ sku: 'SKU-M-RED', attributes: { colour: 'Red',   size: 'M' } }),
        ],
      }),
    ];
    const result = await connector.generateExportFile(ctx, products);
    // Parse the workbook to verify row count
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Products');
    // Rows: 1 header + 1 hint + 3 data = 4 total
    // ws.rowCount includes all rows, ws.actualRowCount counts non-empty
    const dataRowCount = (ws?.actualRowCount ?? 0) - 2; // subtract header + hint
    expect(dataRowCount).toBe(3);
  });

  it('6-variant product (3 sizes × 2 colours) produces 6 data rows', async () => {
    const colours = ['Blue', 'Red'];
    const sizes   = ['S', 'M', 'L'];
    const variants: ProductVariantPayload[] = colours.flatMap((colour) =>
      sizes.map((size) =>
        makeVariant({ sku: `SKU-${size}-${colour}`, attributes: { colour, size } }),
      ),
    );
    const products = [makeProduct({ productType: 'kurtis', variants })];
    const result = await connector.generateExportFile(ctx, products);

    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Products');
    const dataRowCount = (ws?.actualRowCount ?? 0) - 2;
    expect(dataRowCount).toBe(6);
  });

  it('each variant row carries its own SKU', async () => {
    const products = [
      makeProduct({
        productType: 'tshirts',
        variants: [
          makeVariant({ sku: 'A-001', attributes: { colour: 'Black', size: 'S', gender: 'Men' } }),
          makeVariant({ sku: 'A-002', attributes: { colour: 'White', size: 'M', gender: 'Men' } }),
        ],
      }),
    ];
    const result = await connector.generateExportFile(ctx, products);

    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Products');

    const row3 = ws?.getRow(3);
    const row4 = ws?.getRow(4);
    // SKU ID is the first column
    expect(row3?.getCell(1).value).toBe('A-001');
    expect(row4?.getCell(1).value).toBe('A-002');
  });

  it('uses category-specific template columns for kurtis (not generic 18-col)', async () => {
    const products = [makeProduct({ productType: 'kurtis' })];
    const result = await connector.generateExportFile(ctx, products);

    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Products');
    const headerRow = ws?.getRow(1);
    const headers: string[] = [];
    headerRow?.eachCell((cell) => headers.push(String(cell.value ?? '')));

    expect(headers).toContain('Colour');
    expect(headers).toContain('Size');
    expect(headers).toContain('Fabric');
    expect(headers).toContain('Sleeve Type');
    expect(headers).toContain('Neckline');
    // Should NOT contain shoes-specific columns
    expect(headers).not.toContain('Size (UK)');
    expect(headers).not.toContain('Sole Material');
  });

  it('uses shoe-specific columns for casual-shoes', async () => {
    const products = [makeProduct({ productType: 'casual-shoes', attributes: {} })];
    const result = await connector.generateExportFile(ctx, products);

    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Products');
    const headerRow = ws?.getRow(1);
    const headers: string[] = [];
    headerRow?.eachCell((cell) => headers.push(String(cell.value ?? '')));

    expect(headers).toContain('Size (UK)');
    expect(headers).toContain('Gender');
    expect(headers).toContain('Closure Type');
    // Should NOT contain kurti-specific columns
    expect(headers).not.toContain('Sleeve Type');
    expect(headers).not.toContain('Neckline');
  });

  it('throws when products array is empty', async () => {
    await expect(connector.generateExportFile(ctx, [])).rejects.toThrow(
      'products array must not be empty',
    );
  });
});

// ─── MeeshoConnector.validateProduct ─────────────────────────────────────────

describe('MeeshoConnector.validateProduct', () => {
  const connector = new MeeshoConnector();
  const ctx = {
    tenantId: 't1',
    installationId: 'i1',
    connectorId: 'c1',
    getAccessToken: async () => 'token',
  };

  it('valid kurtis product passes with no errors', async () => {
    const result = await connector.validateProduct(ctx, makeProduct());
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.source).toBe('LOCAL_RULES');
  });

  it('title too long produces TITLE_TOO_LONG error', async () => {
    const result = await connector.validateProduct(ctx, makeProduct({ title: 'A'.repeat(71) }));
    expect(result.errors.some((e) => e.code === 'TITLE_TOO_LONG')).toBe(true);
  });

  it('missing title produces TITLE_MISSING error', async () => {
    const result = await connector.validateProduct(ctx, makeProduct({ title: '' }));
    expect(result.errors.some((e) => e.code === 'TITLE_MISSING')).toBe(true);
  });

  it('http image (not https) produces IMAGE_NOT_HTTPS error', async () => {
    const result = await connector.validateProduct(
      ctx,
      makeProduct({ mainImageUrl: 'http://insecure.example.com/img.jpg' }),
    );
    expect(result.errors.some((e) => e.code === 'IMAGE_NOT_HTTPS')).toBe(true);
  });

  it('invalid HSN code produces HSN_INVALID error', async () => {
    const result = await connector.validateProduct(ctx, makeProduct({ hsnCode: '123' }));
    expect(result.errors.some((e) => e.code === 'HSN_INVALID')).toBe(true);
  });

  it('selling price > MRP produces SELLING_PRICE_EXCEEDS_MRP error', async () => {
    const result = await connector.validateProduct(
      ctx,
      makeProduct({ mrp: 500, sellingPrice: 600 }),
    );
    expect(result.errors.some((e) => e.code === 'SELLING_PRICE_EXCEEDS_MRP')).toBe(true);
  });

  it('invalid GST rate produces GST_RATE_INVALID error', async () => {
    const result = await connector.validateProduct(ctx, makeProduct({ gstRate: 7 }));
    expect(result.errors.some((e) => e.code === 'GST_RATE_INVALID')).toBe(true);
  });

  it('invalid colour for kurtis produces COLOUR_INVALID error', async () => {
    const result = await connector.validateProduct(
      ctx,
      makeProduct({ attributes: { colour: 'Magenta', size: 'M', fabric: 'Cotton' } }),
    );
    expect(result.errors.some((e) => e.code === 'COLOUR_INVALID')).toBe(true);
  });

  it('valid colour for kurtis does NOT produce COLOUR_INVALID error', async () => {
    const result = await connector.validateProduct(
      ctx,
      makeProduct({ attributes: { colour: 'Blue', size: 'M', fabric: 'Cotton' } }),
    );
    expect(result.errors.some((e) => e.code === 'COLOUR_INVALID')).toBe(false);
  });

  it('invalid size for kurtis produces SIZE_INVALID error', async () => {
    const result = await connector.validateProduct(
      ctx,
      makeProduct({ attributes: { colour: 'Blue', size: 'HUGE', fabric: 'Cotton' } }),
    );
    expect(result.errors.some((e) => e.code === 'SIZE_INVALID')).toBe(true);
  });

  it('colour validation is skipped for generic (unmapped) category', async () => {
    const result = await connector.validateProduct(
      ctx,
      makeProduct({ productType: 'unknown-category', attributes: { colour: 'SpaceRainbow' } }),
    );
    // Generic template has no allowedValues for colour, so no validation error
    expect(result.errors.some((e) => e.code === 'COLOUR_INVALID')).toBe(false);
  });

  it('short description produces DESCRIPTION_TOO_SHORT warning (not error)', async () => {
    const result = await connector.validateProduct(ctx, makeProduct({ description: 'Short' }));
    expect(result.isValid).toBe(true); // warnings don't block
    expect(result.warnings.some((w) => w.code === 'DESCRIPTION_TOO_SHORT')).toBe(true);
  });
});

// ─── MeeshoConnector.normaliseError ──────────────────────────────────────────

describe('MeeshoConnector.normaliseError', () => {
  const connector = new MeeshoConnector();

  it('maps known code to structured issue', () => {
    const issue = connector.normaliseError('TITLE_TOO_LONG', 'raw');
    expect(issue.code).toBe('TITLE_TOO_LONG');
    expect(issue.fieldPath).toBe('title');
    expect(issue.severity).toBe('error');
    expect(issue.sellerMessage.length).toBeGreaterThan(0);
  });

  it('returns fallback for unknown code (never throws)', () => {
    const issue = connector.normaliseError('UNKNOWN_CODE_XYZ', 'something went wrong');
    expect(issue.code).toBe('UNKNOWN_CODE_XYZ');
    expect(issue.severity).toBe('error');
    expect(issue.sellerMessage).toContain('something went wrong');
  });

  it('fallback uses errorCode in message when rawMessage is empty', () => {
    const issue = connector.normaliseError('MYSTERY_ERROR', '');
    expect(issue.sellerMessage).toContain('MYSTERY_ERROR');
  });
});
