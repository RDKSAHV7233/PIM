import { MyntraConnector } from "./myntra.connector";

function makeConnector(): MyntraConnector {
  const mockDbClient = {
    connectorCredential: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  const prismaDirect = { getClient: () => mockDbClient } as any;
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
  return new MyntraConnector(prismaDirect, logger);
}

describe("MyntraConnector.verifyCandidateCredentials", () => {
  const candidate = { merchant_id: "candidate-merchant", secret_key: "candidate-secret" };

  it("returns valid on a healthy response", async () => {
    const connector = makeConnector();
    const callApi = jest.spyOn(connector as any, "callApi").mockResolvedValue({ status: 200, ok: true } as Response);

    await expect(connector.verifyCandidateCredentials!(candidate)).resolves.toEqual({ outcome: "valid" });
    // Candidate-purity: the connector's HTTP call carries the candidate's own values.
    expect(callApi).toHaveBeenCalledWith("GET", "/listing-api/v2/health", candidate.merchant_id, candidate.secret_key);
  });

  it("returns invalid on 401/403", async () => {
    const connector = makeConnector();
    jest.spyOn(connector as any, "callApi").mockResolvedValue({ status: 403, ok: false } as Response);

    await expect(connector.verifyCandidateCredentials!(candidate)).resolves.toEqual({
      outcome: "invalid",
      reasonCode: "MYNTRA_CREDENTIALS_REJECTED",
    });
  });

  it("returns unavailable, not invalid, on a network failure", async () => {
    const connector = makeConnector();
    jest.spyOn(connector as any, "callApi").mockRejectedValue(new Error("network down"));

    await expect(connector.verifyCandidateCredentials!(candidate)).resolves.toEqual({
      outcome: "unavailable",
      reasonCode: "UNKNOWN_NETWORK_ERROR",
    });
  });

  it("returns unavailable on a non-401/403 error status", async () => {
    const connector = makeConnector();
    jest.spyOn(connector as any, "callApi").mockResolvedValue({ status: 502, ok: false } as Response);

    await expect(connector.verifyCandidateCredentials!(candidate)).resolves.toEqual({
      outcome: "unavailable",
      reasonCode: "HTTP_502",
    });
  });

  it("stored credential value differs from candidate — the HTTP call still uses the candidate value", async () => {
    const connector = makeConnector();
    const db = (connector as any).prismaDirect.getClient();
    db.connectorCredential.findFirst.mockResolvedValue({
      encryptedValue: "irrelevant-stored-cipher",
      keyVersion: "v1",
    });
    const callApi = jest.spyOn(connector as any, "callApi").mockResolvedValue({ status: 200, ok: true } as Response);

    await connector.verifyCandidateCredentials!(candidate);

    expect(callApi).toHaveBeenCalledWith("GET", "/listing-api/v2/health", candidate.merchant_id, candidate.secret_key);
    // Purity: never reads or writes stored credential rows.
    expect(db.connectorCredential.findFirst).not.toHaveBeenCalled();
    expect(db.connectorCredential.updateMany).not.toHaveBeenCalled();
  });
});
