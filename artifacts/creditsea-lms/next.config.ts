import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const apiProxyTarget = (
  process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8080"
).replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Static export is for production builds. In `next dev` we keep a Node
  // server so /api can be proxied to the API artifact on another port.
  ...(isProd ? { output: "export" as const } : {}),
  trailingSlash: true,
  poweredByHeader: false,
  allowedDevOrigins: ["*.pike.replit.dev", "127.0.0.1", "localhost"],
  images: {
    unoptimized: true,
  },
  ...(!isProd
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${apiProxyTarget}/api/:path*`,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
