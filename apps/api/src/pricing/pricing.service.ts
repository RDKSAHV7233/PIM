// apps/api/src/pricing/pricing.service.ts
// CRUD for Market, Currency, PriceList and bulk-upsert for ProductPrice.
//
// Design principles:
// - All queries are tenant-scoped: every read/write filters on tenantKey.
//   Market/Currency/PriceList/ProductPrice are NOT in TENANT_SCOPED_MODELS so
//   the tenant-scope extension does NOT auto-inject tenantKey — we do it manually.
// - isDefault exclusivity is enforced in a transaction: setting a record as default
//   first clears any existing default in the same tx, preventing two defaults.
// - FK violations (P2003) from Prisma's onDelete: Restrict are surfaced as 409.
// - Unique-constraint violations (P2002) are surfaced as 409 with a readable message.
// - Prisma errors that don't match expected codes re-throw as-is.

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateMarketDto } from "./dto/create-market.dto";
import { UpdateMarketDto } from "./dto/update-market.dto";
import { CreateCurrencyDto } from "./dto/create-currency.dto";
import { UpdateCurrencyDto } from "./dto/update-currency.dto";
import { CreatePriceListDto } from "./dto/create-price-list.dto";
import { UpdatePriceListDto } from "./dto/update-price-list.dto";
import { UpsertProductPricesDto } from "./dto/upsert-product-prices.dto";

// ── helpers ──────────────────────────────────────────────────────────────────

function handlePrismaError(err: unknown, context: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        throw new ConflictException(`${context}: a record with those unique fields already exists`);
      case "P2003":
        throw new ConflictException(
          `${context}: cannot delete — other records still reference this item`,
        );
      case "P2025":
        throw new NotFoundException(`${context}: record not found`);
    }
  }
  throw err;
}

// ── service ───────────────────────────────────────────────────────────────────

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Markets ────────────────────────────────────────────────────────────────

  listMarkets(tenantKey: string) {
    return this.prisma.tenant().market.findMany({
      where: { tenantKey },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }],
    });
  }

  async getMarket(tenantKey: string, id: string) {
    const market = await this.prisma.tenant().market.findFirst({ where: { id, tenantKey } });
    if (!market) throw new NotFoundException(`Market ${id} not found`);
    return market;
  }

  async createMarket(tenantKey: string, dto: CreateMarketDto) {
    try {
      return await this.prisma.tenant().$transaction(async (tx) => {
        if (dto.isDefault) {
          await tx.market.updateMany({ where: { tenantKey, isDefault: true }, data: { isDefault: false } });
        }
        return tx.market.create({
          data: {
            tenantKey,
            code: dto.code,
            locale: dto.locale,
            displayName: dto.displayName,
            isDefault: dto.isDefault ?? false,
            status: dto.status ?? "active",
          },
        });
      });
    } catch (err) {
      handlePrismaError(err, "createMarket");
    }
  }

  async updateMarket(tenantKey: string, id: string, dto: UpdateMarketDto) {
    await this.getMarket(tenantKey, id);
    try {
      return await this.prisma.tenant().$transaction(async (tx) => {
        if (dto.isDefault) {
          await tx.market.updateMany({
            where: { tenantKey, isDefault: true, NOT: { id } },
            data: { isDefault: false },
          });
        }
        return tx.market.update({
          where: { id },
          data: {
            ...(dto.locale !== undefined && { locale: dto.locale }),
            ...(dto.displayName !== undefined && { displayName: dto.displayName }),
            ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
            ...(dto.status !== undefined && { status: dto.status }),
          },
        });
      });
    } catch (err) {
      handlePrismaError(err, "updateMarket");
    }
  }

  async deleteMarket(tenantKey: string, id: string) {
    await this.getMarket(tenantKey, id);
    try {
      await this.prisma.tenant().market.delete({ where: { id } });
    } catch (err) {
      handlePrismaError(err, "deleteMarket");
    }
  }

  // ── Currencies ─────────────────────────────────────────────────────────────

  listCurrencies(tenantKey: string) {
    return this.prisma.tenant().currency.findMany({
      where: { tenantKey },
      orderBy: { code: "asc" },
    });
  }

  async getCurrency(tenantKey: string, id: string) {
    const currency = await this.prisma.tenant().currency.findFirst({ where: { id, tenantKey } });
    if (!currency) throw new NotFoundException(`Currency ${id} not found`);
    return currency;
  }

  async createCurrency(tenantKey: string, dto: CreateCurrencyDto) {
    try {
      return await this.prisma.tenant().currency.create({
        data: {
          tenantKey,
          code: dto.code,
          symbol: dto.symbol,
          displayName: dto.displayName,
          decimalPlaces: dto.decimalPlaces ?? 2,
        },
      });
    } catch (err) {
      handlePrismaError(err, "createCurrency");
    }
  }

  async updateCurrency(tenantKey: string, id: string, dto: UpdateCurrencyDto) {
    await this.getCurrency(tenantKey, id);
    try {
      return await this.prisma.tenant().currency.update({
        where: { id },
        data: {
          ...(dto.symbol !== undefined && { symbol: dto.symbol }),
          ...(dto.displayName !== undefined && { displayName: dto.displayName }),
          ...(dto.decimalPlaces !== undefined && { decimalPlaces: dto.decimalPlaces }),
        },
      });
    } catch (err) {
      handlePrismaError(err, "updateCurrency");
    }
  }

  async deleteCurrency(tenantKey: string, id: string) {
    await this.getCurrency(tenantKey, id);
    try {
      await this.prisma.tenant().currency.delete({ where: { id } });
    } catch (err) {
      handlePrismaError(err, "deleteCurrency");
    }
  }

  // ── Price Lists ────────────────────────────────────────────────────────────

  listPriceLists(tenantKey: string) {
    return this.prisma.tenant().priceList.findMany({
      where: { tenantKey },
      include: {
        market: { select: { id: true, code: true, displayName: true } },
        currency: { select: { id: true, code: true, symbol: true } },
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
  }

  async getPriceList(tenantKey: string, id: string) {
    const pl = await this.prisma.tenant().priceList.findFirst({
      where: { id, tenantKey },
      include: {
        market: { select: { id: true, code: true, displayName: true } },
        currency: { select: { id: true, code: true, symbol: true } },
      },
    });
    if (!pl) throw new NotFoundException(`PriceList ${id} not found`);
    return pl;
  }

  async createPriceList(tenantKey: string, dto: CreatePriceListDto) {
    // Verify market + currency exist within this tenant before creating
    const [market, currency] = await Promise.all([
      this.prisma.tenant().market.findFirst({ where: { id: dto.marketId, tenantKey } }),
      this.prisma.tenant().currency.findFirst({ where: { id: dto.currencyId, tenantKey } }),
    ]);
    if (!market) throw new BadRequestException(`Market ${dto.marketId} not found in this tenant`);
    if (!currency) throw new BadRequestException(`Currency ${dto.currencyId} not found in this tenant`);

    try {
      return await this.prisma.tenant().$transaction(async (tx) => {
        if (dto.isDefault) {
          await tx.priceList.updateMany({
            where: { tenantKey, isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.priceList.create({
          data: {
            tenantKey,
            name: dto.name,
            marketId: dto.marketId,
            currencyId: dto.currencyId,
            isDefault: dto.isDefault ?? false,
            status: dto.status ?? "active",
          },
          include: {
            market: { select: { id: true, code: true, displayName: true } },
            currency: { select: { id: true, code: true, symbol: true } },
          },
        });
      });
    } catch (err) {
      handlePrismaError(err, "createPriceList");
    }
  }

  async updatePriceList(tenantKey: string, id: string, dto: UpdatePriceListDto) {
    await this.getPriceList(tenantKey, id);
    try {
      return await this.prisma.tenant().$transaction(async (tx) => {
        if (dto.isDefault) {
          await tx.priceList.updateMany({
            where: { tenantKey, isDefault: true, NOT: { id } },
            data: { isDefault: false },
          });
        }
        return tx.priceList.update({
          where: { id },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
            ...(dto.status !== undefined && { status: dto.status }),
          },
          include: {
            market: { select: { id: true, code: true, displayName: true } },
            currency: { select: { id: true, code: true, symbol: true } },
          },
        });
      });
    } catch (err) {
      handlePrismaError(err, "updatePriceList");
    }
  }

  async deletePriceList(tenantKey: string, id: string) {
    await this.getPriceList(tenantKey, id);
    // ProductPrice rows cascade-delete automatically (onDelete: Cascade)
    await this.prisma.tenant().priceList.delete({ where: { id } });
  }

  // ── Product Prices ─────────────────────────────────────────────────────────

  async listPrices(tenantKey: string, priceListId: string) {
    // Verify the price list belongs to this tenant
    await this.getPriceList(tenantKey, priceListId);
    return this.prisma.tenant().productPrice.findMany({
      where: { priceListId, tenantKey },
      include: {
        variant: {
          select: {
            id: true,
            skuCode: true,
            product: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { variant: { skuCode: "asc" } },
    });
  }

  /**
   * Bulk-upsert prices for a price list.
   * Each entry in dto.prices sets mrp/sellingPrice for the given variantId.
   * Missing variants are created; existing rows are updated.
   * An empty prices array is valid and is a no-op.
   *
   * Returns { upserted: number } count.
   */
  // ── CSV Price Import ───────────────────────────────────────────────────────

  /**
   * Parses a CSV buffer and upserts prices for the given price list.
   *
   * Expected CSV format (header row required, column order flexible):
   *   sku_code,mrp,selling_price
   *   SKU001,999,799
   *
   * Accepted column name aliases:
   *   skuCode  → sku_code | sku | skuCode | variant_sku
   *   mrp      → mrp | price | maximum_retail_price
   *   selling  → selling_price | sale_price | sellingPrice | sp
   *
   * Returns: { imported, skipped, errors[] }
   *   - imported: rows successfully upserted
   *   - skipped:  rows with no numeric prices provided (treated as no-ops)
   *   - errors:   row-level issues (unknown SKU, parse failure, etc.)
   */
  async importPricesFromCsv(
    tenantKey: string,
    priceListId: string,
    csvBuffer: Buffer,
  ): Promise<{
    imported: number;
    skipped: number;
    errors: Array<{ row: number; skuCode: string | null; message: string }>;
  }> {
    const MAX_ROWS = 15_000;
    const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

    if (csvBuffer.length > MAX_BYTES) {
      throw new BadRequestException(
        `CSV file exceeds the 10 MB limit (received ${(csvBuffer.length / (1024 * 1024)).toFixed(1)} MB).`,
      );
    }

    await this.getPriceList(tenantKey, priceListId);

    // ── 1. Stream CSV into lines ──────────────────────────────────────────────
    const lines: string[] = await new Promise((resolve, reject) => {
      const collected: string[] = [];
      const rl = createInterface({
        input: Readable.from(csvBuffer),
        crlfDelay: Infinity,
      });
      rl.on("line", (line) => collected.push(line));
      rl.on("close", () => resolve(collected));
      rl.on("error", reject);
    });

    // Strip UTF-8 BOM from the first line if present
    if (lines[0]?.startsWith("﻿")) {
      lines[0] = lines[0].slice(1);
    }

    // ── 2. Resolve header columns ─────────────────────────────────────────────
    const headerLine = lines.find((l) => l.trim().length > 0);
    if (!headerLine) {
      throw new BadRequestException("CSV file is empty or contains no header row.");
    }

    const headers = this.parseCsvLine(headerLine).map((h) => h.toLowerCase().trim());

    const SKU_ALIASES = ["sku_code", "sku", "skucode", "variant_sku"];
    const MRP_ALIASES = ["mrp", "price", "maximum_retail_price"];
    const SP_ALIASES = ["selling_price", "sale_price", "sellingprice", "sp"];

    const skuIdx = headers.findIndex((h) => SKU_ALIASES.includes(h));
    const mrpIdx = headers.findIndex((h) => MRP_ALIASES.includes(h));
    const spIdx = headers.findIndex((h) => SP_ALIASES.includes(h));

    if (skuIdx === -1) {
      throw new BadRequestException(
        `CSV must have a column named one of: ${SKU_ALIASES.join(", ")}. ` +
          `Found headers: ${headers.join(", ")}`,
      );
    }
    if (mrpIdx === -1 && spIdx === -1) {
      throw new BadRequestException(
        `CSV must have at least one price column: ${[...MRP_ALIASES, ...SP_ALIASES].join(", ")}.`,
      );
    }

    // ── 3. Parse data rows ────────────────────────────────────────────────────
    const dataLines = lines.slice(lines.indexOf(headerLine) + 1).filter((l) => l.trim().length > 0);

    if (dataLines.length === 0) {
      throw new BadRequestException("CSV contains a header row but no data rows.");
    }
    if (dataLines.length > MAX_ROWS) {
      throw new BadRequestException(
        `CSV contains ${dataLines.length.toLocaleString()} data rows. ` +
          `Maximum allowed is ${MAX_ROWS.toLocaleString()}.`,
      );
    }

    type ParsedRow = {
      rowNumber: number;
      skuCode: string;
      mrp: number | null;
      sellingPrice: number | null;
    };

    const parsed: ParsedRow[] = [];
    const errors: Array<{ row: number; skuCode: string | null; message: string }> = [];

    dataLines.forEach((line, i) => {
      const rowNumber = i + 2; // 1-indexed, header is row 1
      const values = this.parseCsvLine(line);
      const rawSku = (values[skuIdx] ?? "").trim();
      if (!rawSku) {
        errors.push({ row: rowNumber, skuCode: null, message: "Missing SKU code" });
        return;
      }
      const rawMrp = mrpIdx !== -1 ? (values[mrpIdx] ?? "").trim() : "";
      const rawSp = spIdx !== -1 ? (values[spIdx] ?? "").trim() : "";
      const mrp = rawMrp ? this.parsePrice(rawMrp) : null;
      const sellingPrice = rawSp ? this.parsePrice(rawSp) : null;
      if (rawMrp && mrp === null) {
        errors.push({ row: rowNumber, skuCode: rawSku, message: `Invalid MRP value: "${rawMrp}"` });
        return;
      }
      if (rawSp && sellingPrice === null) {
        errors.push({ row: rowNumber, skuCode: rawSku, message: `Invalid selling price value: "${rawSp}"` });
        return;
      }
      parsed.push({ rowNumber, skuCode: rawSku, mrp, sellingPrice });
    });

    if (parsed.length === 0) {
      return { imported: 0, skipped: 0, errors };
    }

    // ── 4. Batch-resolve variants by skuCode ──────────────────────────────────
    const skuCodes = [...new Set(parsed.map((r) => r.skuCode))];
    const foundVariants = await this.prisma.tenant().variant.findMany({
      where: { skuCode: { in: skuCodes }, tenantKey },
      select: { id: true, skuCode: true },
    });
    const skuToVariantId = new Map(foundVariants.map((v) => [v.skuCode, v.id]));

    // ── 5. Classify rows: upsert vs skip vs error ─────────────────────────────
    const toUpsert: Array<{ variantId: string; mrp: number | null; sellingPrice: number | null }> = [];
    let skipped = 0;

    for (const row of parsed) {
      const variantId = skuToVariantId.get(row.skuCode);
      if (!variantId) {
        errors.push({ row: row.rowNumber, skuCode: row.skuCode, message: `SKU not found in this tenant: ${row.skuCode}` });
        continue;
      }
      if (row.mrp === null && row.sellingPrice === null) {
        skipped++;
        continue;
      }
      toUpsert.push({ variantId, mrp: row.mrp, sellingPrice: row.sellingPrice });
    }

    // ── 6. Upsert in transaction ──────────────────────────────────────────────
    if (toUpsert.length > 0) {
      await this.prisma.tenant().$transaction(
        toUpsert.map((entry) =>
          this.prisma.tenant().productPrice.upsert({
            where: { priceListId_variantId: { priceListId, variantId: entry.variantId } },
            create: {
              tenantKey,
              priceListId,
              variantId: entry.variantId,
              mrp: entry.mrp,
              sellingPrice: entry.sellingPrice,
            },
            update: {
              mrp: entry.mrp,
              sellingPrice: entry.sellingPrice,
            },
          }),
        ),
      );
    }

    return { imported: toUpsert.length, skipped, errors };
  }

  /** Parses a single price string; returns null if unparseable or negative. */
  private parsePrice(raw: string): number | null {
    // Strip common currency symbols / whitespace
    const cleaned = raw.replace(/[₹$€£¥,\s]/g, "").trim();
    if (!cleaned) return null;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) && n >= 0 && n <= 999_999_999 ? n : null;
  }

  /** RFC4180-compliant CSV line parser (handles quoted fields and escaped quotes). */
  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const next = i < line.length - 1 ? line[i + 1] : "";
      if (char === '"' && inQuotes && next === '"') {
        current += '"';
        i++;
        continue;
      }
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (char === "," && !inQuotes) {
        values.push(current);
        current = "";
        continue;
      }
      current += char;
    }
    values.push(current);
    return values.map((v) => v.trim());
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  /**
   * Idempotent first-time setup for a tenant.
   * Creates an India market, INR currency, and a default price list
   * if the tenant has no markets at all. Safe to call multiple times.
   * Returns { created: true } if setup ran, { created: false } if already done.
   */
  async bootstrapDefaultPricing(tenantKey: string): Promise<{ created: boolean }> {
    const existingMarket = await this.prisma.tenant().market.findFirst({
      where: { tenantKey },
      select: { id: true },
    });
    if (existingMarket) {
      return { created: false };
    }

    await this.prisma.tenant().$transaction(async (tx) => {
      const market = await tx.market.create({
        data: {
          tenantKey,
          code: "IN",
          locale: "en-IN",
          displayName: "India",
          isDefault: true,
          status: "active",
        },
      });
      const currency = await tx.currency.create({
        data: {
          tenantKey,
          code: "INR",
          symbol: "₹",
          displayName: "Indian Rupee",
          decimalPlaces: 2,
        },
      });
      await tx.priceList.create({
        data: {
          tenantKey,
          name: "India – INR",
          marketId: market.id,
          currencyId: currency.id,
          isDefault: true,
          status: "active",
        },
      });
    });

    return { created: true };
  }

  // ── CSV Template Download ─────────────────────────────────────────────────

  /**
   * Generates a pre-filled CSV template for a price list.
   * Contains all tenant variants as rows, with their current MRP and selling
   * price (blank if unset). Operators download → fill blanks → re-upload via
   * the bulk import endpoint to close coverage gaps quickly.
   *
   * Columns: sku_code, mrp, selling_price
   * Encoding: UTF-8, CRLF line endings (RFC4180)
   */
  async getPriceListTemplate(
    tenantKey: string,
    priceListId: string,
  ): Promise<{ csv: string; filename: string }> {
    // 1. Confirm the price list exists and belongs to this tenant
    const priceList = await this.getPriceList(tenantKey, priceListId);

    // 2. Fetch all variants ordered by SKU for a stable, human-readable output
    const variants = await this.prisma.tenant().variant.findMany({
      where: { tenantKey },
      select: { id: true, skuCode: true },
      orderBy: { skuCode: "asc" },
    });

    // 3. Fetch existing prices for this price list so the template comes
    //    pre-filled — operators see what's already set and only fill gaps.
    const prices = await this.prisma.tenant().productPrice.findMany({
      where: { tenantKey, priceListId },
      select: { variantId: true, mrp: true, sellingPrice: true },
    });
    const priceMap = new Map(prices.map((p) => [p.variantId, p]));

    // 4. Build CSV rows
    const header = "sku_code,mrp,selling_price";
    const rows = variants.map((v) => {
      const p = priceMap.get(v.id);
      const mrp = p?.mrp != null ? String(p.mrp) : "";
      const sp = p?.sellingPrice != null ? String(p.sellingPrice) : "";
      return `${v.skuCode},${mrp},${sp}`;
    });
    // RFC4180: CRLF, trailing newline
    const csv = [header, ...rows].join("\r\n") + "\r\n";

    // 5. Derive a filesystem-safe filename from the price list name
    const safeName = priceList.name
      .replace(/[^a-z0-9-_\s]/gi, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 40);
    const filename = `pricelist-${safeName || priceListId.slice(0, 8)}-template.csv`;

    return { csv, filename };
  }

  // ── Pricing Coverage ──────────────────────────────────────────────────────

  /**
   * Returns a snapshot of how many variants have prices in each active price
   * list, plus a summary for the default price list.
   *
   * "Priced" means a ProductPrice row exists with at least one non-null value
   * (mrp or sellingPrice). Rows where both fields are null are treated as
   * unpriced because they carry no useful pricing information.
   */
  async getPricingCoverage(tenantKey: string) {
    // 1. Count all variants for this tenant (regardless of status — even draft
    //    variants need prices before they can be published)
    const totalVariants = await this.prisma.tenant().variant.count({
      where: { tenantKey },
    });

    // 2. Fetch all active price lists with their market + currency
    const priceLists = await this.prisma.tenant().priceList.findMany({
      where: { tenantKey, status: "active" },
      include: {
        market: { select: { code: true, displayName: true } },
        currency: { select: { code: true, symbol: true } },
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });

    // 3. Count priced variants per active price list in one aggregate query.
    //    ProductPrice has a unique constraint on (priceListId, variantId),
    //    so counting rows is equivalent to counting distinct priced variants.
    const pricedCountsRaw = await this.prisma.tenant().productPrice.groupBy({
      by: ["priceListId"],
      where: {
        tenantKey,
        priceListId: { in: priceLists.map((pl) => pl.id) },
        OR: [{ mrp: { not: null } }, { sellingPrice: { not: null } }],
      },
      _count: { variantId: true },
    });
    const pricedByList = new Map(
      pricedCountsRaw.map((r) => [r.priceListId, r._count.variantId]),
    );

    // 4. Build per-list coverage records
    const perPriceList = priceLists.map((pl) => {
      const pricedVariants = pricedByList.get(pl.id) ?? 0;
      const unpricedVariants = Math.max(0, totalVariants - pricedVariants);
      const coveragePercent =
        totalVariants > 0 ? Math.round((pricedVariants / totalVariants) * 100) : 0;
      return {
        id: pl.id,
        name: pl.name,
        isDefault: pl.isDefault,
        status: pl.status as string,
        market: { code: pl.market.code, displayName: pl.market.displayName },
        currency: { code: pl.currency.code, symbol: pl.currency.symbol },
        totalVariants,
        pricedVariants,
        unpricedVariants,
        coveragePercent,
      };
    });

    // 5. Identify the default list and build the top-level summary
    const defaultEntry = perPriceList.find((pl) => pl.isDefault) ?? null;
    const pricedInDefaultList = defaultEntry?.pricedVariants ?? 0;
    const unpricedInDefaultList = defaultEntry
      ? Math.max(0, totalVariants - pricedInDefaultList)
      : totalVariants;
    const defaultListCoverage = defaultEntry?.coveragePercent ?? 0;

    return {
      totalVariants,
      defaultPriceList: defaultEntry
        ? { id: defaultEntry.id, name: defaultEntry.name }
        : null,
      pricedInDefaultList,
      unpricedInDefaultList,
      defaultListCoverage,
      totalActivePriceLists: priceLists.length,
      perPriceList,
    };
  }

  async upsertPrices(tenantKey: string, priceListId: string, dto: UpsertProductPricesDto) {
    await this.getPriceList(tenantKey, priceListId);

    if (dto.prices.length === 0) {
      return { upserted: 0 };
    }

    // Validate all variantIds belong to this tenant in one query
    const variantIds = dto.prices.map((p) => p.variantId);
    const foundVariants = await this.prisma.tenant().variant.findMany({
      where: { id: { in: variantIds }, tenantKey },
      select: { id: true },
    });
    const foundSet = new Set(foundVariants.map((v) => v.id));
    const missing = variantIds.filter((vid) => !foundSet.has(vid));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Variant(s) not found in this tenant: ${missing.slice(0, 5).join(", ")}`,
      );
    }

    // Upsert each row individually — Prisma doesn't support bulk upsert with
    // per-row conflict targets, and the data set is small (prices per list).
    await this.prisma.tenant().$transaction(
      dto.prices.map((entry) =>
        this.prisma.tenant().productPrice.upsert({
          where: { priceListId_variantId: { priceListId, variantId: entry.variantId } },
          create: {
            tenantKey,
            priceListId,
            variantId: entry.variantId,
            mrp: entry.mrp ?? null,
            sellingPrice: entry.sellingPrice ?? null,
          },
          update: {
            mrp: entry.mrp ?? null,
            sellingPrice: entry.sellingPrice ?? null,
          },
        }),
      ),
    );

    return { upserted: dto.prices.length };
  }
}
