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
});
