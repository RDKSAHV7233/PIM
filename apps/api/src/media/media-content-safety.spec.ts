import {
  ALLOWED_MEDIA_MIME_TYPES,
  buildContentDisposition,
  normalizeMimeType,
  resolveServeHeaders,
  resolveUploadMimeType,
  sniffImageMimeType,
} from "./media-content-safety";

const BS = String.fromCharCode(92); // backslash, built explicitly so no escape can be mangled

describe("media content safety — review follow-ups", () => {
  it("strips backslashes so a trailing backslash cannot escape the closing quote (regex typo regression)", () => {
    const header = buildContentDisposition("inline", `evil${BS}`);
    expect(header).not.toContain(BS);
    expect(header).toMatch(/^inline; filename="evil_"; filename\*=UTF-8''evil_$/);
    const injected = buildContentDisposition("inline", `a${BS}"; filename*=UTF-8''x.html`);
    expect(injected).not.toContain(BS);
    expect(injected.match(/; filename\*=/g)).toHaveLength(1);
  });

  it("does not throw on a lone surrogate (encodeURIComponent URIError) and still returns a valid header", () => {
    const header = buildContentDisposition("inline", `bad\ud800name.png`);
    expect(/[^\x20-\x7e]/.test(header)).toBe(false);
    expect(header).toContain("filename=");
  });

  it("resolves a missing or generic declared type from the bytes (bulk rows default to application/octet-stream)", () => {
    expect(resolveUploadMimeType("application/octet-stream", PNG)).toBe("image/png");
    expect(resolveUploadMimeType("", JPEG)).toBe("image/jpeg");
    expect(resolveUploadMimeType("application/octet-stream", Buffer.from("<html></html>"))).toBe("application/octet-stream");
    expect(resolveUploadMimeType("text/html", PNG)).toBe("text/html"); // an explicit non-image claim is still rejected later
  });
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const GIF = Buffer.from("GIF89a\u0001\u0000", "latin1");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(4)]);

describe("media content safety (prod-cert DEF-PC-002 / DEF-PC-014)", () => {
  it("allows only raster image types", () => {
    expect([...ALLOWED_MEDIA_MIME_TYPES].sort()).toEqual(["image/gif", "image/jpeg", "image/png", "image/webp"]);
    for (const bad of ["text/html", "image/svg+xml", "application/javascript", "application/xml", "application/x-evil", "text/plain"]) {
      expect(ALLOWED_MEDIA_MIME_TYPES.has(normalizeMimeType(bad))).toBe(false);
    }
  });

  it("normalises declared types (case, parameters, jpg alias)", () => {
    expect(normalizeMimeType("IMAGE/PNG; charset=binary")).toBe("image/png");
    expect(normalizeMimeType("image/jpg")).toBe("image/jpeg");
  });

  it("identifies real images by magic bytes and refuses HTML/SVG dressed up as images", () => {
    expect(sniffImageMimeType(PNG)).toBe("image/png");
    expect(sniffImageMimeType(JPEG)).toBe("image/jpeg");
    expect(sniffImageMimeType(GIF)).toBe("image/gif");
    expect(sniffImageMimeType(WEBP)).toBe("image/webp");
    expect(sniffImageMimeType(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffImageMimeType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(sniffImageMimeType(Buffer.alloc(0))).toBeNull();
  });

  it("builds a valid Content-Disposition for non-Latin names (was ERR_INVALID_CHAR → HTTP 500)", () => {
    const header = buildContentDisposition("inline", "ファイル-日本語.png");
    expect(header).toMatch(/^inline; filename="[\x20-\x7e]*"; filename\*=UTF-8''/);
    expect(header).toContain(encodeURIComponent("ファイル-日本語.png"));
    // Node would throw on any char > 0xFF or control char in a header value:
    expect(/[^\x20-\x7e]/.test(header)).toBe(false);
  });

  it("neutralises quote / newline / semicolon injection in filenames", () => {
    const header = buildContentDisposition("inline", 'a"; filename*=UTF-8\'\'evil.html\r\nX-Injected: 1');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.match(/filename=/g)).toHaveLength(1);
    expect(header.split('filename="')[1].split('"')[0]).not.toContain(";");
  });

  it("serves allowed images inline, and everything else (legacy html/svg rows) as an octet-stream download", () => {
    expect(resolveServeHeaders("image/png", "a.png")).toEqual({ contentType: "image/png", contentDisposition: expect.stringMatching(/^inline;/) });
    for (const legacy of ["text/html", "image/svg+xml", "application/x-evil"]) {
      const h = resolveServeHeaders(legacy, "x.html");
      expect(h.contentType).toBe("application/octet-stream");
      expect(h.contentDisposition).toMatch(/^attachment;/);
    }
  });
});
