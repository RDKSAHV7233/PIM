import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SignupController } from "./signup.controller";
import { SignupService } from "./signup.service";

@Module({
  imports: [AuthModule],
  controllers: [SignupController],
  providers: [SignupService],
})
export class SignupModule {}
