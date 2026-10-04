import { BadRequestException } from "@nestjs/common";
import { resolve4, resolve6 } from "node:dns/promises";
import {
  CONNECTOR_REDIRECT_BLOCKED,
  CONNECTOR_TARGET_UNSAFE,
  ConnectorRedirectError,
  ConnectorTargetUnsafeError,
  isConnectorTargetSecurityError,
  toConnectorTargetSecurityIssue,
} from "./connector-target-errors";
import { validateConnectorTargetUrl, validateWebhookTargetUrl } from "./url-safety";

jest.mock("node:dns/promises", () => ({
  resolve4: jest.fn(),
  resolve6: jest.fn(),
}));

describe("connector target security errors", () => {
  beforeEach(() => {
    (resolve4 as unknown as jest.Mock).mockReset().mockResolvedValue(["93.184.216.34"]);
    (resolve6 as unknown as jest.Mock).mockReset().mockRejectedValue(new Error("ENODATA"));
  });

  describe("validateConnectorTargetUrl throws the typed, provider-neutral error", () => {
    it.each([
      ["", "URL_REQUIRED", "required"],
      ["not a url", "URL_INVALID", "not a valid URL"],
      ["http://shop.example.com", "HTTPS_REQUIRED", "HTTPS"],
      ["https://localhost/", "BLOCKED_HOST", "blocked host"],
      ["https://127.0.0.1/", "PRIVATE_IP_LITERAL", "private or reserved IP"],
      ["https://[::ffff:7f00:1]/", "PRIVATE_IP_LITERAL", "private or reserved IP"],
    ])("%s -> %s", async (url, reason, messagePart) => {
      const err = await validateConnectorTargetUrl(url).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConnectorTargetUnsafeError);
      expect(err).toBeInstanceOf(BadRequestException); // existing instanceof handling keeps working
      expect((err as ConnectorTargetUnsafeError).code).toBe(CONNECTOR_TARGET_UNSAFE);
      expect((err as ConnectorTargetUnsafeError).reason).toBe(reason);
      expect((err as Error).message).toContain(messagePart);
    });

    it("resolved-private and unresolvable hosts carry their own reasons", async () => {
      (resolve4 as unknown as jest.Mock).mockResolvedValue(["10.0.0.9"]);
      await expect(validateConnectorTargetUrl("https://rebind.example.com")).rejects.toMatchObject({
        code: CONNECTOR_TARGET_UNSAFE,
        reason: "PRIVATE_IP_RESOLVED",
      });
      (resolve4 as unknown as jest.Mock).mockRejectedValue(new Error("ENODATA"));
      await expect(validateConnectorTargetUrl("https://nothing.example.com")).rejects.toMatchObject({
        code: CONNECTOR_TARGET_UNSAFE,
        reason: "UNRESOLVABLE",
      });
    });
  });

  it("webhook validation keeps throwing a plain BadRequestException (webhook semantics unchanged)", async () => {
    const err = await validateWebhookTargetUrl("https://127.0.0.1/").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err).not.toBeInstanceOf(ConnectorTargetUnsafeError);
    expect((err as Error).message).toContain("Webhook target URL");
  });

  describe("shape", () => {
    it("redirect errors carry the stable code plus a specific reason", () => {
      const err = new ConnectorRedirectError("REDIRECT_LOOP", "loop");
      expect(err.code).toBe(CONNECTOR_REDIRECT_BLOCKED);
      expect(err.reason).toBe("REDIRECT_LOOP");
      expect(err.name).toBe("ConnectorRedirectError");
    });

    it("isConnectorTargetSecurityError matches only the two security errors", () => {
      expect(isConnectorTargetSecurityError(new ConnectorRedirectError("REDIRECT_LOOP", "x"))).toBe(true);
      expect(isConnectorTargetSecurityError(new ConnectorTargetUnsafeError("x", "BLOCKED_HOST"))).toBe(true);
      expect(isConnectorTargetSecurityError(new BadRequestException("x"))).toBe(false);
      expect(isConnectorTargetSecurityError(new Error("x"))).toBe(false);
      expect(isConnectorTargetSecurityError(undefined)).toBe(false);
    });

    it("toConnectorTargetSecurityIssue produces a ConnectorIssue-shaped record with reason and provider", () => {
      expect(toConnectorTargetSecurityIssue(new ConnectorTargetUnsafeError("msg", "HTTPS_REQUIRED"), "odoo")).toEqual({
        code: "CONNECTOR_TARGET_UNSAFE",
        fieldPath: "",
        severity: "error",
        sellerMessage: "msg",
        reason: "HTTPS_REQUIRED",
        provider: "odoo",
      });
    });
  });
});
