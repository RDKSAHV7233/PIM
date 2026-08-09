const { BadRequestException, UnauthorizedException } = require("@nestjs/common");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "CommonJS",
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    types: ["node"],
  },
});

const {
  NextServerErrorIngestController,
  normalizeTrustedNextServerPayload,
} = require("../../src/error-authority/next-server-ingest.controller");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectRejectsInstanceOf(promise, ExpectedCtor, message) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ExpectedCtor) {
      return;
    }
    throw new Error(`${message}; got ${error && error.constructor ? error.constructor.name : String(error)}`);
  }
  throw new Error(message);
}

async function main() {
  const previousToken = process.env.ERROR_AUTHORITY_INGEST_TOKEN;
  try {
    process.env.ERROR_AUTHORITY_INGEST_TOKEN = "trusted-error-authority-token-minimum-32";
    const captureUnexpected = async (event) => {
      captured.push(event);
    };
    const captured = [];
    const controller = new NextServerErrorIngestController({ captureUnexpected });

    await expectRejectsInstanceOf(
      controller.ingestNextServerError(
        "wrong-token",
        { sourceEventId: "next_server:test", errorName: "Error" },
        { ip: "127.0.0.1", socket: {} },
      ),
      UnauthorizedException,
      "trusted ingest endpoint must fail closed without the correct token",
    );
    assert(captured.length === 0, "auth failure must not call ErrorCaptureService");

    const response = await controller.ingestNextServerError(
      "trusted-error-authority-token-minimum-32",
      {
        sourceEventId: "next_server:test-safe",
        release: "976ab94a9191e68800debe5b3ed312194f4b0451",
        routeTemplate: "/products/[id]?token=must-not-persist",
        method: "post",
        statusCode: 500,
        requestId: "req-safe-123",
        errorName: "RenderFailure",
        errorCode: "RenderFailure",
        category: "rendering",
        severity: "p1",
        frames: [{ file: "/home/user/app/page.tsx?secret=one", functionName: "Page", line: 12, column: 4 }],
        headers: { authorization: "Bearer secret" },
        body: { productTitle: "Do not persist" },
      },
      { ip: "127.0.0.1", socket: {} },
    );

    assert(response.accepted === true, "valid trusted ingest must return accepted=true");
    assert(captured.length === 1, `expected one captured event, got ${captured.length}`);
    const event = captured[0];
    assert(event.runtime === "next_server", `unexpected runtime ${event.runtime}`);
    assert(event.service === "vexa-pim-web", `unexpected service ${event.service}`);
    assert(event.release === "976ab94a9191e68800debe5b3ed312194f4b0451", `unexpected release ${event.release}`);
    assert(event.routeTemplate === "/products/[id]", `query string leaked into routeTemplate: ${event.routeTemplate}`);
    assert(event.method === "POST", `unexpected method ${event.method}`);
    assert(event.statusCode === 500, `unexpected status ${event.statusCode}`);
    assert(event.requestId === "req-safe-123", `unexpected requestId ${event.requestId}`);
    assert(event.sourceEventId === "next_server:test-safe", `unexpected sourceEventId ${event.sourceEventId}`);
    assert(event.category === "rendering", `unexpected category ${event.category}`);
    assert(event.severity === "p1", `unexpected severity ${event.severity}`);
    assert(event.error instanceof Error, "capture service must receive an Error object");
    assert(event.error.message === "Unexpected Next.js server error", `unsafe message persisted: ${event.error.message}`);
    assert(JSON.stringify(event).includes("Bearer secret") === false, "header secret leaked into capture event");
    assert(JSON.stringify(event).includes("Do not persist") === false, "body content leaked into capture event");

    try {
      normalizeTrustedNextServerPayload(null);
      throw new Error("malformed payload should have thrown");
    } catch (error) {
      assert(error instanceof BadRequestException, "malformed payload must fail as BadRequestException");
    }
    try {
      normalizeTrustedNextServerPayload({ errorName: "Error" });
      throw new Error("missing sourceEventId should have thrown");
    } catch (error) {
      assert(error instanceof BadRequestException, "missing sourceEventId must fail as BadRequestException");
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "trusted_ingest_auth_fails_closed",
            "trusted_ingest_calls_canonical_capture_service",
            "next_server_runtime_and_service",
            "source_event_id_forwarded_for_idempotency",
            "release_forwarded_from_web",
            "query_header_body_fields_not_forwarded",
            "malformed_payload_rejected",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    process.env.ERROR_AUTHORITY_INGEST_TOKEN = previousToken;
  }
}

main().catch((error) => {
  console.error("Error Authority next-server ingest integration test failed:");
  console.error(error);
  process.exit(1);
});
