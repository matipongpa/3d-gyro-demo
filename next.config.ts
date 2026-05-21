import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

module.exports = {
  allowedDevOrigins: [
    "bridgeless-nonexistent-cheyenne.ngrok-free.dev",
    "192.168.1.129",
  ],
};

export default nextConfig;
