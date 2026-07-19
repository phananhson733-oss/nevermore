import { fileURLToPath } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./security-headers.ts";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Pin the workspace root so Next does not infer it from an unrelated lockfile.
const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Isolated Playwright/mock servers must not contend with the developer's
  // existing `.next/dev/lock`; production and normal development keep `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: { root: monorepoRoot },
  // Standalone tracing otherwise stops at apps/web and can omit workspace
  // packages when the same build is promoted outside Vercel.
  outputFileTracingRoot: monorepoRoot,
  // Consume workspace TypeScript source directly (source-only internal packages).
  transpilePackages: [
    "@sf/contracts",
    "@sf/db",
    "@sf/i18n",
    "@sf/observability",
    "@sf/sources",
  ],
  // Never bundle the pg / pg-boss native + dynamic-require stack into server output.
  serverExternalPackages: ["pg", "pg-boss", "drizzle-orm"],
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders(),
      },
    ];
  },
};

export default withNextIntl(nextConfig);
