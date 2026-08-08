declare module "@pim1/observability-db/generated/client" {
  export class PrismaClient {
    constructor(args?: unknown);
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
    $transaction<T>(fn: (client: PrismaClient) => Promise<T>): Promise<T>;
    errorOccurrence: {
      findUnique(args: unknown): Promise<unknown>;
      create(args: unknown): Promise<{ id: string }>;
    };
    errorIssue: {
      upsert(args: unknown): Promise<{ id: string }>;
      update(args: unknown): Promise<unknown>;
    };
    errorIssueTenantImpact: {
      findUnique(args: unknown): Promise<unknown>;
      upsert(args: unknown): Promise<unknown>;
    };
  }
}
