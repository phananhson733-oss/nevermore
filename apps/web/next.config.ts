import { fileURLToPath } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Pin the workspace root so Next does not infer it from an unrelated lockfile.
const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: monorepoRoot },
  // Consume workspace TypeScript source directly (source-only internal packages).
  transpilePackages: [
    "@sf/contracts",
    "@sf/db",
    "@sf/i18n",
    "@sf/observability",
  ],
  // Never bundle the pg / pg-boss native + dynamic-require stack into server output.
  serverExternalPackages: ["pg", "pg-boss", "drizzle-orm"],
  output: "standalone",
};

export default withNextIntl(nextConfig);
