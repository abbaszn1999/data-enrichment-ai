import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    proxyClientMaxBodySize: "10mb",
  },
};

export default nextConfig;
