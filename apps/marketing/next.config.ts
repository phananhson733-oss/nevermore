import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  turbopack: { root: monorepoRoot },
  outputFileTracingRoot: monorepoRoot,
  async redirects() {
    // /blog/whitelabel-seo-tool and /blog/best-white-label-seo-tool argued the
    // same Level 1/2/3 resale framework for the same queries. Google resolved
    // the overlap itself: across 90 days one page took 723 impressions and the
    // other took none. Folding the shadowed duplicate into the page that
    // already ranks stops the two from splitting the same intent.
    // The /en/ variant is listed explicitly so it redirects in one hop instead
    // of bouncing through next-intl's prefix strip first.
    return [
      {
        source: "/blog/whitelabel-seo-tool",
        destination: "/blog/best-white-label-seo-tool",
        statusCode: 301,
      },
      {
        source: "/en/blog/whitelabel-seo-tool",
        destination: "/blog/best-white-label-seo-tool",
        statusCode: 301,
      },
    ];
  },
  async rewrites() {
    // proxy.ts skips paths containing a dot, so the unprefixed default-locale
    // feed never reaches next-intl's rewrite and would 404. Map it onto the
    // locale route explicitly; /zh/blog/rss.xml keeps working through routing.
    return [{ source: "/blog/rss.xml", destination: "/en/blog/rss.xml" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
