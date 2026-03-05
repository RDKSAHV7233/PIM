import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtBlocklistService } from "./jwt-blocklist.service";

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [AuthService, JwtBlocklistService],
  exports: [AuthService, JwtBlocklistService],
})
export class AuthModule {}
