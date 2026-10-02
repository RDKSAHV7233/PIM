import type { NextConfig } from "next";
import path from "path";

const SECURITY_HEADERS = [
  // Browsers ignore HSTS over plain HTTP, so local dev is unaffected. No `preload`: it is a one-way commitment.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Do not advertise the framework on every response.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
  async redirects() {
    return [
      { source: "/products", destination: "/catalog/products", permanent: true },
      { source: "/channels/issues", destination: "/channels/health", permanent: true },
      { source: "/channels/recovery", destination: "/operations/repair", permanent: true },
      // Legacy connector route tree — canonical path is /channels/connectors
      { source: "/connectors", destination: "/channels/connectors", permanent: true },
      // URL pattern consistency — Settings pages use /admin/ except Account Security
      { source: "/admin/security", destination: "/settings/security", permanent: true },
      { source: "/settings/users", destination: "/admin/users", permanent: true },
      // Quality pages use /quality/ except Rejection Insights
      { source: "/quality/rejection", destination: "/rejection", permanent: true },
      { source: "/quality/rejections", destination: "/rejection", permanent: true },
    ];
  },
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  experimental: {
    // Route Handlers clone incoming request bodies before dispatch. Keep this
    // above the advertised 32 MB file cap so multipart metadata is not cut off.
    middlewareClientMaxBodySize: "34mb",
    serverActions: {
      bodySizeLimit: "10mb",
    },
    webpackBuildWorker: false,
    devtoolSegmentExplorer: false,
  },
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
