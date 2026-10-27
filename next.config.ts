import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module used by the dev database.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
