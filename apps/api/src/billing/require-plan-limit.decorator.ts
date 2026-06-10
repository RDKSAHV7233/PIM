import { SetMetadata } from "@nestjs/common";

export type PlanResource =
  | "skus"
  | "submissions"
  | "storage_gb"
  | "connectors_installations"
  | "connector_accounts"
  | "users"
  | "api_keys"
  | "outbound_webhooks";

export const PLAN_RESOURCE_KEY = "plan_resource";

export const RequirePlanLimit = (resource: PlanResource | PlanResource[]) =>
  SetMetadata(PLAN_RESOURCE_KEY, resource);
