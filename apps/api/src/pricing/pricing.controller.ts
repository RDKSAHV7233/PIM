// apps/api/src/pricing/pricing.controller.ts
// REST API for Market, Currency, PriceList and ProductPrice management.
//
// RBAC:
//   - All GET endpoints: admin + editor (admin_editor classification)
//   - All mutating endpoints: admin + editor roles
//   - Price list configuration is operational data — not exposed to API clients
//     (denied_human_only) to prevent unintended programmatic price mutations.

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiOperation, ApiProduces, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { ApiClientPolicy } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { Roles } from "../common/rbac/roles";
import { CreateMarketDto } from "./dto/create-market.dto";
import { UpdateMarketDto } from "./dto/update-market.dto";
import { CreateCurrencyDto } from "./dto/create-currency.dto";
import { UpdateCurrencyDto } from "./dto/update-currency.dto";
import { CreatePriceListDto } from "./dto/create-price-list.dto";
import { UpdatePriceListDto } from "./dto/update-price-list.dto";
import { UpsertProductPricesDto } from "./dto/upsert-product-prices.dto";
import { PricingService } from "./pricing.service";

type TenantRequest = Request & { pimTenant?: string };

@Controller("pricing")
@ApiClientPolicy("denied_human_only")
@ApiTags("Pricing")
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  private tenantKey(req: TenantRequest): string {
    return req.pimTenant ?? "default";
  }

  // ── Markets ────────────────────────────────────────────────────────────────

  @Get("markets")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none" })
  @ApiOperation({ summary: "List all markets for this tenant" })
  @ApiResponse({ status: 200 })
  listMarkets(@Req() req: TenantRequest) {
    return this.pricingService.listMarkets(this.tenantKey(req));
  }

  @Get("markets/:id")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none" })
  @ApiOperation({ summary: "Get a single market" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  getMarket(@Req() req: TenantRequest, @Param("id") id: string) {
    return this.pricingService.getMarket(this.tenantKey(req), id);
  }

  @Post("markets")
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Create a market" })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 409, description: "Market code+locale already exists" })
  createMarket(@Req() req: TenantRequest, @Body() dto: CreateMarketDto) {
    return this.pricingService.createMarket(this.tenantKey(req), dto);
  }

  @Patch("markets/:id")
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Update a market" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  updateMarket(@Req() req: TenantRequest, @Param("id") id: string, @Body() dto: UpdateMarketDto) {
    return this.pricingService.updateMarket(this.tenantKey(req), id, dto);
  }

  @Delete("markets/:id")
  @Roles("admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a market (fails if price lists reference it)" })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 409, description: "Market still referenced by price lists" })
  deleteMarket(@Req() req: TenantRequest, @Param("id") id: string) {
    return this.pricingService.deleteMarket(this.tenantKey(req), id);
  }

  // ── Currencies ─────────────────────────────────────────────────────────────

  @Get("currencies")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none" })
  @ApiOperation({ summary: "List all currencies for this tenant" })
  listCurrencies(@Req() req: TenantRequest) {
    return this.pricingService.listCurrencies(this.tenantKey(req));
  }

  @Get("currencies/:id")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none" })
  @ApiOperation({ summary: "Get a single currency" })
  @ApiResponse({ status: 404 })
  getCurrency(@Req() req: TenantRequest, @Param("id") id: string) {
    return this.pricingService.getCurrency(this.tenantKey(req), id);
  }

  @Post("currencies")
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Create a currency" })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 409, description: "Currency code already exists for this tenant" })
  createCurrency(@Req() req: TenantRequest, @Body() dto: CreateCurrencyDto) {
    return this.pricingService.createCurrency(this.tenantKey(req), dto);
  }

  @Patch("currencies/:id")
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Update a currency" })
  updateCurrency(@Req() req: TenantRequest, @Param("id") id: string, @Body() dto: UpdateCurrencyDto) {
    return this.pricingService.updateCurrency(this.tenantKey(req), id, dto);
  }

  @Delete("currencies/:id")
  @Roles("admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a currency (fails if price lists reference it)" })
  deleteCurrency(@Req() req: TenantRequest, @Param("id") id: string) {
    return this.pricingService.deleteCurrency(this.tenantKey(req), id);
  }

  // ── Price Lists ────────────────────────────────────────────────────────────

  @Get("price-lists")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none" })
  @ApiOperation({ summary: "List all price lists (with market + currency)" })
  listPriceLists(@Req() req: TenantRequest) {
    return this.pricingService.listPriceLists(this.tenantKey(req));
  }

  @Get("price-lists/:id")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none" })
  @ApiOperation({ summary: "Get a single price list" })
  @ApiResponse({ status: 404 })
  getPriceList(@Req() req: TenantRequest, @Param("id") id: string) {
    return this.pricingService.getPriceList(this.tenantKey(req), id);
  }

  @Post("price-lists")
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Create a price list" })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: "marketId or currencyId not found in this tenant" })
  @ApiResponse({ status: 409, description: "Duplicate market+currency combination" })
  createPriceList(@Req() req: TenantRequest, @Body() dto: CreatePriceListDto) {
    return this.pricingService.createPriceList(this.tenantKey(req), dto);
  }

  @Patch("price-lists/:id")
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Update a price list" })
  updatePriceList(@Req() req: TenantRequest, @Param("id") id: string, @Body() dto: UpdatePriceListDto) {
    return this.pricingService.updatePriceList(this.tenantKey(req), id, dto);
  }

  @Delete("price-lists/:id")
  @Roles("admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a price list and all its product prices" })
  deletePriceList(@Req() req: TenantRequest, @Param("id") id: string) {
    return this.pricingService.deletePriceList(this.tenantKey(req), id);
  }

  // ── Product Prices ─────────────────────────────────────────────────────────

  @Get("price-lists/:id/prices")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none" })
  @ApiOperation({ summary: "List all product prices in a price list" })
  @ApiResponse({ status: 404, description: "Price list not found" })
  listPrices(@Req() req: TenantRequest, @Param("id") id: string) {
    return this.pricingService.listPrices(this.tenantKey(req), id);
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  /**
   * CSV template download: returns all variant SKUs with their current prices
   * pre-filled, ready for the operator to complete and re-upload via the import
   * endpoint.  Columns: sku_code, mrp, selling_price.
   */
  @Get("price-lists/:id/prices/template")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none" })
  @ApiOperation({
    summary: "Download a price list CSV template",
    description:
      "Returns a UTF-8 CSV file with all tenant variant SKUs as rows. " +
      "Existing MRP and selling price values are pre-filled; unset cells are blank. " +
      "Download, complete the blanks, and upload via POST /pricing/price-lists/:id/prices/import.",
  })
  @ApiProduces("text/csv")
  @ApiResponse({ status: 200, description: "text/csv attachment" })
  @ApiResponse({ status: 404, description: "Price list not found" })
  async downloadPriceTemplate(
    @Req() req: TenantRequest,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { csv, filename } = await this.pricingService.getPriceListTemplate(
      this.tenantKey(req),
      id,
    );
    res.header("Content-Type", "text/csv; charset=utf-8");
    res.header("Content-Disposition", `attachment; filename="${filename}"`);
    res.header("Content-Length", String(Buffer.byteLength(csv, "utf-8")));
    return csv;
  }

  // ── Coverage ──────────────────────────────────────────────────────────────

  /**
   * Returns a coverage snapshot: how many variants have prices in each active
   * price list, and a summary for the default list.
   * A variant is "priced" if it has at least one non-null price value.
   */
  @Get("coverage")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none" })
  @ApiOperation({
    summary: "Pricing coverage by price list",
    description:
      "Returns how many variants have prices set in each active price list, " +
      "plus a top-level summary for the default list. A variant counts as " +
      "'priced' if at least one of mrp or sellingPrice is non-null.",
  })
  @ApiResponse({ status: 200, description: "PricingCoverage snapshot" })
  getCoverage(@Req() req: TenantRequest) {
    return this.pricingService.getPricingCoverage(this.tenantKey(req));
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  /**
   * Idempotent first-time setup: creates India market, INR currency, and a
   * default price list if the tenant has no markets yet.
   * Safe to call multiple times; returns { created: false } if already done.
   * Intended for ops use after provisioning an existing tenant.
   */
  @Post("bootstrap")
  @Roles("admin")
  @ApiOperation({
    summary: "Bootstrap default pricing config (India market + INR + default price list)",
    description:
      "Idempotent. Creates one India market, one INR currency, and one default price list if " +
      "the tenant has no pricing data yet. Returns { created: true } on first run, " +
      "{ created: false } on subsequent runs.",
  })
  @ApiResponse({ status: 201, description: "{ created: boolean }" })
  bootstrapDefaultPricing(@Req() req: TenantRequest) {
    return this.pricingService.bootstrapDefaultPricing(this.tenantKey(req));
  }

  /**
   * CSV import: upload a CSV file to bulk-set prices for a price list.
   * Required column: sku_code (or sku / skuCode / variant_sku)
   * At least one price column required: mrp / selling_price
   * Max 15,000 rows, 10 MB.
   */
  @Post("price-lists/:id/prices/import")
  @Roles("admin", "editor")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "Import prices from a CSV file",
    description:
      "Upload a CSV file to bulk-set MRP and selling price for all variants in this price list. " +
      "Required column: sku_code (or sku / skuCode). Optional columns: mrp, selling_price. " +
      "Returns { imported, skipped, errors[] }.",
  })
  @ApiResponse({ status: 201, description: "{ imported: N, skipped: N, errors: [] }" })
  @ApiResponse({ status: 400, description: "Parse error, missing column, or file too large" })
  importPrices(
    @Req() req: TenantRequest,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException("A CSV file is required. Upload it as multipart/form-data field 'file'.");
    }
    return this.pricingService.importPricesFromCsv(this.tenantKey(req), id, file.buffer);
  }

  @Put("price-lists/:id/prices")
  @Roles("admin", "editor")
  @ApiOperation({
    summary: "Bulk-upsert prices for a price list",
    description:
      "Creates or updates ProductPrice rows for the given variantIds. " +
      "Sending the same variantId twice in one request is a validation error.",
  })
  @ApiResponse({ status: 200, description: "{ upserted: N }" })
  @ApiResponse({ status: 400, description: "Unknown variantId(s)" })
  upsertPrices(@Req() req: TenantRequest, @Param("id") id: string, @Body() dto: UpsertProductPricesDto) {
    return this.pricingService.upsertPrices(this.tenantKey(req), id, dto);
  }
}
