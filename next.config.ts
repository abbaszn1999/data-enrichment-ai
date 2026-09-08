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
  async redirects() {
    return [
      {
        source: "/w/:slug/import/:id/enrich",
        destination: "/w/:slug/catalog-intelligence/:id",
        permanent: false,
      },
      {
        source: "/w/:slug/import/:path*",
        destination: "/w/:slug/catalog-intelligence/:path*",
        permanent: false,
      },
      {
        source: "/w/:slug/sync",
        destination: "/w/:slug/store-assistant",
        permanent: false,
      },
      {
        source: "/api/import/:path*",
        destination: "/api/catalog-intelligence/:path*",
        permanent: false,
      },
      {
        source: "/api/enrich",
        destination: "/api/catalog-intelligence",
        permanent: false,
      },
      {
        source: "/api/enrich/:path*",
        destination: "/api/catalog-intelligence/:path*",
        permanent: false,
      },
      {
        source: "/api/sync/:path*",
        destination: "/api/store-assistant/:path*",
        permanent: false,
      },
      {
        source: "/demo/import",
        destination: "/demo/catalog-intelligence",
        permanent: false,
      },
      {
        source: "/demo/import/:path*",
        destination: "/demo/catalog-intelligence/:path*",
        permanent: false,
      },
    ];
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
