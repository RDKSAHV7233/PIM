// apps/api/src/pricing/pricing.service.spec.ts
//
// Unit tests for PricingService.
// PrismaService is fully mocked — prisma.tenant() returns a client-shaped mock.
// $transaction in callback form executes the callback with a tx-shaped mock.

import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PricingService } from "./pricing.service";

// ── mock factory helpers ─────────────────────────────────────────────────────

function makeMarket(overrides: Record<string, unknown> = {}) {
  return {
    id: "mkt_1",
    tenantKey: "t1",
    code: "IN",
    locale: "en-IN",
    displayName: "India",
    isDefault: false,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeCurrency(overrides: Record<string, unknown> = {}) {
  return {
    id: "cur_1",
    tenantKey: "t1",
    code: "INR",
    symbol: "₹",
    displayName: "Indian Rupee",
    decimalPlaces: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePriceList(overrides: Record<string, unknown> = {}) {
  return {
    id: "pl_1",
    tenantKey: "t1",
    name: "India Default",
    marketId: "mkt_1",
    currencyId: "cur_1",
    isDefault: false,
    status: "active",
    market: { id: "mkt_1", code: "IN", displayName: "India" },
    currency: { id: "cur_1", code: "INR", symbol: "₹" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Minimal Prisma model mock shape
function makeModelMock() {
  return {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    upsert: jest.fn(),
  };
}

type ClientMock = {
  market: ReturnType<typeof makeModelMock>;
  currency: ReturnType<typeof makeModelMock>;
  priceList: ReturnType<typeof makeModelMock>;
  productPrice: ReturnType<typeof makeModelMock>;
  variant: ReturnType<typeof makeModelMock>;
  $transaction: jest.Mock;
};

// A client mock that looks like a PrismaClient (what tenant() returns).
// $transaction in callback form executes the callback with the same mock client.
function makeClientMock(): ClientMock {
  const mock: ClientMock = {
    market: makeModelMock(),
    currency: makeModelMock(),
    priceList: makeModelMock(),
    productPrice: makeModelMock(),
    variant: makeModelMock(),
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    // callback form — pass the client mock as the tx argument
    return (arg as (tx: ClientMock) => Promise<unknown>)(mock);
  });
  return mock;
}

// PrismaService mock — tenant() always returns the same client mock
function makePrismaServiceMock() {
  const client = makeClientMock();
  return { tenant: jest.fn(() => client), _client: client };
}

// ── suite ────────────────────────────────────────────────────────────────────

describe("PricingService", () => {
  let service: PricingService;
  let prismaMock: ReturnType<typeof makePrismaServiceMock>;
  let client: ReturnType<typeof makeClientMock>;

  beforeEach(() => {
    prismaMock = makePrismaServiceMock();
    client = prismaMock._client;
    service = new PricingService(prismaMock as never);
  });

  // ── Markets ──────────────────────────────────────────────────────────────

  describe("listMarkets", () => {
    it("returns markets ordered default-first via correct where/orderBy", async () => {
      const markets = [makeMarket({ isDefault: true }), makeMarket({ id: "mkt_2", code: "US" })];
      client.market.findMany.mockResolvedValue(markets);
      const result = await service.listMarkets("t1");
      expect(result).toEqual(markets);
      expect(client.market.findMany).toHaveBeenCalledWith({
        where: { tenantKey: "t1" },
        orderBy: [{ isDefault: "desc" }, { code: "asc" }],
      });
    });
  });

  describe("getMarket", () => {
    it("throws NotFoundException when market is absent", async () => {
      client.market.findFirst.mockResolvedValue(null);
      await expect(service.getMarket("t1", "missing")).rejects.toThrow(NotFoundException);
    });

    it("returns market when found", async () => {
      const m = makeMarket();
      client.market.findFirst.mockResolvedValue(m);
      await expect(service.getMarket("t1", "mkt_1")).resolves.toEqual(m);
    });
  });

  describe("createMarket", () => {
    it("creates market without clearing defaults when isDefault=false", async () => {
      const created = makeMarket();
      client.market.create.mockResolvedValue(created);
      // $transaction runs the callback with our client mock
      const result = await service.createMarket("t1", {
        code: "IN",
        locale: "en-IN",
        displayName: "India",
        isDefault: false,
      });
      expect(result).toEqual(created);
      // updateMany should NOT have been called
      expect(client.market.updateMany).not.toHaveBeenCalled();
    });

    it("clears existing defaults before creating when isDefault=true", async () => {
      const created = makeMarket({ isDefault: true });
      client.market.updateMany.mockResolvedValue({ count: 1 });
      client.market.create.mockResolvedValue(created);

      await service.createMarket("t1", {
        code: "IN",
        locale: "en-IN",
        displayName: "India",
        isDefault: true,
      });

      expect(client.market.updateMany).toHaveBeenCalledWith({
        where: { tenantKey: "t1", isDefault: true },
        data: { isDefault: false },
      });
      expect(client.market.create).toHaveBeenCalled();
    });

    it("maps P2002 Prisma error to ConflictException", async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "5.0.0",
      });
      client.market.create.mockRejectedValue(p2002);
      await expect(
        service.createMarket("t1", { code: "IN", locale: "en-IN", displayName: "India" }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("deleteMarket", () => {
    it("throws NotFoundException for unknown market", async () => {
      client.market.findFirst.mockResolvedValue(null);
      await expect(service.deleteMarket("t1", "bad_id")).rejects.toThrow(NotFoundException);
    });

    it("maps P2003 (FK restrict) to ConflictException", async () => {
      client.market.findFirst.mockResolvedValue(makeMarket());
      const p2003 = new Prisma.PrismaClientKnownRequestError("FK violation", {
        code: "P2003",
        clientVersion: "5.0.0",
      });
      client.market.delete.mockRejectedValue(p2003);
      await expect(service.deleteMarket("t1", "mkt_1")).rejects.toThrow(ConflictException);
    });

    it("deletes market when no FK references exist", async () => {
      client.market.findFirst.mockResolvedValue(makeMarket());
      client.market.delete.mockResolvedValue(makeMarket());
      await expect(service.deleteMarket("t1", "mkt_1")).resolves.toBeUndefined();
    });
  });

  // ── Currencies ───────────────────────────────────────────────────────────

  describe("createCurrency", () => {
    it("creates currency with default decimalPlaces=2 when not supplied", async () => {
      const cur = makeCurrency();
      client.currency.create.mockResolvedValue(cur);
      const result = await service.createCurrency("t1", {
        code: "INR",
        symbol: "₹",
        displayName: "Indian Rupee",
      });
      expect(result).toEqual(cur);
      expect(client.currency.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ decimalPlaces: 2, tenantKey: "t1" }),
      });
    });

    it("maps P2002 to ConflictException on duplicate code", async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "5.0.0",
      });
      client.currency.create.mockRejectedValue(p2002);
      await expect(
        service.createCurrency("t1", { code: "INR", symbol: "₹", displayName: "INR" }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("deleteCurrency", () => {
    it("maps P2003 (FK restrict) to ConflictException when price list references currency", async () => {
      client.currency.findFirst.mockResolvedValue(makeCurrency());
      const p2003 = new Prisma.PrismaClientKnownRequestError("FK violation", {
        code: "P2003",
        clientVersion: "5.0.0",
      });
      client.currency.delete.mockRejectedValue(p2003);
      await expect(service.deleteCurrency("t1", "cur_1")).rejects.toThrow(ConflictException);
    });
  });

  // ── Price Lists ───────────────────────────────────────────────────────────

  describe("createPriceList", () => {
    it("throws BadRequestException when marketId not found in tenant", async () => {
      client.market.findFirst.mockResolvedValue(null);
      client.currency.findFirst.mockResolvedValue(makeCurrency());
      await expect(
        service.createPriceList("t1", {
          name: "Test",
          marketId: "bad_mkt",
          currencyId: "cur_1",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when currencyId not found in tenant", async () => {
      client.market.findFirst.mockResolvedValue(makeMarket());
      client.currency.findFirst.mockResolvedValue(null);
      await expect(
        service.createPriceList("t1", {
          name: "Test",
          marketId: "mkt_1",
          currencyId: "bad_cur",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("clears existing default and creates price list when isDefault=true", async () => {
      client.market.findFirst.mockResolvedValue(makeMarket());
      client.currency.findFirst.mockResolvedValue(makeCurrency());
      const pl = makePriceList({ isDefault: true });
      client.priceList.updateMany.mockResolvedValue({ count: 1 });
      client.priceList.create.mockResolvedValue(pl);

      const result = await service.createPriceList("t1", {
        name: "India Default",
        marketId: "mkt_1",
        currencyId: "cur_1",
        isDefault: true,
      });
      expect(result).toEqual(pl);
      expect(client.priceList.updateMany).toHaveBeenCalledWith({
        where: { tenantKey: "t1", isDefault: true },
        data: { isDefault: false },
      });
    });

    it("creates price list without clearing defaults when isDefault=false", async () => {
      client.market.findFirst.mockResolvedValue(makeMarket());
      client.currency.findFirst.mockResolvedValue(makeCurrency());
      const pl = makePriceList();
      client.priceList.create.mockResolvedValue(pl);

      await service.createPriceList("t1", {
        name: "India Default",
        marketId: "mkt_1",
        currencyId: "cur_1",
        isDefault: false,
      });
      expect(client.priceList.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── Product Prices ────────────────────────────────────────────────────────

  describe("upsertPrices", () => {
    it("returns { upserted: 0 } for empty array without issuing any DB calls", async () => {
      client.priceList.findFirst.mockResolvedValue(makePriceList());
      const result = await service.upsertPrices("t1", "pl_1", { prices: [] });
      expect(result).toEqual({ upserted: 0 });
      expect(client.$transaction).not.toHaveBeenCalled();
    });

    it("throws BadRequestException for variantId not in tenant", async () => {
      client.priceList.findFirst.mockResolvedValue(makePriceList());
      client.variant.findMany.mockResolvedValue([]); // none found
      await expect(
        service.upsertPrices("t1", "pl_1", {
          prices: [{ variantId: "bad_var", mrp: 100, sellingPrice: 80 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("calls upsert for each valid variant and returns count", async () => {
      client.priceList.findFirst.mockResolvedValue(makePriceList());
      client.variant.findMany.mockResolvedValue([{ id: "var_1" }, { id: "var_2" }]);
      // $transaction is array form — returns array of resolved values
      client.$transaction.mockResolvedValue([{}, {}]);
      client.productPrice.upsert.mockResolvedValue({});

      const result = await service.upsertPrices("t1", "pl_1", {
        prices: [
          { variantId: "var_1", mrp: 999, sellingPrice: 799 },
          { variantId: "var_2", mrp: 599, sellingPrice: 499 },
        ],
      });
      expect(result).toEqual({ upserted: 2 });
      // productPrice.upsert was called twice (once per price entry, building the array)
      expect(client.productPrice.upsert).toHaveBeenCalledTimes(2);
    });

    it("throws NotFoundException when price list not found in tenant", async () => {
      client.priceList.findFirst.mockResolvedValue(null);
      await expect(
        service.upsertPrices("t1", "pl_other", { prices: [{ variantId: "var_1" }] }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── importPricesFromCsv ───────────────────────────────────────────────────

  describe("importPricesFromCsv", () => {
    function csv(...rows: string[]): Buffer {
      return Buffer.from(rows.join("\n"), "utf-8");
    }

    it("imports valid rows and returns count", async () => {
      client.priceList.findFirst.mockResolvedValue(makePriceList());
      client.variant.findMany.mockResolvedValue([
        { id: "var_1", skuCode: "SKU001" },
        { id: "var_2", skuCode: "SKU002" },
      ]);
      client.$transaction.mockResolvedValue([{}, {}]);

      const result = await service.importPricesFromCsv(
        "t1",
        "pl_1",
        csv("sku_code,mrp,selling_price", "SKU001,999,799", "SKU002,1499,1199"),
      );
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("reports error for unknown SKUs", async () => {
      client.priceList.findFirst.mockResolvedValue(makePriceList());
      client.variant.findMany.mockResolvedValue([]);

      const result = await service.importPricesFromCsv(
        "t1",
        "pl_1",
        csv("sku_code,mrp,selling_price", "UNKNOWN,100,90"),
      );
      expect(result.imported).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].skuCode).toBe("UNKNOWN");
    });

    it("skips rows with no numeric prices", async () => {
      client.priceList.findFirst.mockResolvedValue(makePriceList());
      client.variant.findMany.mockResolvedValue([{ id: "var_1", skuCode: "SKU001" }]);

      const result = await service.importPricesFromCsv(
        "t1",
        "pl_1",
        csv("sku_code,mrp,selling_price", "SKU001,,"),
      );
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it("throws BadRequestException when price list not found", async () => {
      client.priceList.findFirst.mockResolvedValue(null);
      await expect(
        service.importPricesFromCsv("t1", "pl_missing", Buffer.from("sku_code\n")),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when CSV has no sku_code column", async () => {
      client.priceList.findFirst.mockResolvedValue(makePriceList());
      await expect(
        service.importPricesFromCsv("t1", "pl_1", csv("name,price", "Tee,999")),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when CSV has no price columns", async () => {
      client.priceList.findFirst.mockResolvedValue(makePriceList());
      await expect(
        service.importPricesFromCsv("t1", "pl_1", csv("sku_code", "SKU001")),
      ).rejects.toThrow(BadRequestException);
    });

    it("handles sku column alias 'sku'", async () => {
      client.priceList.findFirst.mockResolvedValue(makePriceList());
      client.variant.findMany.mockResolvedValue([{ id: "var_1", skuCode: "SKU001" }]);
      client.$transaction.mockResolvedValue([{}]);

      const result = await service.importPricesFromCsv(
        "t1",
        "pl_1",
        csv("sku,mrp", "SKU001,999"),
      );
      expect(result.imported).toBe(1);
    });

    it("strips currency symbols from price values (₹)", async () => {
      client.priceList.findFirst.mockResolvedValue(makePriceList());
      client.variant.findMany.mockResolvedValue([{ id: "var_1", skuCode: "SKU001" }]);
      client.$transaction.mockResolvedValue([{}]);

      const result = await service.importPricesFromCsv(
        "t1",
        "pl_1",
        csv("sku_code,mrp,selling_price", 'SKU001,"₹1,999.00","₹1,599.00"'),
      );
      expect(result.imported).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ── bootstrapDefaultPricing ───────────────────────────────────────────────

  describe("bootstrapDefaultPricing", () => {
    it("returns { created: false } when a market already exists", async () => {
      client.market.findFirst.mockResolvedValue(makeMarket());
      const result = await service.bootstrapDefaultPricing("t1");
      expect(result).toEqual({ created: false });
      // No mutation should occur
      expect(client.$transaction).not.toHaveBeenCalled();
    });

    it("creates India market, INR currency, and default price list when tenant is empty", async () => {
      client.market.findFirst.mockResolvedValue(null); // no existing market
      const market = makeMarket({ code: "IN", isDefault: true });
      const currency = makeCurrency({ code: "INR" });
      const priceList = makePriceList({ name: "India – INR", isDefault: true });
      client.market.create.mockResolvedValue(market);
      client.currency.create.mockResolvedValue(currency);
      client.priceList.create.mockResolvedValue(priceList);

      const result = await service.bootstrapDefaultPricing("t1");
      expect(result).toEqual({ created: true });
      expect(client.market.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ code: "IN", isDefault: true, tenantKey: "t1" }),
        }),
      );
      expect(client.currency.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ code: "INR", tenantKey: "t1" }),
        }),
      );
      expect(client.priceList.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isDefault: true,
            tenantKey: "t1",
            marketId: market.id,
            currencyId: currency.id,
          }),
        }),
      );
    });

    it("is idempotent — second call returns { created: false } without writing", async () => {
      // First call: no market → creates
      client.market.findFirst.mockResolvedValueOnce(null);
      client.market.create.mockResolvedValue(makeMarket());
      client.currency.create.mockResolvedValue(makeCurrency());
      client.priceList.create.mockResolvedValue(makePriceList());
      await service.bootstrapDefaultPricing("t1");

      // Second call: market now exists → skips
      client.market.findFirst.mockResolvedValueOnce(makeMarket());
      const result = await service.bootstrapDefaultPricing("t1");
      expect(result).toEqual({ created: false });
    });
  });
});
