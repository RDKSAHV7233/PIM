// PriceResolutionService had zero test coverage despite being the sole mapper
// between Prisma's ProductPrice rows and the MarketPrice contract sent to every
// connector — marketplace.service.spec.ts mocks fromRows()/findDefault() at every
// call site (jest.fn()), so the real implementation was never actually exercised
// anywhere in CI. This directly feeds price data connectors publish to channels.

import { PriceResolutionService, ResolvedPriceRow } from "./price-resolution.service";

function makeRow(overrides: Partial<ResolvedPriceRow> = {}): ResolvedPriceRow {
  return {
    mrp: 100,
    sellingPrice: 90,
    priceList: {
      isDefault: false,
      market: { code: "IN" },
      currency: { code: "INR" },
    },
    ...overrides,
  };
}

describe("PriceResolutionService.fromRows", () => {
  let service: PriceResolutionService;

  beforeEach(() => {
    service = new PriceResolutionService();
  });

  it("maps marketCode, currencyCode, mrp, sellingPrice, and isDefault from each row", () => {
    const row = makeRow({
      mrp: 500,
      sellingPrice: 450,
      priceList: { isDefault: true, market: { code: "GB" }, currency: { code: "GBP" } },
    });

    expect(service.fromRows([row])).toEqual([
      { marketCode: "GB", currencyCode: "GBP", mrp: 500, sellingPrice: 450, isDefault: true },
    ]);
  });

  it("maps a null mrp to undefined, not null — MarketPrice's mrp field is optional, not nullable", () => {
    const row = makeRow({ mrp: null });
    const [result] = service.fromRows([row]);
    expect(result.mrp).toBeUndefined();
    expect(Object.is(result.mrp, null)).toBe(false);
  });

  it("maps a null sellingPrice to undefined, not null", () => {
    const row = makeRow({ sellingPrice: null });
    const [result] = service.fromRows([row]);
    expect(result.sellingPrice).toBeUndefined();
  });

  it("preserves input array order — callers rely on this to keep marketPrices[0] predictable", () => {
    const rowIn = makeRow({ priceList: { isDefault: false, market: { code: "IN" }, currency: { code: "INR" } } });
    const rowUs = makeRow({ priceList: { isDefault: true, market: { code: "US" }, currency: { code: "USD" } } });
    const rowAe = makeRow({ priceList: { isDefault: false, market: { code: "AE" }, currency: { code: "AED" } } });

    const result = service.fromRows([rowIn, rowUs, rowAe]);

    expect(result.map((r) => r.marketCode)).toEqual(["IN", "US", "AE"]);
  });

  it("returns an empty array for an empty input, not undefined or a thrown error", () => {
    expect(service.fromRows([])).toEqual([]);
  });

  it("maps a multi-row input where none is default — every entry keeps isDefault: false", () => {
    const rows = [
      makeRow({ priceList: { isDefault: false, market: { code: "IN" }, currency: { code: "INR" } } }),
      makeRow({ priceList: { isDefault: false, market: { code: "AU" }, currency: { code: "AUD" } } }),
    ];
    const result = service.fromRows(rows);
    expect(result.every((r) => r.isDefault === false)).toBe(true);
  });
});

describe("PriceResolutionService.findDefault", () => {
  let service: PriceResolutionService;

  beforeEach(() => {
    service = new PriceResolutionService();
  });

  it("returns the price entry whose isDefault is true", () => {
    const prices = [
      { marketCode: "IN", currencyCode: "INR", mrp: 100, sellingPrice: 90, isDefault: false },
      { marketCode: "US", currencyCode: "USD", mrp: 10, sellingPrice: 9, isDefault: true },
    ];
    expect(service.findDefault(prices)?.marketCode).toBe("US");
  });

  it("returns undefined when no entry is default, rather than falling back to the first row", () => {
    const prices = [
      { marketCode: "IN", currencyCode: "INR", mrp: 100, sellingPrice: 90, isDefault: false },
      { marketCode: "US", currencyCode: "USD", mrp: 10, sellingPrice: 9, isDefault: false },
    ];
    expect(service.findDefault(prices)).toBeUndefined();
  });

  it("returns undefined for an empty array", () => {
    expect(service.findDefault([])).toBeUndefined();
  });

  it("returns the FIRST default when multiple entries are marked default — does not sort, callers own ordering", () => {
    const prices = [
      { marketCode: "IN", currencyCode: "INR", mrp: 100, sellingPrice: 90, isDefault: true },
      { marketCode: "US", currencyCode: "USD", mrp: 10, sellingPrice: 9, isDefault: true },
    ];
    expect(service.findDefault(prices)?.marketCode).toBe("IN");
  });

  it("preserves optional mrp/sellingPrice as undefined on the returned default, not coerced to 0", () => {
    const prices = [
      { marketCode: "IN", currencyCode: "INR", isDefault: true } as const,
    ];
    const result = service.findDefault([...prices]);
    expect(result?.mrp).toBeUndefined();
    expect(result?.sellingPrice).toBeUndefined();
  });
});
