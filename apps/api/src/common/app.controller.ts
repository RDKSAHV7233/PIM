import { Controller, Get, Header, HttpCode, Param, Post, Query, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator";
import { AdminBoundaryAccess } from "./rbac/admin-boundary.decorator";
import { DisallowApiClient } from "./rbac/api-client-policy.decorator";
import { ObservabilityService } from "./observability/observability.service";
import { CacheService } from "./cache/cache.service";
import { AuthenticatedReadRoute } from "./rbac/read-access-policy.decorator";
import { Roles } from "./rbac/roles";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { AuthExportStorageService } from "../auth/auth-export-storage.service";

@Controller()
@ApiTags("System")
export class AppController {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly queueService: QueueService,
    private readonly authExportStorageService: AuthExportStorageService,
    private readonly observability: ObservabilityService,
    private readonly cacheService: CacheService,
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

  @Public()
  @Get("health/ready")
  @ApiOperation({
    summary: "Readiness check — can this instance safely receive real traffic (used for deploy-cutover gating)",
  })
  @ApiResponse({ status: 200, description: "Instance is ready to serve traffic" })
  @ApiResponse({ status: 503, description: "Instance is not yet ready (e.g. database unreachable)" })
  async readiness() {
    try {
      await Promise.all([
        this.prismaService.getPoolStats(),
        this.queueService.checkRedisReady(),
      ]);
    } catch {
      throw new ServiceUnavailableException({ status: "not_ready" });
    }
    return { status: "ready" };
  }

  @DisallowApiClient()
  @AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
  @AdminBoundaryAccess({ capability: "manage_security" })
  @Get("health/internal")
  @ApiOperation({ summary: "Internal health — db pool, queue metrics, auth mode (admin only)" })
  @ApiResponse({ status: 200, description: "Detailed internal health" })
  async healthInternal() {
    const [dbPool, queueMetrics, redis] = await Promise.all([
      this.prismaService.getPoolStats(),
      this.queueService.getMetrics(),
      this.cacheService.getHealthSnapshot(),
    ]);
    const authMode = String(process.env.AUTH_MODE ?? "local").trim().toLowerCase();
    return {
      status: "ok",
      env: process.env.APP_ENV ?? "development",
      auth: {
        mode: authMode || "local",
        identitySource: authMode === "db" ? "database" : "local_env",
      },
      db_pool: dbPool,
      redis,
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
  @AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
  @AdminBoundaryAccess({ capability: "manage_security" })
  @Roles("admin")
  @Get("health/account-export-storage")
  @ApiOperation({ summary: "Probe account export object storage with a bounded write check (admin only)" })
  @ApiResponse({ status: 200, description: "Account export storage probe result" })
  async probeAccountExportStorage() {
    return this.authExportStorageService.probeAccountExportStorage();
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
  @AdminBoundaryAccess({ capability: "manage_security" })
  @Roles("admin")
  @Post("queue/cleanup-failed")
  @HttpCode(200)
  @ApiOperation({ summary: "Remove all failed BullMQ jobs from every queue (admin only)" })
  @ApiResponse({ status: 200, description: "Per-queue count of removed failed jobs" })
  async cleanupFailedQueueJobs() {
    const cleaned = await this.queueService.cleanAllFailedJobs();
    return { cleaned };
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
