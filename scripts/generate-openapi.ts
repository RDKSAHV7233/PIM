import "reflect-metadata";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { stringify as toYaml } from "yaml";
import { AppModule } from "../apps/api/src/app.module.ts";

async function generate(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false },
  );

  const config = new DocumentBuilder()
    .setTitle("TEJ PIM API")
    .setDescription("TEJ PIM API OpenAPI specification")
    .setVersion("1.0.0")
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const docsDir = path.resolve(process.cwd(), "docs");
  mkdirSync(docsDir, { recursive: true });
  const yamlPath = path.join(docsDir, "openapi.yaml");
  const jsonPath = path.join(docsDir, "openapi.json");

  writeFileSync(yamlPath, toYaml(document), "utf8");
  writeFileSync(jsonPath, JSON.stringify(document, null, 2), "utf8");

  await app.close();
  // eslint-disable-next-line no-console
  console.log(`Generated ${yamlPath} and ${jsonPath}`);
}

generate().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
