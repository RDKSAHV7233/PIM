import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MetricsModule } from "../metrics/metrics.module";
import { SignupController } from "./signup.controller";
import { SignupService } from "./signup.service";

@Module({
  imports: [AuthModule, MetricsModule],
  controllers: [SignupController],
  providers: [SignupService],
})
export class SignupModule {}
