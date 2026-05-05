#!/usr/bin/env node
/* eslint-disable no-console */
require("reflect-metadata");
const fs = require("node:fs");
const path = require("node:path");
const { NestFactory } = require("@nestjs/core");
const { DocumentBuilder, SwaggerModule } = require("@nestjs/swagger");
const { stringify: toYaml } = require("yaml");
const { AppModule } = require("../apps/api/dist/app.module");

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
if (!process.env.DATABASE_URL_POOLED && process.env.DATABASE_URL) {
  process.env.DATABASE_URL_POOLED = process.env.DATABASE_URL;
}

async function generate() {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
    abortOnError: false,
  });
  app.setGlobalPrefix("api/v1");
  const config = new DocumentBuilder()
    .setTitle("Vexa PIM API")
    .setDescription("Vexa PIM API OpenAPI specification")
    .setVersion("1.0.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  const docsDir = path.resolve(process.cwd(), "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  const yamlPath = path.join(docsDir, "openapi.yaml");
  const jsonPath = path.join(docsDir, "openapi.json");
  fs.writeFileSync(yamlPath, toYaml(document), "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify(document, null, 2), "utf8");
  await app.close();
  console.log(`Generated ${yamlPath} and ${jsonPath}`);
}

generate().catch((error) => {
  console.error("OpenAPI generation failed:");
  console.error(error);
  process.exitCode = 1;
});
