// DEF-PC-011: GET /products?limit=N (without pagination=cursor) used to ignore `limit`
// and return the whole legacy list. The array shape stays, but `limit` is now honoured.

import { CatalogService } from "./catalog.service";

function makeService() {
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = { tenant: jest.fn().mockReturnValue({ product: { findMany } }) };
  const accessPolicy = {
    buildProductScopeWhere: jest.fn().mockResolvedValue({}),
    applyReadResponsePolicy: jest.fn((_actor: unknown, _policy: string, rows: unknown) => rows),
  };
  const service = new CatalogService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    accessPolicy as never,
    {} as never,
  );
  jest
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .spyOn(service as any, "attachCompletenessScores")
    .mockImplementation(async (rows: unknown) => rows);
  return { service, findMany };
}

const ACTOR = { id: "admin1", role: "admin" } as never;

describe("CatalogService.listProducts — non-cursor path honours limit", () => {
  it.each([1, 3, 50, 200])("limit=%i is passed to the query as take", async (limit) => {
    const { service, findMany } = makeService();
    await service.listProducts({ limit }, {}, ACTOR);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: limit }));
  });

  it("no limit keeps the legacy defensive cap of 500", async () => {
    const { service, findMany } = makeService();
    await service.listProducts({}, {}, ACTOR);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
  });

  it("a limit above the cap is still capped at 500", async () => {
    const { service, findMany } = makeService();
    await service.listProducts({ limit: 9999 }, {}, ACTOR);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
  });

  it("pagination=cursor is unchanged: fetches limit+1 rows and returns the cursor envelope", async () => {
    const { service, findMany } = makeService();
    const result = await service.listProducts({ pagination: "cursor", limit: 3 }, {}, ACTOR);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 4 }));
    expect(result).toEqual({ items: [], limit: 3, nextCursor: null });
  });
});
