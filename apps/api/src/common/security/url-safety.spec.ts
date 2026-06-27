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
});
