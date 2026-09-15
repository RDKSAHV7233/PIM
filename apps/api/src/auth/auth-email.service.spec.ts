// Coverage for AuthEmailService — zero test coverage before, despite
// carrying every password-reset/account-unlock/account-export-ready email
// this app sends, plus a real retry branch (a 403 from Resend on a custom
// "from" address falls back to the tenant-wide default) that had never been
// exercised.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

jest.setTimeout(15000); // first fresh require()/ts-jest compile of this module can be slow under load

function makeMessage(overrides: Partial<any> = {}) {
  return {
    to: "person@example.com",
    subject: "Reset your password",
    text: "plain text body",
    html: "<p>html body</p>",
    category: "password_reset",
    ...overrides,
  };
}

describe("AuthEmailService — provider dispatch and Resend retry (no prior coverage)", () => {
  const originalEnv = process.env;
  let tempOutbox: string;

  beforeEach(async () => {
    tempOutbox = await fs.mkdtemp(path.join(os.tmpdir(), "pim1-email-test-"));
    process.env = { ...originalEnv, AUTH_EMAIL_OUTBOX_DIR: tempOutbox };
    jest.resetModules();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(tempOutbox, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  function loadService() {
    const { AuthEmailService } = require("./auth-email.service");
    return new AuthEmailService();
  }

  it("defaults to the file provider and writes a real outbox file", async () => {
    const service = loadService();

    await service.send(makeMessage());

    const files = await fs.readdir(tempOutbox);
    expect(files).toHaveLength(1);
    const written = JSON.parse(await fs.readFile(path.join(tempOutbox, files[0]), "utf8"));
    expect(written.to).toBe("person@example.com");
    expect(written.category).toBe("password_reset");
  });

  it("sanitizes an adversarial recipient so the outbox filename can never contain a path separator", async () => {
    const service = loadService();

    await service.send(makeMessage({ to: "../../../etc/passwd@evil.com" }));

    const files = await fs.readdir(tempOutbox);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain("/");
    expect(files[0]).not.toContain("\\");
    // Confirms the file actually landed inside the outbox dir, not escaped via the filename.
    const stat = await fs.stat(path.join(tempOutbox, files[0]));
    expect(stat.isFile()).toBe(true);
  });

  it("console provider logs and never touches the filesystem or network", async () => {
    process.env.AUTH_EMAIL_PROVIDER = "console";
    const service = loadService();
    const fetchSpy = jest.spyOn(global, "fetch");

    await service.send(makeMessage());

    expect(fetchSpy).not.toHaveBeenCalled();
    const files = await fs.readdir(tempOutbox).catch(() => []);
    expect(files).toHaveLength(0);
  });

  describe("resend provider", () => {
    beforeEach(() => {
      process.env.AUTH_EMAIL_PROVIDER = "resend";
      process.env.AUTH_EMAIL_RESEND_API_KEY = "test-key";
      process.env.AUTH_EMAIL_FROM = "noreply@vexapim.com";
    });

    it("throws EMAIL_PROVIDER_MISCONFIGURED without ever calling the network when the API key is missing", async () => {
      delete process.env.AUTH_EMAIL_RESEND_API_KEY;
      const service = loadService();
      const fetchSpy = jest.spyOn(global, "fetch");

      await expect(service.send(makeMessage())).rejects.toThrow("EMAIL_PROVIDER_MISCONFIGURED");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("sends successfully with the correct payload shape on the first attempt", async () => {
      const service = loadService();
      const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

      await service.send(makeMessage());

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.resend.com/emails");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toMatchObject({ from: "noreply@vexapim.com", to: ["person@example.com"] });
    });

    it("retries with the tenant-wide default 'from' when Resend returns 403 for a custom sender, and succeeds", async () => {
      const service = loadService();
      let call = 0;
      const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => {
        call += 1;
        if (call === 1) return new Response("forbidden domain", { status: 403 });
        return new Response(null, { status: 200 });
      });

      await service.send(makeMessage({ from: "custom@tenant-domain.com" }));

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const secondBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
      expect(secondBody.from).toBe("noreply@vexapim.com");
    });

    it("throws with 'fallback' in the message when the 403 retry also fails, rather than a bare generic error", async () => {
      const service = loadService();
      jest.spyOn(global, "fetch").mockResolvedValue(new Response("still forbidden", { status: 403 }));

      await expect(service.send(makeMessage({ from: "custom@tenant-domain.com" }))).rejects.toThrow(/fallback/);
    });

    it("does not retry at all on a non-403 failure, and surfaces the real status", async () => {
      const service = loadService();
      const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(new Response("server error", { status: 500 }));

      await expect(service.send(makeMessage({ from: "custom@tenant-domain.com" }))).rejects.toThrow("500");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("does not retry a 403 when the message already used the default 'from' — there's nothing to fall back to", async () => {
      const service = loadService();
      const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(new Response("forbidden", { status: 403 }));

      await expect(service.send(makeMessage({ from: "noreply@vexapim.com" }))).rejects.toThrow("403");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
