import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingIncludes: {
    "/api/market-research/**": ["./src/lib/market-research/skills/*.md"],
  },
  experimental: {
    proxyClientMaxBodySize: "10mb",
  },
};

export default nextConfig;
