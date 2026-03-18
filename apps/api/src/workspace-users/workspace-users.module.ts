import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { PrismaModule } from "../prisma/prisma.module";
import { WorkspaceUsersController } from "./workspace-users.controller";
import { WorkspaceUsersService } from "./workspace-users.service";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [WorkspaceUsersController],
  providers: [WorkspaceUsersService],
})
export class WorkspaceUsersModule {}
