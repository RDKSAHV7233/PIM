import { IsArray, IsIn, IsOptional, IsString } from "class-validator";

const SUBJECT_TYPES = ["user", "role"] as const;
const SCOPE_TYPES = [
  "category",
  "brand",
  "channel",
  "connector_account",
  "vendor",
  "owner",
  "supplier",
  "locale",
  "market",
  "catalog",
  "team",
  "assignee",
] as const;
const ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "archive",
  "approve",
  "reject",
  "publish",
  "unpublish",
  "import",
  "export",
  "bulk_edit",
  "preview_connector_payload",
  "manage_connector",
  "manage_users",
  "manage_settings",
  "view_audit_logs",
] as const;

export class CreateAccessScopeAssignmentDto {
  @IsIn(SUBJECT_TYPES)
  subjectType!: (typeof SUBJECT_TYPES)[number];

  @IsString()
  subjectId!: string;

  @IsIn(SCOPE_TYPES)
  scopeType!: (typeof SCOPE_TYPES)[number];

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  connectorInstallationId?: string;

  @IsOptional()
  @IsString()
  scopeValue?: string;

  @IsOptional()
  @IsArray()
  @IsIn(ACTIONS, { each: true })
  actions?: (typeof ACTIONS)[number][];
}
