export function withTenantDatabaseUrl(databaseUrl: string, tenantKey: string): string {
  const encoded = encodeURIComponent(`-c app.tenant_key=${tenantKey}`);
  if (databaseUrl.includes("options=")) {
    return databaseUrl.replace(/([?&])options=[^&]*/, `$1options=${encoded}`);
  }
  if (databaseUrl.includes("?")) {
    return `${databaseUrl}&options=${encoded}`;
  }
  return `${databaseUrl}?options=${encoded}`;
}

export function withApplicationName(databaseUrl: string, appName: string): string {
  if (databaseUrl.includes("application_name=")) {
    return databaseUrl;
  }
  const encodedName = encodeURIComponent(appName);
  if (databaseUrl.includes("?")) {
    return `${databaseUrl}&application_name=${encodedName}`;
  }
  return `${databaseUrl}?application_name=${encodedName}`;
}

export function withConnectionLimit(databaseUrl: string, limit: number): string {
  if (databaseUrl.includes("connection_limit=")) {
    return databaseUrl.replace(/([?&])connection_limit=[^&]*/, `$1connection_limit=${limit}`);
  }
  if (databaseUrl.includes("?")) {
    return `${databaseUrl}&connection_limit=${limit}`;
  }
  return `${databaseUrl}?connection_limit=${limit}`;
}

export function parseConnectionLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return 5;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`DB_POOL_CONNECTION_LIMIT must be a positive integer, got: "${raw}"`);
  }
  return parsed;
}
