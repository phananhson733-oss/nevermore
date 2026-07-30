import { describe, expect, it, vi } from "vitest";
import type {
  PublicResourceFetchOptions,
  PublicResourceResult,
} from "@sf/sources";
import {
  scanSeoAuditSite,
  SeoAuditScanError,
  type SeoAuditFetchResource,
} from "./scan.ts";

const ok = (
  requestedUrl: string,
  body: string,
  overrides: Partial<Extract<PublicResourceResult, { kind: "ok" }>> = {},
): Extract<PublicResourceResult, { kind: "ok" }> => ({
  kind: "ok",
  requestedUrl,
  finalUrl: requestedUrl,
  firstStatus: 200,
  finalStatus: 200,
  redirectChain: [],
  contentType: "text/html; charset=utf-8",
  xRobotsTag: null,
  body,
  bytes: new TextEncoder().encode(body).byteLength,
  bodyComplete: true,
  ...overrides,
});

describe("scanSeoAuditSite", () => {
  it("probes one page and same-origin standard resources without persistence", async () => {
    const calls: {
      readonly url: string;
      readonly options: PublicResourceFetchOptions;
    }[] = [];
    const fetchResource: SeoAuditFetchResource = vi.fn(
      async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith("/robots.txt")) {
          return ok(url, "User-agent: *\nDisallow:", {
            contentType: "text/plain",
          });
        }
        if (url.endsWith("/sitemap.xml")) {
          return ok(url, '<?xml version="1.0"?><urlset></urlset>', {
            contentType: "application/xml",
          });
        }
        return ok(
          url,
          [
            '<html lang="en"><head>',
            "<title>Acme evidence-led growth operating system</title>",
            '<meta name="description" content="A sufficiently descriptive summary for the public health map fixture and its deterministic checks.">',
            '<meta property="og:title" content="Acme">',
            '<meta property="og:description" content="Acme growth">',
            '<meta property="og:image" content="/og.png">',
            '<meta name="twitter:card" content="summary_large_image">',
            '<link rel="canonical" href="https://www.acme.com/">',
            '<script type="application/ld+json">{"@type":"Organization"}</script>',
            "</head><body><h1>Acme</h1><h2>Evidence</h2>",
            '<a href="/one">One</a><a href="/two">Two</a><a href="/three">Three</a>',
            "<p>",
            Array.from({ length: 520 }, () => "growth").join(" "),
            "</p></body></html>",
          ].join(""),
          {
            finalUrl: "https://www.acme.com/",
            redirectChain: ["https://www.acme.com/"],
            firstStatus: 301,
          },
        );
      },
    );

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      { now: () => new Date("2026-07-30T08:30:00.000Z") },
      fetchResource,
    );

    expect(result.scannedAt).toBe("2026-07-30T08:30:00.000Z");
    expect(result.page).toMatchObject({
      finalUrl: "https://www.acme.com/",
      statusCode: 200,
      bodyComplete: true,
      robotsNoindex: false,
      htmlLang: "en",
      h1Count: 1,
      internalLinkCount: 3,
      socialMetaTagsPresent: 4,
      jsonLdBlockCount: 1,
      jsonLdErrorCount: 0,
    });
    expect(result.robots.state).toBe("parsed");
    expect(result.robotsPageAllowed).toBe(true);
    expect(result.sitemap.state).toBe("parsed");
    expect(calls.map((call) => call.url)).toEqual([
      "https://acme.com/",
      "https://www.acme.com/robots.txt",
      "https://www.acme.com/sitemap.xml",
    ]);
    expect(calls[1]?.options.allowedOrigin).toBe("https://www.acme.com");
    expect(calls[2]?.options.allowedOrigin).toBe("https://www.acme.com");
  });

  it("throws a stable timeout only when the submitted page transport fails", async () => {
    const fetchResource: SeoAuditFetchResource = async () => ({
      kind: "error",
      code: "timeout",
    });

    await expect(
      scanSeoAuditSite("https://acme.com/", {}, fetchResource),
    ).rejects.toEqual(new SeoAuditScanError("timeout"));
  });

  it("keeps standard-resource fetch failures as unverified probe facts", async () => {
    const fetchResource: SeoAuditFetchResource = async (url) =>
      url === "https://acme.com/"
        ? ok(url, "<html><head></head><body>Acme</body></html>")
        : { kind: "error", code: "network" };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.robots).toMatchObject({
      state: "fetch_error",
      statusCode: 0,
      bodyComplete: false,
    });
    expect(result.sitemap).toMatchObject({
      state: "fetch_error",
      statusCode: 0,
      bodyComplete: false,
    });
  });

  it("recognizes a namespaced sitemap root after XML preamble content", async () => {
    const fetchResource: SeoAuditFetchResource = async (url) => {
      if (url.endsWith("/robots.txt")) {
        return ok(url, "User-agent: *", { contentType: "text/plain" });
      }
      if (url.endsWith("/sitemap.xml")) {
        return ok(
          url,
          '<?xml version="1.0"?><!-- generated --><sm:urlset xmlns:sm="urn:test"></sm:urlset>',
          { contentType: "application/xml" },
        );
      }
      return ok(url, "<html><body>Acme</body></html>");
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.sitemap.state).toBe("parsed");
  });

  it("reports when complete robots rules block the submitted page", async () => {
    const fetchResource: SeoAuditFetchResource = async (url) => {
      if (url.endsWith("/robots.txt")) {
        return ok(
          url,
          "User-agent: *\nDisallow: /private/\n",
          { contentType: "text/plain" },
        );
      }
      if (url.endsWith("/sitemap.xml")) {
        return ok(url, "<urlset></urlset>", {
          contentType: "application/xml",
        });
      }
      return ok(url, "<html><body>Private page</body></html>");
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/private/plan?source=test",
      {},
      fetchResource,
    );

    expect(result.robots.state).toBe("parsed");
    expect(result.robotsPageAllowed).toBe(false);
  });

  it("does not treat markup-looking script text as document evidence", async () => {
    const fetchResource: SeoAuditFetchResource = async (url) => {
      if (url.endsWith("/robots.txt")) {
        return ok(url, "User-agent: *", { contentType: "text/plain" });
      }
      if (url.endsWith("/sitemap.xml")) {
        return ok(url, "<urlset></urlset>", {
          contentType: "application/xml",
        });
      }
      return ok(
        url,
        [
          "<html><head>",
          '<script>const fixture = "<h1>Fake</h1><meta property=\\"og:title\\" content=\\"Fake\\">";</script>',
          "</head><body><p>Actual body</p></body></html>",
        ].join(""),
      );
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page.h1Count).toBe(0);
    expect(result.page.headingOutline).toEqual([]);
    expect(result.page.socialMetaTagsPresent).toBe(0);
  });
});
