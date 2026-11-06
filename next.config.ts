import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module used by the dev database.
  // node:sqlite is a Node built-in, so nothing needs to be marked external here.
  experimental: {
    // The landing page and the app have separate root layouts, so an unknown address needs its own 404 page.
    globalNotFound: true,
  },
};

export default nextConfig;
