import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { validateEnv } from "./common/env-validation";
import { correlationMiddleware } from "./common/logging/correlation.middleware";
import { LoggerService } from "./common/logging/logger.service";

const EXPRESS_BODY_LIMIT = "10mb";

async function bootstrap() {
  const env = validateEnv();

  if (env.SENTRY_DSN) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
      const Sentry = require("@sentry/node");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: env.APP_ENV,
        tracesSampleRate: env.APP_ENV === "production" ? 0.1 : 1.0,
      });
    } catch {
      // @sentry/node not installed — error tracking unavailable
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.use(json({ limit: EXPRESS_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: EXPRESS_BODY_LIMIT }));
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
    }),
  );

  app.use(correlationMiddleware);
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
  await app.listen(port, "0.0.0.0");
  app.get(LoggerService).info("API running", {
    port,
    baseUrl: `http://localhost:${port}/api/v1`,
  });
}

bootstrap();
