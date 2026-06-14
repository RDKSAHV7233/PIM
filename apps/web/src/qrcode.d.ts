declare module "qrcode" {
  interface QrCodeColorOptions {
    dark?: string;
    light?: string;
  }

  interface QrCodeToDataUrlOptions {
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    margin?: number;
    width?: number;
    color?: QrCodeColorOptions;
  }

  interface QrCodeModule {
    toDataURL(text: string, options?: QrCodeToDataUrlOptions): Promise<string>;
  }

  const QRCode: QrCodeModule;

  export default QRCode;
}
