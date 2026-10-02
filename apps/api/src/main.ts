import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { json, raw, urlencoded } from "express";
import helmet from "helmet";
import { validateEnv } from "./common/env-validation";
import { registerProcessGuards, runAndExitOnFailure } from "./common/process-guards";
import { rejectNulBytesMiddleware } from "./common/reject-nul-bytes.middleware";
import { validationExceptionFactory } from "./common/validation-exception.factory";
import { correlationMiddleware } from "./common/logging/correlation.middleware";
import { LoggerService } from "./common/logging/logger.service";
import { PrismaService } from "./prisma/prisma.service";
import { QueueService } from "./queue/queue.service";
import { sentryBeforeSend } from "./common/sentry-before-send";

const EXPRESS_BODY_LIMIT = "10mb";
const BOOT_DEBUG_ENABLED =
  String(process.env.PLAYWRIGHT_BOOT_DEBUG ?? "").trim() === "1" ||
  String(process.env.API_BOOT_DEBUG ?? "").trim().toLowerCase() === "true";

function bootDebug(message: string, meta?: Record<string, unknown>) {
  if (!BOOT_DEBUG_ENABLED) {
    return;
  }
  const payload = meta ? ` ${JSON.stringify(meta)}` : "";
  // eslint-disable-next-line no-console
  console.log(`[api-boot] ${message}${payload}`);
}

async function bootstrap() {
  registerProcessGuards();
  bootDebug("bootstrap:start");
  const env = validateEnv();
  bootDebug("env:validated", {
    appEnv: env.APP_ENV,
    authMode: env.AUTH_MODE,
    queueBackend: env.QUEUE_BACKEND,
    port: env.PORT,
  });
  bootDebug("app-module:import:start");
  const { AppModule } = await import("./app.module");
  bootDebug("app-module:import:done");

  if (env.SENTRY_DSN) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
      const Sentry = require("@sentry/node");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: env.APP_ENV,
        // Railway injects RAILWAY_GIT_COMMIT_SHA at deploy time; pins errors to
        // the exact commit in the Sentry UI. Absent outside Railway — graceful.
        release: process.env.RAILWAY_GIT_COMMIT_SHA,
        tracesSampleRate: env.APP_ENV === "production" ? 0.1 : 1.0,
        // Multi-tenant PIM: strip request body, cookies, and auth headers from
        // every captured event so tenant product data (titles, prices, SKUs)
        // and session credentials never leave this system boundary.
        beforeSend(event: unknown) {
          if (event && typeof event === "object") {
            const e = event as Record<string, unknown>;
            if (e.request && typeof e.request === "object") {
              const req = e.request as Record<string, unknown>;
              delete req.data;
              delete req.cookies;
              if (req.headers && typeof req.headers === "object") {
                const h = req.headers as Record<string, unknown>;
                delete h["authorization"];
                delete h["cookie"];
                delete h["x-api-key"];
              }
            }
          }
          return event;
        },
      });
    } catch (err: unknown) {
      // @sentry/node not installed or init failed — error tracking unavailable.
      // Log so a DSN misconfiguration is visible at startup rather than silently swallowed.
      console.warn("Sentry init failed:", err instanceof Error ? err.message : String(err));
    }
  }

  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
      const { NodeSDK } = require("@opentelemetry/sdk-node");
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
      const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const sdk = new NodeSDK({
        traceExporter: new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT }),
        serviceName: "vexa-pim-api",
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      sdk.start();
    } catch (err: unknown) {
      // @opentelemetry packages not installed or init failed — tracing unavailable.
      console.warn("OpenTelemetry init failed:", err instanceof Error ? err.message : String(err));
    }
  }

  bootDebug("nest:create:start");
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  bootDebug("nest:create:done");

  // Trust the Railway/Heroku proxy layer so req.ip is the real client IP,
  // not the proxy's IP. Required for IP-based rate limiting to be per-client.
  app.set("trust proxy", 1);

  app.use("/api/v1/billing/stripe/webhook", raw({ type: "*/*" }));
  // Resend delivery webhook is Svix-signed over the exact request bytes — it
  // needs the raw body, same as the Stripe webhook above, before json() parses.
  app.use("/api/v1/webhooks/resend", raw({ type: "*/*" }));
  // Connector webhook relay is HMAC-signed over the exact request bytes -- it
  // needs the raw body before json() parses, same as the Stripe/Resend webhooks above.
  app.use("/api/v1/connector-webhooks/relay", raw({ type: "*/*", limit: EXPRESS_BODY_LIMIT }));
  app.use(json({ limit: EXPRESS_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: EXPRESS_BODY_LIMIT }));
  app.use(
    helmet({
      contentSecurityPolicy: false,       // pure JSON API — no HTML responses
      crossOriginEmbedderPolicy: false,   // not serving cross-origin resources
    }),
  );
  // Root info endpoint (registered before setGlobalPrefix so it stays at /).
  app.getHttpAdapter().getInstance().get("/", (_request: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }) => {
    response.status(200).json({
      service: "Vexa PIM API",
      status: "ok",
      message: "Vexa PIM API is running.",
      env: env.APP_ENV,
      health: "/api/v1/health",
      docs: env.APP_ENV !== "production" ? "/api/v1/docs" : null,
    });
  });
  // Railway healthcheck alias — Railway's service dashboard may have the healthcheck path
  // configured as /health (without the /api/v1 prefix). Register a raw Express alias so
  // Railway's proxy confirms the app is alive regardless of the dashboard setting.
  app.getHttpAdapter().getInstance().get("/health", (_request: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }) => {
    response.status(200).json({ status: "ok", env: env.APP_ENV });
  });
  // Readiness alias at the same bare path as the liveness alias above, for the same
  // reason: Railway's dashboard-configured healthcheck path may not carry /api/v1.
  // Unlike liveness, this proves the instance can actually serve traffic (DB reachable)
  // before Railway's deploy cutover treats it as healthy.
  app.getHttpAdapter().getInstance().get(
    "/health/ready",
    async (_request: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }) => {
      try {
        await Promise.all([
          app.get(PrismaService).getPoolStats(),
          app.get(QueueService).checkRedisReady(),
        ]);
        response.status(200).json({ status: "ready" });
      } catch {
        response.status(503).json({ status: "not_ready" });
      }
    },
  );
  app.setGlobalPrefix("api/v1");
  const corsOrigin =
    env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : env.APP_ENV === "development" ? true : false;
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
      forbidNonWhitelisted: true,
      // Emit DTO validation failures on the same `{ error: CODE, ... }` envelope
      // the business-rule rejections use, so clients map errors deterministically.
      exceptionFactory: validationExceptionFactory,
    }),
  );

  app.use(correlationMiddleware);
  // NUL (U+0000) cannot be stored by Postgres; answer 400 instead of letting it surface as a 500.
  // Mounted after helmet, CORS and correlation so the 400 carries their headers and correlation id.
  app.use(rejectNulBytesMiddleware);
  if (env.APP_ENV !== "production") {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("Vexa PIM API")
      .setDescription("Vexa PIM REST API")
      .setVersion("1.0.0")
      .addBearerAuth()
      .build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("api/v1/docs", app, swaggerDocument, {
      jsonDocumentUrl: "api/v1/docs-json",
    });
  }

  const port = Number(env.PORT ?? 4000);
  bootDebug("listen:start", { port });
  await app.listen(port, "0.0.0.0");
  bootDebug("listen:done", { port });
  app.get(LoggerService).info("API running", {
    port,
    baseUrl: `http://localhost:${port}/api/v1`,
  });
}

runAndExitOnFailure(bootstrap);
