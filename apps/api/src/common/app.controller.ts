import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";

@Controller()
@ApiTags("System")
export class AppController {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  @Public()
  @Get("health")
  @ApiOperation({ summary: "Health endpoint" })
  @ApiResponse({ status: 200, description: "Service health" })
  async health() {
    const dbPool = await this.prismaService.getPoolStats();
    const authMode = String(process.env.AUTH_MODE ?? "local").trim().toLowerCase();
    return {
      status: "ok",
      env: process.env.APP_ENV ?? "development",
      auth: {
        mode: authMode || "local",
        identitySource: authMode === "db" ? "database" : "local_env",
      },
      db_pool: dbPool,
      queues: this.queueService.getMetrics(),
    };
  }
}
