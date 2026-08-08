import { Global, Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ApiExceptionCaptureFilter } from "./api-exception-capture.filter";
import { ErrorCaptureService } from "./error-capture.service";
import { ObservabilityDbService } from "./observability-db.service";

@Global()
@Module({
  providers: [
    ErrorCaptureService,
    ObservabilityDbService,
    {
      provide: APP_FILTER,
      useClass: ApiExceptionCaptureFilter,
    },
  ],
  exports: [ErrorCaptureService, ObservabilityDbService],
})
export class ErrorAuthorityModule {}
