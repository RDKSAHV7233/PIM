import { Controller, Get, Header, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator";
import { AdminBoundaryAccess } from "./rbac/admin-boundary.decorator";
import { DisallowApiClient } from "./rbac/api-client-policy.decorator";
import { ObservabilityService } from "./observability/observability.service";
import { AuthenticatedReadRoute } from "./rbac/read-access-policy.decorator";
import { Roles } from "./rbac/roles";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";

@Controller()
@ApiTags("System")
export class AppController {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly queueService: QueueService,
    private readonly observability: ObservabilityService,
  ) {}

  @Public()
  @Get("health")
  @ApiOperation({ summary: "Liveness check" })
  @ApiResponse({ status: 200, description: "Service is up" })
  async health() {
    const queueMetrics = await this.queueService.getMetrics();
    return {
      status: "ok",
      env: process.env.APP_ENV ?? "development",
      queues: queueMetrics,
      queueRuntime: {
        backend: this.queueService.getBackend(),
        workerEnabled: this.queueService.isWorkerEnabled(),
      },
    };
  }

  @DisallowApiClient()
  @AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
  @AdminBoundaryAccess({ capability: "manage_security" })
  @Get("health/internal")
  @ApiOperation({ summary: "Internal health — db pool, queue metrics, auth mode (admin only)" })
  @ApiResponse({ status: 200, description: "Detailed internal health" })
  async healthInternal() {
    const dbPool = await this.prismaService.getPoolStats();
    const queueMetrics = await this.queueService.getMetrics();
    const authMode = String(process.env.AUTH_MODE ?? "local").trim().toLowerCase();
    return {
      status: "ok",
      env: process.env.APP_ENV ?? "development",
      auth: {
        mode: authMode || "local",
        identitySource: authMode === "db" ? "database" : "local_env",
      },
      db_pool: dbPool,
      queues: queueMetrics,
      queueRuntime: {
        backend: this.queueService.getBackend(),
        workerEnabled: this.queueService.isWorkerEnabled(),
      },
    };
  }

  @DisallowApiClient()
  @AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
  @AdminBoundaryAccess({ capability: "manage_security" })
  @Roles("admin")
  @Get("queue/:queueName/lanes/:laneKey/failed")
  @ApiOperation({ summary: "List failed BullMQ jobs in a lane without exposing payloads (admin only)" })
  @ApiQuery({ name: "limit", required: false, type: Number, description: "Maximum failed jobs to return, capped at 100" })
  @ApiResponse({ status: 200, description: "Failed job diagnostic summaries" })
  async listFailedQueueJobs(
    @Param("queueName") queueName: string,
    @Param("laneKey") laneKey: string,
    @Query("limit") limitInput?: string,
  ) {
    const limit = Number.parseInt(String(limitInput ?? "20"), 10);
    const items = await this.queueService.listFailedJobs(queueName, laneKey, limit);
    return { items };
  }

  @DisallowApiClient()
  @AdminBoundaryAccess({ capability: "manage_security" })
  @Roles("admin")
  @Post("queue/:queueName/lanes/:laneKey/retry-failed")
  @HttpCode(200)
  @ApiOperation({ summary: "Retry failed BullMQ jobs in a specific lane (admin only)" })
  @ApiResponse({ status: 200, description: "Number of jobs re-queued" })
  async retryFailedQueueJobs(
    @Param("queueName") queueName: string,
    @Param("laneKey") laneKey: string,
  ) {
    const retried = await this.queueService.retryFailedJobs(queueName, laneKey);
    return { retried };
  }

  @DisallowApiClient()
  @AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
  @AdminBoundaryAccess({ capability: "manage_security" })
  @Roles("admin")
  @Get("health/metrics")
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  @ApiOperation({ summary: "Prometheus-format process metrics (admin only)" })
  @ApiResponse({ status: 200, description: "Prometheus text exposition" })
  healthMetrics() {
    return this.observability.formatPrometheus();
  }
}
