import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

export function getMarketingRedirects() {
  return [
    {
      source: "/app",
      destination: "https://app.gengrowth.ai/",
      statusCode: 301 as const,
    },
    {
      source: "/blog/whitelabel-seo-tool",
      destination: "/blog/best-white-label-seo-tool",
      statusCode: 301 as const,
    },
    {
      source: "/en/blog/whitelabel-seo-tool",
      destination: "/blog/best-white-label-seo-tool",
      statusCode: 301 as const,
    },
    // The keyword map shipped at /tools/hidden-keywords, which describes the
    // feeling and not the search. Both locale forms are listed: /tools/* is a
    // real zh route, unlike the blog slugs below, so a zh visitor cannot be
    // folded onto the default-locale destination.
    ...["", "/en", "/zh"].map((prefix) => ({
      source: `${prefix}/tools/hidden-keywords`,
      destination: `${prefix === "/zh" ? "/zh" : ""}/tools/low-competition-keywords`,
      statusCode: 301 as const,
    })),
    ...[
      ["free-seo-consultation", "free-seo-company"],
      ["free-white-label-seo", "best-white-label-seo-tool"],
      ["marketing-attribution-for-saas", "marketing-attribution-models"],
      ["serankings", "serankings-alternative"],
    ].flatMap(([source, destination]) => [
      {
        source: `/blog/${source}`,
        destination: `/blog/${destination}`,
        statusCode: 301 as const,
      },
      {
        source: `/en/blog/${source}`,
        destination: `/blog/${destination}`,
        statusCode: 301 as const,
      },
    ]),
  ];
}

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
    // Product onboarding moved to its own subdomain. Keep /app as a permanent
    // compatibility route for old articles, bookmarks, and third-party links.
    return getMarketingRedirects();
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
