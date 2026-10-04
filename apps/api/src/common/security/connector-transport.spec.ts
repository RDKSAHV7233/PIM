import {
  closeConnectorTransport,
  getConnectorTransport,
  setConnectorTransportForTesting,
  type ConnectorTransport,
} from "./connector-transport";
import { PinnedUndiciTransport } from "./pinned-undici-transport";

describe("connector transport registry", () => {
  const previous = getConnectorTransport(); // the jest setup's global-fetch test double
  const original = process.env.NODE_ENV;

  afterEach(async () => {
    process.env.NODE_ENV = original;
    await closeConnectorTransport();
    setConnectorTransportForTesting(previous);
  });

  it("uses the injected transport under NODE_ENV=test", () => {
    const fake: ConnectorTransport = { fetch: jest.fn() };
    setConnectorTransportForTesting(fake);
    expect(getConnectorTransport()).toBe(fake);
  });

  it("falls back to the real pinned undici transport when the override is cleared", () => {
    setConnectorTransportForTesting(null);
    const transport = getConnectorTransport();
    expect(transport).toBeInstanceOf(PinnedUndiciTransport);
    expect(getConnectorTransport()).toBe(transport); // one process-wide instance
  });

  it("refuses to install an override outside NODE_ENV=test", () => {
    process.env.NODE_ENV = "production";
    expect(() => setConnectorTransportForTesting({ fetch: jest.fn() })).toThrow(/only available when NODE_ENV=test/);
  });

  it("ignores any previously installed override in production", () => {
    const fake: ConnectorTransport = { fetch: jest.fn() };
    setConnectorTransportForTesting(fake);
    process.env.NODE_ENV = "production";
    expect(getConnectorTransport()).not.toBe(fake);
    expect(getConnectorTransport()).toBeInstanceOf(PinnedUndiciTransport);
  });
});
