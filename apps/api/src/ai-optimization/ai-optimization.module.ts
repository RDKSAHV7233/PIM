import { Module } from "@nestjs/common";
import { AiOptimizationController } from "./ai-optimization.controller";
import { AiOptimizationService } from "./ai-optimization.service";

@Module({
  controllers: [AiOptimizationController],
  providers: [AiOptimizationService],
})
export class AiOptimizationModule {}
