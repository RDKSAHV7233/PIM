import { Global, Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ApiExceptionCaptureFilter } from "./api-exception-capture.filter";
import { BrowserErrorIngestController } from "./browser-ingest.controller";
import { ErrorAuthorityOpsController } from "./error-authority-ops.controller";
import { ErrorAuthorityOpsService } from "./error-authority-ops.service";
import { ErrorAuthorityRetentionService } from "./error-authority-retention.service";
import { ErrorCaptureService } from "./error-capture.service";
import { NextServerErrorIngestController } from "./next-server-ingest.controller";
import { ObservabilityDbService } from "./observability-db.service";

@Global()
@Module({
  controllers: [NextServerErrorIngestController, BrowserErrorIngestController, ErrorAuthorityOpsController],
  providers: [
    ErrorAuthorityOpsService,
    ErrorCaptureService,
    ObservabilityDbService,
    ErrorAuthorityRetentionService,
    {
      provide: APP_FILTER,
      useClass: ApiExceptionCaptureFilter,
    },
  ],
  exports: [ErrorCaptureService, ObservabilityDbService],
})
export class ErrorAuthorityModule {}
