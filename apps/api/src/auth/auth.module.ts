import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtBlocklistService } from "./jwt-blocklist.service";
import { StepUpGuard } from "./step-up.guard";

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [AuthService, JwtBlocklistService, StepUpGuard],
  exports: [AuthService, JwtBlocklistService, StepUpGuard],
})
export class AuthModule {}
