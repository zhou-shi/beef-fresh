import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "*.devtunnels.ms",
    "*.trycloudflare.com",
    "*.ngrok-free.app",
    "*.ngrok.io",
  ],
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    agentUpgrade: "security",
  },
};

export default nextConfig;
