import type { NextConfig } from "next";

const adminPublicPath =
  process.env.NEXT_PUBLIC_ADMIN_PATH?.replace(/\/$/, "") || "/admin";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ["@renderinc/sdk"],
  outputFileTracingIncludes: {
    "/api/market-research/**": ["./src/lib/market-research/skills/*.md"],
  },
  experimental: {
    proxyClientMaxBodySize: "10mb",
  },
  async rewrites() {
    if (adminPublicPath === "/admin") return [];
    return [
      { source: adminPublicPath, destination: "/admin" },
      { source: `${adminPublicPath}/:path*`, destination: "/admin/:path*" },
    ];
  },
};

export default nextConfig;
