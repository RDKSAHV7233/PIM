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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.use(json({ limit: EXPRESS_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: EXPRESS_BODY_LIMIT }));
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
