import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  extractErrorCode,
  ApiExceptionCaptureFilter,
  isNulByteDatabaseError,
  isPoolTimeoutError,
  resolveRouteTemplate,
  resolveStatusCode,
  shouldCaptureApiException,
} from "./api-exception-capture.filter";

describe("ApiExceptionCaptureFilter policy", () => {
  it("excludes expected validation, auth, not-found, conflict, and rate-limit statuses", () => {
    const expected = [
      new BadRequestException({ error: "BAD_INPUT" }),
      new UnauthorizedException({ error: "UNAUTHENTICATED" }),
      new ForbiddenException({ error: "FORBIDDEN" }),
      new NotFoundException({ error: "NOT_FOUND" }),
      new ConflictException({ error: "VERSION_CONFLICT" }),
      new UnprocessableEntityException({ error: "DOMAIN_REJECTED" }),
      new HttpException({ error: "RATE_LIMITED" }, 429),
    ];

    for (const exception of expected) {
      expect(shouldCaptureApiException(exception)).toBe(false);
    }
  });

  it("captures unexpected errors and 5xx HTTP exceptions", () => {
    expect(shouldCaptureApiException(new Error("boom"))).toBe(true);
    expect(shouldCaptureApiException(new InternalServerErrorException({ error: "INTERNAL" }))).toBe(true);
    expect(shouldCaptureApiException(new ServiceUnavailableException({ error: "UPSTREAM_DOWN" }))).toBe(true);
  });

  it("extracts safe status and code metadata", () => {
    const exception = new HttpException({ code: "SAFE_CODE", error: "IGNORED" }, 502);
    expect(resolveStatusCode(exception)).toBe(502);
    expect(extractErrorCode(exception)).toBe("SAFE_CODE");
    expect(resolveStatusCode(new Error("boom"))).toBe(500);
    expect(extractErrorCode(new Error("boom"))).toBe("Error");
  });

  it("uses route templates or strips raw URL query strings", () => {
    expect(
      resolveRouteTemplate({
        baseUrl: "/api/v1/catalog",
        route: { path: "/products/:id" },
      } as never),
    ).toBe("/api/v1/catalog/products/:id");
    expect(
      resolveRouteTemplate({
        originalUrl: "/api/v1/catalog/products/cm123?token=secret",
      } as never),
    ).toBe("/api/v1/catalog/products/cm123");
  });

  it("captures unexpected errors once and delegates response handling", () => {
    const captureUnexpected = jest.fn().mockResolvedValue(undefined);
    const reply = jest.fn();
    const filter = new ApiExceptionCaptureFilter({ captureUnexpected } as never, {
      httpAdapter: {
        reply,
        isHeadersSent: () => false,
      },
    } as never);
    const request = {
      method: "GET",
      baseUrl: "/api/v1/catalog",
      route: { path: "/products/:id" },
      pimUserId: "user@example.com",
      pimAuthType: "user_jwt",
    };
    const host = {
      getType: () => "http",
      getArgByIndex: (index: number) => index === 0 ? request : {},
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
    } as never;
    const error = new Error("boom");

    filter.catch(error, host);
    filter.catch(error, host);

    expect(captureUnexpected).toHaveBeenCalledTimes(1);
    expect(captureUnexpected).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "api",
        service: "vexa-pim-api",
        method: "GET",
        routeTemplate: "/api/v1/catalog/products/:id",
        statusCode: 500,
        rawActorId: "user@example.com",
        actorType: "human",
      }),
    );
    expect(reply).toHaveBeenCalled();
  });

  it("does not capture expected 4xx exceptions", () => {
    const captureUnexpected = jest.fn().mockResolvedValue(undefined);
    const filter = new ApiExceptionCaptureFilter({ captureUnexpected } as never, {
      httpAdapter: {
        reply: jest.fn(),
        isHeadersSent: () => false,
      },
    } as never);
    const request = { method: "POST", originalUrl: "/api/v1/catalog?token=secret" };
    const host = {
      getType: () => "http",
      getArgByIndex: (index: number) => index === 0 ? request : {},
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
    } as never;

    filter.catch(new BadRequestException({ error: "VALIDATION_FAILED" }), host);

    expect(captureUnexpected).not.toHaveBeenCalled();
  });

  it("fails open: capture rejection is swallowed and original response is still sent", async () => {
    const captureUnexpected = jest.fn().mockRejectedValue(new Error("db down"));
    const reply = jest.fn();
    const warnSpy = jest.fn();
    const filter = new ApiExceptionCaptureFilter(
      { captureUnexpected } as never,
      { httpAdapter: { reply, isHeadersSent: () => false } } as never,
      { warn: warnSpy } as never,
    );
    const host = {
      getType: () => "http",
      getArgByIndex: (index: number) => index === 0 ? {} : {},
      switchToHttp: () => ({ getRequest: () => ({ method: "GET", originalUrl: "/api/v1/test" }), getResponse: () => ({}) }),
    } as never;

    filter.catch(new Error("boom"), host);
    // Let the microtask queue drain so the .catch() fires
    await Promise.resolve();

    expect(reply).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed open"),
      expect.objectContaining({ captureError: "db down" }),
    );
  });

  it("does not send sensitive headers or request body to Error Authority", () => {
    const captureUnexpected = jest.fn().mockResolvedValue(undefined);
    const filter = new ApiExceptionCaptureFilter({ captureUnexpected } as never, {
      httpAdapter: { reply: jest.fn(), isHeadersSent: () => false },
    } as never);
    const request = {
      method: "POST",
      originalUrl: "/api/v1/products",
      headers: { authorization: "Bearer secret_token", cookie: "session=abc", "x-api-key": "key_123" },
      body: { title: "Tenant Product", price: 99.99, sku: "SKU-001" },
      pimUserId: "uid_tenant_a",
    };
    const host = {
      getType: () => "http",
      getArgByIndex: (index: number) => index === 0 ? request : {},
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    } as never;

    filter.catch(new Error("connector failure"), host);

    const callArg = captureUnexpected.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg["rawActorId"]).toBe("uid_tenant_a");
    // No raw headers, cookies, or body in the capture input
    expect(callArg).not.toHaveProperty("headers");
    expect(callArg).not.toHaveProperty("body");
    expect(callArg).not.toHaveProperty("cookies");
    expect(JSON.stringify(callArg)).not.toContain("secret_token");
    expect(JSON.stringify(callArg)).not.toContain("Tenant Product");
    expect(JSON.stringify(callArg)).not.toContain("key_123");
  });
});

describe("isNulByteDatabaseError (prod-cert DEF-PC-010, root-cause mapping)", () => {
  it("recognises both Prisma shapes seen against Postgres for a NUL byte", () => {
    const raw = Object.assign(
      new Error('Invalid `prisma.$queryRaw()` invocation: Raw query failed. Code: `22021`. Message: `ERROR: invalid byte sequence for encoding "UTF8": 0x00`'),
      { code: "P2010", meta: { code: "22021", message: 'ERROR: invalid byte sequence for encoding "UTF8": 0x00' } },
    );
    const model = new Error('Invalid `prisma.category.create()` invocation: code: "22021", message: "invalid byte sequence for encoding \\"UTF8\\": 0x00", severity: "ERROR"');
    expect(isNulByteDatabaseError(raw)).toBe(true);
    expect(isNulByteDatabaseError(model)).toBe(true);
  });

  it("does not misclassify other database or application errors", () => {
    expect(isNulByteDatabaseError(new Error("Timed out fetching a new connection from the connection pool"))).toBe(false);
    expect(isNulByteDatabaseError(new Error('invalid byte sequence for encoding "UTF8": 0xe9'))).toBe(false);
    expect(isNulByteDatabaseError("invalid byte sequence for encoding 0x00")).toBe(false);
    expect(isNulByteDatabaseError(null)).toBe(false);
  });

  it("the filter turns such an error into an expected 400 (not captured as a P1 server fault)", () => {
    const captureUnexpected = jest.fn().mockResolvedValue(undefined);
    const reply = jest.fn();
    const adapter = { reply, isHeadersSent: () => false, end: jest.fn(), getRequestMethod: () => "POST", getRequestUrl: () => "/x" };
    const filter = new ApiExceptionCaptureFilter({ captureUnexpected } as never, { httpAdapter: adapter } as never);
    const host = {
      getType: () => "http",
      getArgByIndex: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ method: "POST", originalUrl: "/x" }), getResponse: () => ({}) }),
    };
    filter.catch(new Error('ERROR: invalid byte sequence for encoding "UTF8": 0x00'), host as never);
    expect(captureUnexpected).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ error: "VALIDATION_FAILED" }), 400);
  });
});

describe("isPoolTimeoutError / pool timeout -> 503 (DEF-PC-015 / DEF-PC-022)", () => {
  const poolError = () =>
    Object.assign(new Error("Invalid `prisma.product.create()` invocation: Timed out fetching a new connection from the connection pool. (Current connection pool timeout: 10, connection limit: 5)"), { code: "P2024" });

  it("recognises P2024 by code and by message, and nothing else", () => {
    expect(isPoolTimeoutError(poolError())).toBe(true);
    expect(isPoolTimeoutError(Object.assign(new Error("x"), { code: "P2024" }))).toBe(true);
    expect(isPoolTimeoutError(new Error("Timed out fetching a new connection from the connection pool."))).toBe(true);
    expect(isPoolTimeoutError(new Error("Unique constraint failed"))).toBe(false);
    expect(isPoolTimeoutError(Object.assign(new Error("x"), { code: "P2002" }))).toBe(false);
    expect(isPoolTimeoutError("P2024")).toBe(false);
    expect(isPoolTimeoutError(null)).toBe(false);
  });

  it("the filter answers 503 DATABASE_BUSY with Retry-After and still captures the ORIGINAL error as a server fault", () => {
    const captureUnexpected = jest.fn().mockResolvedValue(undefined);
    const reply = jest.fn();
    const setHeader = jest.fn();
    const adapter = { reply, isHeadersSent: () => false, end: jest.fn(), getRequestMethod: () => "POST", getRequestUrl: () => "/x" };
    const filter = new ApiExceptionCaptureFilter({ captureUnexpected } as never, { httpAdapter: adapter } as never);
    const host = {
      getType: () => "http",
      getArgByIndex: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ method: "POST", originalUrl: "/x" }), getResponse: () => ({ setHeader }) }),
    };
    const original = poolError();
    filter.catch(original, host as never);

    expect(setHeader).toHaveBeenCalledWith("Retry-After", "5");
    expect(reply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ error: "DATABASE_BUSY" }),
      503,
    );
    expect(captureUnexpected).toHaveBeenCalledTimes(1);
    expect(captureUnexpected).toHaveBeenCalledWith(
      expect.objectContaining({ error: original, errorCode: "DATABASE_POOL_TIMEOUT", statusCode: 503, severity: "p1" }),
    );
  });

  it("other unexpected errors are unchanged: still 500 and no Retry-After", () => {
    const captureUnexpected = jest.fn().mockResolvedValue(undefined);
    const reply = jest.fn();
    const setHeader = jest.fn();
    const adapter = { reply, isHeadersSent: () => false, end: jest.fn(), getRequestMethod: () => "POST", getRequestUrl: () => "/x" };
    const filter = new ApiExceptionCaptureFilter({ captureUnexpected } as never, { httpAdapter: adapter } as never);
    const host = {
      getType: () => "http",
      getArgByIndex: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ method: "POST", originalUrl: "/x" }), getResponse: () => ({ setHeader }) }),
    };
    filter.catch(new Error("something else broke"), host as never);
    expect(setHeader).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.anything(), expect.anything(), 500);
  });
});
