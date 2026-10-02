import express from "express";
import type { AddressInfo } from "node:net";
import type { Request, Response } from "express";
import { rejectNulBytesMiddleware } from "./reject-nul-bytes.middleware";

function run(partial: Partial<Request>) {
  const req = { originalUrl: "/api/v1/x", query: {}, body: undefined, ...partial } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status } as unknown as Response;
  const next = jest.fn();
  rejectNulBytesMiddleware(req, res, next);
  return { status, json, next };
}

describe("rejectNulBytesMiddleware (prod-cert DEF-PC-010)", () => {
  it("rejects %00 in the raw URL, in the query and in the path (the live search repro: ?q=a%00b)", () => {
    expect(run({ originalUrl: "/api/v1/products/search?q=a%00b", query: { q: "a\u0000b" } }).status).toHaveBeenCalledWith(400);
    expect(run({ originalUrl: "/api/v1/media/assets/x%00y/file" }).status).toHaveBeenCalledWith(400);
    expect(run({ originalUrl: "/api/v1/x?a=1%00" }).status).toHaveBeenCalledWith(400);
  });

  it("answers with the standard VALIDATION_FAILED envelope including `fields`", () => {
    const r = run({ body: { name: "ok\u0000x" } });
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ error: "VALIDATION_FAILED", fields: [] }));
    expect(r.next).not.toHaveBeenCalled();
  });

  it("rejects a NUL inside a JSON body string, including nested values, arrays and keys", () => {
    expect(run({ body: { a: { b: [{ c: "deep\u0000" }] } } }).status).toHaveBeenCalledWith(400);
    expect(run({ body: { fileName: "a\u0000b.png" } }).status).toHaveBeenCalledWith(400);
    expect(run({ body: { ["k\u0000"]: 1 } }).status).toHaveBeenCalledWith(400);
  });

  it("is not defeated by deep nesting (no depth cap)", () => {
    let nested: unknown = { leaf: "x\u0000y" };
    for (let i = 0; i < 500; i += 1) {
      nested = { child: nested };
    }
    expect(run({ body: nested as never }).status).toHaveBeenCalledWith(400);
  });

  it("passes normal text, unicode, emoji and quotes through untouched", () => {
    for (const body of [{ name: "日本語 🚀 café" }, { name: `a"b'c<script>` }, { name: "x".repeat(10_000) }, undefined, null]) {
      const r = run({ body: body as never, originalUrl: "/api/v1/x?q=%E6%97%A5%22%27" });
      expect(r.next).toHaveBeenCalledTimes(1);
      expect(r.status).not.toHaveBeenCalled();
    }
  });

  it("does not scan raw Buffer bodies (signed webhook payloads)", () => {
    expect(run({ body: Buffer.from([0x61, 0x00, 0x62]) as never }).next).toHaveBeenCalledTimes(1);
  });
});

describe("rejectNulBytesMiddleware over real Express + JSON parsing", () => {
  async function withServer(fn: (base: string) => Promise<void>) {
    const app = express();
    app.use((_req, res, next) => {
      res.setHeader("x-earlier-middleware", "ran"); // stands in for helmet/CORS/correlation mounted before it
      next();
    });
    app.use(express.json());
    app.use(rejectNulBytesMiddleware);
    app.post("/echo", (req, res) => res.json({ ok: true, body: req.body }));
    app.get("/search", (req, res) => res.json({ ok: true, q: req.query.q }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  it("turns a wire-level JSON unicode escape for NUL into a 400 that still carries earlier middleware headers", async () => {
    await withServer(async (base) => {
      const bad = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":"a' + String.fromCharCode(92) + 'u0000b"}' });
      expect(bad.status).toBe(400);
      expect(bad.headers.get("x-earlier-middleware")).toBe("ran");
      expect(await bad.json()).toEqual(expect.objectContaining({ error: "VALIDATION_FAILED", fields: [] }));

      const good = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "日本語 🚀" }) });
      expect(good.status).toBe(200);
    });
  });

  it("rejects ?q=a%00b and serves ?q=blue", async () => {
    await withServer(async (base) => {
      expect((await fetch(`${base}/search?q=a%00b`)).status).toBe(400);
      expect((await fetch(`${base}/search?q=blue`)).status).toBe(200);
    });
  });
});
