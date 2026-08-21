import type { MetadataRoute } from "next";

/**
 * Build output and the JSON API are not pages. Googlebot reaches them by
 * following the script/style references in the public /login HTML, and every
 * asset it fetches is then reported as "crawled - currently not indexed",
 * burying the handful of real coverage problems under hundreds of chunk URLs.
 */
const NON_CONTENT_PATHS = ["/_next/", "/api/"];

/**
 * Crawl policy for the signed-in product subdomain. Pages stay crawlable on
 * purpose: the `X-Robots-Tag: noindex` in `security-headers.ts` is what keeps
 * them out of the index, and a crawler that is blocked outright can never read
 * that header. `proxy.ts` exempts `/robots.txt` from the auth gate so this
 * response actually reaches crawlers.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: NON_CONTENT_PATHS,
      },
    ],
  };
}
