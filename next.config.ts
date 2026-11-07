import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module used by the dev database.
  // node:sqlite is a Node built-in, so nothing needs to be marked external here.
  experimental: {
    // The landing page and the app have separate root layouts, so an unknown address needs its own 404 page.
    globalNotFound: true,
    // Application documents (UC02) are up to 3 MB, which is about 4 MB once encoded for sending.
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
