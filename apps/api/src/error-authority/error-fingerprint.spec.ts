import { normalizeErrorEvent } from "./error-fingerprint";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("error authority fingerprinting and redaction", () => {
  it("normalizes variable identifiers into the same deterministic fingerprint", () => {
    const first = normalizeErrorEvent(
      {
        runtime: "api",
        service: "vexa-pim-api",
        environment: "staging",
        routeTemplate: "/api/v1/products/:id",
        error: new Error("Product cmabc123456789 failed for tenant tenant-123456 at 2026-08-03T01:02:03Z"),
      },
      SECRET,
    );
    const second = normalizeErrorEvent(
      {
        runtime: "api",
        service: "vexa-pim-api",
        environment: "staging",
        routeTemplate: "/api/v1/products/:id",
        error: new Error("Product cmdef987654321 failed for tenant tenant-987654 at 2026-08-03T04:05:06Z"),
      },
      SECRET,
    );

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.normalizedMessage).toContain("{cuid}");
    expect(second.normalizedMessage).toContain("{number}");
  });

  it("redacts secrets and creates opaque tenant and actor references", () => {
    const event = normalizeErrorEvent(
      {
        runtime: "worker",
        service: "vexa-pim-api",
        environment: "staging",
        rawTenantKey: "admin",
        rawActorId: "info@example.com",
        actorType: "human",
        error: new Error("Connector failed with token=abc123 and password=hunter2"),
      },
      SECRET,
    );

    expect(event.safeMessage).not.toContain("abc123");
    expect(event.safeMessage).not.toContain("hunter2");
    expect(event.safeTenantRef).toMatch(/^tenant_[a-f0-9]{24}$/);
    expect(event.safeActorRef).toMatch(/^actor_[a-f0-9]{24}$/);
    expect(event.safeTenantRef).not.toContain("admin");
    expect(event.safeActorRef).not.toContain("info");
  });

  it("normalizes frames and stores only safe stack diagnostics", () => {
    const event = normalizeErrorEvent(
      {
        runtime: "browser",
        service: "vexa-pim-web",
        environment: "staging",
        error: new Error("Render failed"),
        frames: [
          {
            file: "C:\\Users\\developer\\PIM1\\apps\\web\\.next\\static\\chunks\\page.js",
            functionName: "ProductPage",
            line: 123.9,
            column: 45.2,
          },
        ],
      },
      SECRET,
    );

    expect(event.topFrameFile).toContain("{userhome}");
    expect(event.topFrameFunction).toBe("ProductPage");
    expect(event.topFrameLine).toBe(123);
    expect(event.stackHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
