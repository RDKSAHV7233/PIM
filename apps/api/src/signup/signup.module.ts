import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MetricsModule } from "../metrics/metrics.module";
import { QueueModule } from "../queue/queue.module";
import { SignupController } from "./signup.controller";
import { SignupService } from "./signup.service";

@Module({
  imports: [AuthModule, MetricsModule, QueueModule],
  controllers: [SignupController],
  providers: [SignupService],
})
export class SignupModule {}
