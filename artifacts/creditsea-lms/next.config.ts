import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  poweredByHeader: false,
  allowedDevOrigins: ["*.pike.replit.dev", "127.0.0.1", "localhost"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
