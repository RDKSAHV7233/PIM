import type { ConnectorCap } from "./connector.interface";

export function parseCapabilities(raw: unknown): ConnectorCap[] {
  let values: string[] = [];
  if (Array.isArray(raw)) {
    values = raw.filter((value): value is string => typeof value === "string");
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      values = trimmed
        .slice(1, -1)
        .split(",")
        .map((item) => item.replace(/^"|"$/g, "").trim())
        .filter((item) => item.length > 0);
    }
  }
  return values.map((v) => v.toUpperCase() as ConnectorCap);
}
