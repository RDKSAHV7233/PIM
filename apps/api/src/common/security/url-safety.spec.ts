import { validateWebhookTargetUrl } from "./url-safety";

describe("validateWebhookTargetUrl", () => {
  it("allows valid HTTPS URLs", async () => {
    const result = await validateWebhookTargetUrl("https://hooks.slack.com/services/T00/B00/xxx");
    expect(result).toBe("https://hooks.slack.com/services/T00/B00/xxx");
  });

  it("rejects HTTP URLs", async () => {
    await expect(validateWebhookTargetUrl("http://example.com/webhook")).rejects.toThrow("HTTPS");
  });

  it("rejects empty input", async () => {
    await expect(validateWebhookTargetUrl("")).rejects.toThrow("required");
  });

  it("rejects non-URL input", async () => {
    await expect(validateWebhookTargetUrl("not-a-url")).rejects.toThrow("not a valid URL");
  });

  it("blocks localhost", async () => {
    await expect(validateWebhookTargetUrl("https://localhost/hook")).rejects.toThrow("blocked host");
  });

  it("blocks metadata.google.internal", async () => {
    await expect(validateWebhookTargetUrl("https://metadata.google.internal/computeMetadata")).rejects.toThrow("blocked host");
  });

  it("blocks .internal hostnames", async () => {
    await expect(validateWebhookTargetUrl("https://evil.internal/hook")).rejects.toThrow("blocked host");
  });

  it("blocks .local hostnames", async () => {
    await expect(validateWebhookTargetUrl("https://my.local/hook")).rejects.toThrow("blocked host");
  });

  it("blocks 127.0.0.1 IP literal", async () => {
    await expect(validateWebhookTargetUrl("https://127.0.0.1/hook")).rejects.toThrow("private or reserved IP");
  });

  it("blocks 10.x private IP literal", async () => {
    await expect(validateWebhookTargetUrl("https://10.0.0.1/hook")).rejects.toThrow("private or reserved IP");
  });

  it("blocks 172.16.x private IP literal", async () => {
    await expect(validateWebhookTargetUrl("https://172.16.0.1/hook")).rejects.toThrow("private or reserved IP");
  });

  it("blocks 192.168.x private IP literal", async () => {
    await expect(validateWebhookTargetUrl("https://192.168.1.1/hook")).rejects.toThrow("private or reserved IP");
  });

  it("blocks 169.254.x link-local IP literal", async () => {
    await expect(validateWebhookTargetUrl("https://169.254.169.254/latest/meta-data")).rejects.toThrow("private or reserved IP");
  });

  it("blocks 100.64.x CGNAT IP literal", async () => {
    await expect(validateWebhookTargetUrl("https://100.64.0.1/hook")).rejects.toThrow("private or reserved IP");
  });

  it("blocks 0.0.0.0", async () => {
    await expect(validateWebhookTargetUrl("https://0.0.0.0/hook")).rejects.toThrow("private or reserved IP");
  });

  it("rejects a host with no DNS records by default (dispatch time fails closed)", async () => {
    await expect(
      validateWebhookTargetUrl("https://no-such-host.invalid/hook"),
    ).rejects.toThrow("must resolve to a public address");
  });

  it("soft-allows a host with no DNS records when requireResolvable is false (registration)", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await validateWebhookTargetUrl("https://no-such-host.invalid/hook", {
        requireResolvable: false,
      });
      expect(result).toBe("https://no-such-host.invalid/hook");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("still blocks a private IP even when requireResolvable is false", async () => {
    await expect(
      validateWebhookTargetUrl("https://10.0.0.1/hook", { requireResolvable: false }),
    ).rejects.toThrow("private or reserved IP");
  });

  it("allows HTTP and loopback when PIM_UNSAFE_HTTP_WEBHOOK_TARGETS is true", async () => {
    const old = process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS;
    process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS = "true";
    try {
      const result = await validateWebhookTargetUrl("http://127.0.0.1:9999/hook");
      expect(result).toBe("http://127.0.0.1:9999/hook");
    } finally {
      if (old === undefined) {
        delete process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS;
      } else {
        process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS = old;
      }
    }
  });
});
