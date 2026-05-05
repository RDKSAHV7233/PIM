import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaDirectService implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClient;

  constructor() {
    const directUrl = String(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? "").trim();
    if (!directUrl) {
      throw new Error("DATABASE_URL_DIRECT is not configured.");
    }
    this.client = new PrismaClient({
      datasources: {
        db: {
          url: directUrl,
        },
      },
    });
  }

  getClient(): PrismaClient {
    return this.client;
  }

  async onModuleInit() {
    if (String(process.env.AUTH_MODE ?? "").trim().toLowerCase() !== "db") {
      return;
    }
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
