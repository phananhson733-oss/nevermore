import { describe, expect, it, vi } from "vitest";
import type {
  PublicResourceFetchOptions,
  PublicResourceResult,
} from "@sf/sources/public-http";
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
  decodeState: "utf8",
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

  it("treats a gone standard sitemap path as missing, not a server failure", async () => {
    const fetchResource: SeoAuditFetchResource = async (url) => {
      if (url.endsWith("/robots.txt")) {
        return ok(url, "User-agent: *", { contentType: "text/plain" });
      }
      if (url.endsWith("/sitemap.xml")) {
        return ok(url, "", {
          finalStatus: 410,
          firstStatus: 410,
          contentType: "application/xml",
        });
      }
      return ok(url, "<html><body>Acme</body></html>");
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.sitemap.state).toBe("missing");
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

  it("finds noindex across repeated robots and googlebot meta tags", async () => {
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
          '<meta name="robots" content="index, follow">',
          '<meta name="googlebot" content="noindex">',
          "</head><body>Acme</body></html>",
        ].join(""),
      );
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page.robotsNoindex).toBe(true);
  });

  it("does not let comment-looking script text hide a real robots directive", async () => {
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
          '<script>const marker = "<!--";</script>',
          '<meta name="robots" content="noindex">',
          "</head><body>Acme</body></html>",
        ].join(""),
      );
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page.robotsNoindex).toBe(true);
  });

  it("keeps raw-text stripping when an opening tag has an unquoted quote", async () => {
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
          '<html><head><script data-x=bar"baz>',
          '<meta name="robots" content="noindex">',
          "</script></head><body>Acme</body></html>",
        ].join(""),
      );
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page.robotsNoindex).toBe(false);
  });

  it("does not expose a fake robots directive inside an incomplete quoted opening tag", async () => {
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
          '<html><head><script foo="unterminated>',
          '<meta name="robots" content="noindex">',
          "</script></head><body>Acme</body></html>",
        ].join(""),
      );
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page.robotsNoindex).toBe(false);
  });

  it.each([
    [
      "textarea text",
      '<textarea><meta name="robots" content="noindex"></textarea>',
    ],
    [
      "title text",
      '<title><meta name="robots" content="noindex"></title>',
    ],
    [
      "another element's quoted attribute",
      '<div data-fixture=\'<meta name="robots" content="noindex">\'>Acme</div>',
    ],
    [
      "plaintext text state",
      '<plaintext></plaintext><meta name="robots" content="noindex">',
    ],
  ])("does not treat meta-looking markup in %s as robots evidence", async (_label, body) => {
    const fetchResource: SeoAuditFetchResource = async (url) => {
      if (url.endsWith("/robots.txt")) {
        return ok(url, "User-agent: *", { contentType: "text/plain" });
      }
      if (url.endsWith("/sitemap.xml")) {
        return ok(url, "<urlset></urlset>", {
          contentType: "application/xml",
        });
      }
      return ok(url, `<html><head>${body}</head><body>Acme</body></html>`);
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page.robotsNoindex).toBe(false);
  });

  it.each([
    [
      "title RCDATA",
      '<title>Acme</title foo><meta name="robots" content="noindex">',
    ],
    [
      "textarea RCDATA",
      '<textarea>Acme</textarea foo><meta name="robots" content="noindex">',
    ],
    [
      "xmp raw text",
      '<xmp>Acme</xmp/><meta name="robots" content="noindex">',
    ],
  ])("observes a real robots meta after an appropriate %s end tag", async (_label, body) => {
    const fetchResource: SeoAuditFetchResource = async (url) => {
      if (url.endsWith("/robots.txt")) {
        return ok(url, "User-agent: *", { contentType: "text/plain" });
      }
      if (url.endsWith("/sitemap.xml")) {
        return ok(url, "<urlset></urlset>", {
          contentType: "application/xml",
        });
      }
      return ok(url, `<html><head>${body}</head><body>Acme</body></html>`);
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page.robotsNoindex).toBe(true);
  });

  it("does not accept whitespace between an end-tag slash and name", async () => {
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
        '<html><head><title>Acme</ title><meta name="robots" content="noindex"></head></html>',
      );
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page.robotsNoindex).toBe(false);
  });

  it.each([
    [
      "a double quote",
      '<title>Acme</title foo=bar"baz><meta name=robots content=noindex>',
      "Acme",
    ],
    [
      "a single quote",
      "<textarea>Acme</textarea foo=bar'baz><meta name=robots content=noindex>",
      null,
    ],
  ])(
    "keeps %s inside an unquoted end-tag attribute value",
    async (_label, body, expectedTitle) => {
      const fetchResource: SeoAuditFetchResource = async (url) => {
        if (url.endsWith("/robots.txt")) {
          return ok(url, "User-agent: *", { contentType: "text/plain" });
        }
        if (url.endsWith("/sitemap.xml")) {
          return ok(url, "<urlset></urlset>", {
            contentType: "application/xml",
          });
        }
        return ok(url, `<html><head>${body}</head><body>Acme</body></html>`);
      };

      const result = await scanSeoAuditSite(
        "https://acme.com/",
        {},
        fetchResource,
      );

      expect(result.page).toMatchObject({
        robotsNoindex: true,
        title: expectedTitle,
      });
    },
  );

  it("keeps meta and JSON-LD looking content after plaintext in text state", async () => {
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
          "<html><head><plaintext></plaintext>",
          '<meta name="robots" content="noindex">',
          '<script type="application/ld+json">{bad}</script>',
        ].join(""),
      );
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page).toMatchObject({
      robotsNoindex: false,
      jsonLdBlockCount: 0,
      jsonLdErrorCount: 0,
      jsonLdScanComplete: true,
    });
  });

  it("ignores X-Robots-Tag noindex scoped to an unrelated crawler", async () => {
    const fetchResource: SeoAuditFetchResource = async (url) => {
      if (url.endsWith("/robots.txt")) {
        return ok(url, "User-agent: *", { contentType: "text/plain" });
      }
      if (url.endsWith("/sitemap.xml")) {
        return ok(url, "<urlset></urlset>", {
          contentType: "application/xml",
        });
      }
      return ok(url, "<html><body>Acme</body></html>", {
        xRobotsTag: "otherbot: noindex",
      });
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page.robotsNoindex).toBe(false);
  });

  it("does not derive document facts from an unreliably decoded page", async () => {
    const fetchResource: SeoAuditFetchResource = async (url) => {
      if (url.endsWith("/robots.txt")) {
        return ok(url, "User-agent: *", { contentType: "text/plain" });
      }
      if (url.endsWith("/sitemap.xml")) {
        return ok(url, "<urlset></urlset>", {
          contentType: "application/xml",
        });
      }
      return ok(url, "", {
        decodeState: "unsupported_charset",
        contentType: "text/html; charset=iso-8859-1",
      });
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page).toMatchObject({
      decodeReliable: false,
      title: null,
      h1Count: 0,
      robotsNoindex: null,
    });
  });

  it("does not parse a missing Content-Type body as HTML evidence", async () => {
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
        "<html><head><title>Not confirmed HTML</title></head><body><h1>Hidden</h1></body></html>",
        { contentType: null },
      );
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page).toMatchObject({
      title: null,
      h1Count: 0,
      robotsNoindex: null,
    });
  });

  it("counts only closed JSON-LD blocks from a truncated response", async () => {
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
        '<html><head><script type="application/ld+json">{"@type":',
        { bodyComplete: false, decodeState: "utf8_prefix" },
      );
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page).toMatchObject({
      bodyComplete: false,
      jsonLdBlockCount: 0,
      jsonLdErrorCount: 0,
      jsonLdScanComplete: false,
    });
  });

  it.each([
    [
      "a comment",
      '<!-- <script type="application/ld+json">{bad}</script> -->',
    ],
    [
      "a regular script string",
      '<script>const fixture = \'<script type="application/ld+json">{bad}</script>\';</script>',
    ],
  ])("ignores JSON-LD-looking markup inside %s", async (_label, body) => {
    const fetchResource: SeoAuditFetchResource = async (url) => {
      if (url.endsWith("/robots.txt")) {
        return ok(url, "User-agent: *", { contentType: "text/plain" });
      }
      if (url.endsWith("/sitemap.xml")) {
        return ok(url, "<urlset></urlset>", {
          contentType: "application/xml",
        });
      }
      return ok(url, `<html><body>${body}</body></html>`);
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page).toMatchObject({
      jsonLdBlockCount: 0,
      jsonLdErrorCount: 0,
      jsonLdScanComplete: true,
    });
  });

  it("keeps text-state projection when an opening tag has an unquoted quote", async () => {
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
          '<html><body><textarea data-x=bar"baz>',
          '<script type="application/ld+json">{bad}</script>',
          "</textarea></body></html>",
        ].join(""),
      );
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page).toMatchObject({
      jsonLdBlockCount: 0,
      jsonLdErrorCount: 0,
      jsonLdScanComplete: true,
    });
  });

  it("stops JSON-LD evidence scanning inside an incomplete quoted opening tag", async () => {
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
          "<html><body><textarea foo='unterminated>",
          '<script type="application/ld+json">{bad}</script>',
          "</textarea></body></html>",
        ].join(""),
      );
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page).toMatchObject({
      jsonLdBlockCount: 0,
      jsonLdErrorCount: 0,
      jsonLdScanComplete: false,
    });
  });

  it.each([
    [
      "a data-type attribute",
      '<script data-type="application/ld+json">{bad}</script>',
    ],
    [
      "textarea text",
      '<textarea><script type="application/ld+json">{bad}</script></textarea>',
    ],
    [
      "another element's quoted attribute",
      '<div data-fixture=\'<script type="application/ld+json">{bad}</script>\'>Acme</div>',
    ],
  ])("ignores JSON-LD-looking markup inside %s", async (_label, body) => {
    const fetchResource: SeoAuditFetchResource = async (url) => {
      if (url.endsWith("/robots.txt")) {
        return ok(url, "User-agent: *", { contentType: "text/plain" });
      }
      if (url.endsWith("/sitemap.xml")) {
        return ok(url, "<urlset></urlset>", {
          contentType: "application/xml",
        });
      }
      return ok(url, `<html><body>${body}</body></html>`);
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page).toMatchObject({
      jsonLdBlockCount: 0,
      jsonLdErrorCount: 0,
      jsonLdScanComplete: true,
    });
  });

  it("reports malformed JSON-LD from an actual script type attribute", async () => {
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
        '<html><body><script type="application/ld+json">{bad}</script></body></html>',
      );
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page).toMatchObject({
      jsonLdBlockCount: 0,
      jsonLdErrorCount: 1,
      jsonLdScanComplete: true,
    });
  });

  it("marks the JSON-LD projection incomplete when a 101st block exists", async () => {
    const blocks = [
      ...Array.from(
        { length: 100 },
        () =>
          '<script type="application/ld+json">{"@type":"Thing"}</script>',
      ),
      '<script type="application/ld+json">{bad}</script>',
    ].join("");
    const fetchResource: SeoAuditFetchResource = async (url) => {
      if (url.endsWith("/robots.txt")) {
        return ok(url, "User-agent: *", { contentType: "text/plain" });
      }
      if (url.endsWith("/sitemap.xml")) {
        return ok(url, "<urlset></urlset>", {
          contentType: "application/xml",
        });
      }
      return ok(url, `<html><head>${blocks}</head><body>Acme</body></html>`);
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.page).toMatchObject({
      jsonLdBlockCount: 100,
      jsonLdErrorCount: 0,
      jsonLdScanComplete: false,
    });
  });

  it.each([
    ["truncated", false, null],
    ["complete malformed HTML", true, false],
  ])(
    "ignores robots meta inside an unclosed comment on a %s response",
    async (_label, bodyComplete, expectedNoindex) => {
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
          '<html><head><!-- <meta name="googlebot" content="noindex">',
          {
            bodyComplete,
            decodeState: bodyComplete ? "utf8" : "utf8_prefix",
          },
        );
      };

      const result = await scanSeoAuditSite(
        "https://acme.com/",
        {},
        fetchResource,
      );

      expect(result.page.robotsNoindex).toBe(expectedNoindex);
    },
  );

  it("keeps an unreliably decoded robots response as unverified evidence", async () => {
    const fetchResource: SeoAuditFetchResource = async (url) => {
      if (url.endsWith("/robots.txt")) {
        return ok(url, "", {
          contentType: "text/plain; charset=iso-8859-1",
          decodeState: "unsupported_charset",
        });
      }
      if (url.endsWith("/sitemap.xml")) {
        return ok(url, "<urlset></urlset>", {
          contentType: "application/xml",
        });
      }
      return ok(url, "<html><body>Acme</body></html>");
    };

    const result = await scanSeoAuditSite(
      "https://acme.com/",
      {},
      fetchResource,
    );

    expect(result.robots.state).toBe("decode_error");
    expect(result.robotsPageAllowed).toBeNull();
  });
});
