import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/products", destination: "/catalog/products", permanent: true },
      { source: "/channels/issues", destination: "/channels/health", permanent: true },
      { source: "/channels/recovery", destination: "/operations/repair", permanent: true },
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
    serverActions: {
      bodySizeLimit: "10mb",
    },
    webpackBuildWorker: false,
    devtoolSegmentExplorer: false,
  },
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
