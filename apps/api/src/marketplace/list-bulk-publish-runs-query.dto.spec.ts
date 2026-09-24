import "reflect-metadata";
import { ArgumentMetadata, BadRequestException, ValidationPipe } from "@nestjs/common";
import { validationExceptionFactory } from "../common/validation-exception.factory";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { ListBulkPublishRunsQueryDto } from "./dto/list-bulk-publish-runs-query.dto";
import { MarketplaceController } from "./marketplace.controller";

// Mirrors the global pipe in apps/api/src/main.ts. forbidNonWhitelisted is the option
// that matters: with a DTO lacking installationId, the request is rejected outright
// ("property installationId should not exist") before reaching the service.
const globalPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidUnknownValues: false,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});

function queryParamType(): ArgumentMetadata["metatype"] {
  const paramTypes = Reflect.getMetadata("design:paramtypes", MarketplaceController.prototype, "listBulkPublishRuns") as
    | Array<ArgumentMetadata["metatype"]>
    | undefined;
  return paramTypes?.[0];
}

describe("GET /marketplace/bulk-publish-runs query validation", () => {
  it("binds the query to a DTO that accepts installationId under the global pipe", async () => {
    const metatype = queryParamType();
    expect(metatype).toBe(ListBulkPublishRunsQueryDto);

    const query = await globalPipe.transform(
      { installationId: "inst_a", pagination: "cursor", limit: "2" },
      { type: "query", metatype },
    );

    expect(query).toBeInstanceOf(ListBulkPublishRunsQueryDto);
    expect(query).toMatchObject({ installationId: "inst_a", pagination: "cursor", limit: 2 });
  });

  it("would reject installationId if bound to the bare pagination DTO (guards against a revert)", async () => {
    await expect(
      globalPipe.transform({ installationId: "inst_a" }, { type: "query", metatype: CursorPaginationDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects an oversized installationId", async () => {
    await expect(
      globalPipe.transform({ installationId: "x".repeat(65) }, { type: "query", metatype: ListBulkPublishRunsQueryDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("forwards installationId from the query to the service", async () => {
    const listBulkPublishRuns = jest.fn().mockResolvedValue([]);
    const controller = new MarketplaceController({ listBulkPublishRuns } as never, {} as never);
    const query = Object.assign(new ListBulkPublishRunsQueryDto(), { installationId: "inst_b", limit: 20 });

    await controller.listBulkPublishRuns(query);

    expect(listBulkPublishRuns).toHaveBeenCalledWith(query, "inst_b");
  });
});
