export class ConnectorNotFoundError extends Error {
  constructor(slug: string) {
    super(`Connector '${slug}' is not registered.`);
    this.name = "ConnectorNotFoundError";
  }
}

export class InstallationNotFoundError extends Error {
  constructor(slug: string) {
    super(`Connector '${slug}' is not installed for this tenant.`);
    this.name = "InstallationNotFoundError";
  }
}

export class CredentialExpiredError extends Error {
  constructor(slug: string) {
    super(`Connector '${slug}' credentials are expired. Reconnect is required.`);
    this.name = "CredentialExpiredError";
  }
}

export class CapabilityNotSupportedError extends Error {
  constructor(slug: string, capability: string) {
    super(`Connector '${slug}' does not support capability '${capability}'.`);
    this.name = "CapabilityNotSupportedError";
  }
}

export type NetworkErrorCategory = 'TIMEOUT' | 'DNS' | 'TLS' | 'NETWORK';

export class ConnectorNetworkError extends Error {
  readonly category: NetworkErrorCategory;
  readonly retryable: boolean;
  readonly detail: string;

  constructor(slug: string, category: NetworkErrorCategory, retryable: boolean, detail: string) {
    const actionable = retryable
      ? `Transient network issue contacting ${slug} store. The system will retry automatically.`
      : `Check your ${slug} store URL and credentials. ${detail}`;
    super(actionable);
    this.name = "ConnectorNetworkError";
    this.category = category;
    this.retryable = retryable;
    this.detail = detail;
  }
}
