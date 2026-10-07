import type { Response } from "express";
import { MediaController } from "./media.controller";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);

function makeController(file: { buffer?: Buffer; redirectUrl?: string; mimeType: string; fileName: string }) {
  const getAssetFile = jest.fn().mockResolvedValue(file);
  const controller = new MediaController({ getAssetFile } as never);
  const headers: Record<string, string> = {};
  const redirect = jest.fn();
  const response = {
    header: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
      return response;
    },
    redirect,
  } as unknown as Response;
  return { controller, response, headers, redirect };
}

describe("MediaController.getAssetFile public delivery headers (prod-cert DEF-PC-002 / DEF-PC-014)", () => {
  it("serves an allowed image inline with a sandbox CSP", async () => {
    const { controller, response, headers } = makeController({ buffer: PNG, mimeType: "image/png", fileName: "shirt.png" });
    await controller.getAssetFile("asset-1", undefined, response);
    expect(headers["content-type"]).toBe("image/png");
    expect(headers["content-disposition"]).toMatch(/^inline; filename="shirt\.png"; filename\*=UTF-8''shirt\.png$/);
    expect(headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
  });

  it("forces a legacy text/html asset to download as octet-stream (never rendered)", async () => {
    const { controller, response, headers } = makeController({ buffer: Buffer.from("<script>alert(1)</script>"), mimeType: "text/html", fileName: "probe.html" });
    await controller.getAssetFile("asset-2", undefined, response);
    expect(headers["content-type"]).toBe("application/octet-stream");
    expect(headers["content-disposition"]).toMatch(/^attachment;/);
  });

  it("does not throw for a non-Latin filename and emits a header Node accepts", async () => {
    const { controller, response, headers } = makeController({ buffer: PNG, mimeType: "image/png", fileName: "ファイル-日本語.png" });
    await expect(controller.getAssetFile("asset-3", undefined, response)).resolves.toBeDefined();
    expect(/[^\x20-\x7e]/.test(headers["content-disposition"])).toBe(false);
  });

  it("leaves the production R2 redirect path untouched (no local headers set)", async () => {
    const { controller, response, headers, redirect } = makeController({ redirectUrl: "https://pub.example.r2.dev/media/t/a.png", mimeType: "image/png", fileName: "a.png" });
    await controller.getAssetFile("asset-4", undefined, response);
    expect(redirect).toHaveBeenCalledWith(302, "https://pub.example.r2.dev/media/t/a.png");
    expect(headers["content-security-policy"]).toBeUndefined();
  });
});
