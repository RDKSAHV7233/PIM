import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { validateEnv } from "./common/env-validation";
import { correlationMiddleware } from "./common/logging/correlation.middleware";
import { LoggerService } from "./common/logging/logger.service";

const FASTIFY_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

async function bootstrap() {
  const env = validateEnv();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: FASTIFY_BODY_LIMIT_BYTES,
    }),
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
    }),
  );

  app.use(correlationMiddleware);
  if (env.APP_ENV !== "production") {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("PIM1 API")
      .setDescription("PIM1 REST API")
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
