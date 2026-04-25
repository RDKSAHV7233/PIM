import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { PrismaModule } from "../prisma/prisma.module";
import { WorkspaceAccessScopesController } from "./workspace-access-scopes.controller";
import { WorkspaceUsersController } from "./workspace-users.controller";
import { WorkspaceUsersService } from "./workspace-users.service";

@Module({
  imports: [PrismaModule, AuditModule, AccessPolicyModule],
  controllers: [WorkspaceUsersController, WorkspaceAccessScopesController],
  providers: [WorkspaceUsersService],
})
export class WorkspaceUsersModule {}
