import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
    webpackBuildWorker: false,
    devtoolSegmentExplorer: false,
  },
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
