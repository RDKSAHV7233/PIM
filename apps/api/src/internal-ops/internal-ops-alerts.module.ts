import { Global, Module } from "@nestjs/common";
import { InternalOpsAlertsService } from "./internal-ops-alerts.service";

@Global()
@Module({
  providers: [InternalOpsAlertsService],
  exports: [InternalOpsAlertsService],
})
export class InternalOpsAlertsModule {}
