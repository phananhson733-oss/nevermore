import { fileURLToPath } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./security-headers.ts";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Pin the workspace root so Next does not infer it from an unrelated lockfile.
const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Optional generic self-hosting support for a host sub-path. The approved
// app.gengrowth.ai production deployment leaves NEXT_PUBLIC_BASE_PATH unset and
// serves at the origin root. Hand-built URLs mirror this via src/lib/base-path.ts
// (Next only auto-prefixes Link/redirect/assets).
const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(
  /^\/+|\/+$/g,
  "",
);
const basePath = rawBasePath ? `/${rawBasePath}` : undefined;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep the development route badge out of application screenshots and from
  // covering the persistent sidebar utilities. Compile/runtime errors still
  // surface through the regular development overlay.
  devIndicators: false,
  ...(basePath ? { basePath } : {}),
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
