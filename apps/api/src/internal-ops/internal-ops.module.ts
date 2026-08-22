import { Module } from "@nestjs/common";
import { InternalOpsController } from "./internal-ops.controller";
import { InternalOpsSummaryService } from "./internal-ops-summary.service";

@Module({
  controllers: [InternalOpsController],
  providers: [InternalOpsSummaryService],
})
export class InternalOpsModule {}
