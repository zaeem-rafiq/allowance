import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright's own test server builds into its own folder (KTD5).
  distDir: process.env.ALLOWANCE_DIST_DIR || ".next",
  serverExternalPackages: ["@electric-sql/pglite"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
