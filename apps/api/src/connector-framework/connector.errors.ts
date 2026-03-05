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
