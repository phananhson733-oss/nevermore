import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createCanonicalUrlGuard } from "../url-safety/guard.ts";
import {
  PUBLIC_WEB_RESEARCH_ADAPTER_VERSION,
  PUBLIC_WEB_RESEARCH_CONTENT_HASH_METHOD,
  PUBLIC_WEB_RESEARCH_LIMITS,
  retrievePublicWebResearch,
  type PublicWebResearchFetch,
  type PublicWebResearchUrlGuard,
} from "./retriever.ts";

const PUBLIC_IP = "93.184.216.34";
const FIXED_NOW = Date.parse("2026-07-27T08:09:10.000Z");

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const allowPublicUrl: PublicWebResearchUrlGuard = async (rawUrl) => {
  const normalizedUrl = new URL(rawUrl).href;
  return {
    safe: true,
    normalizedUrl,
    pinnedIp: PUBLIC_IP,
    reason: null,
  };
};

function htmlResponse(
  body: string,
  init: {
    readonly status?: number;
    readonly headers?: Readonly<Record<string, string>>;
  } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...init.headers,
    },
  });
}

function textResponse(
  body: string,
  init: {
    readonly status?: number;
    readonly headers?: Readonly<Record<string, string>>;
  } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...init.headers,
    },
  });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { location },
  });
}

describe("retrievePublicWebResearch", () => {
  it("does no network work until the Worker explicitly invokes the retriever", async () => {
    const fetch = vi.fn<PublicWebResearchFetch>();
    const guard = vi.fn<PublicWebResearchUrlGuard>();

    expect(fetch).not.toHaveBeenCalled();
    expect(guard).not.toHaveBeenCalled();

    guard.mockImplementation(allowPublicUrl);
    fetch.mockResolvedValue(textResponse("Explicit worker retrieval."));

    await retrievePublicWebResearch(["https://example.com/source"], {
      fetch,
      guard,
      now: () => FIXED_NOW,
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(guard).toHaveBeenCalledOnce();
  });

  it("captures bounded normalized HTML facts, immutable hashes, and transport metrics", async () => {
    const html = `<!doctype html>
      <html>
        <head><title> Research &amp; Title </title></head>
        <body>
          <nav>Unrelated navigation</nav>
          <h1>Main claim</h1>
          <p>Evidence one &amp; two.</p>
          <script>doNotPersist()</script>
        </body>
      </html>`;
    const fetch = vi.fn<PublicWebResearchFetch>().mockResolvedValue(
      htmlResponse(html),
    );

    const result = await retrievePublicWebResearch(
      ["https://EXAMPLE.com:443/source#fragment"],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
      },
    );

    expect(result.adapterVersion).toBe(PUBLIC_WEB_RESEARCH_ADAPTER_VERSION);
    expect(PUBLIC_WEB_RESEARCH_CONTENT_HASH_METHOD).toBe(
      "sha256_normalized_text",
    );
    expect(result.availability).toBe("available");
    expect(result.limitation).toBeNull();
    expect(result.stopReason).toBeNull();
    expect(result.usage).toEqual({
      targetCount: 1,
      attemptedTargets: 1,
      availableTargets: 1,
      partialTargets: 0,
      unavailableTargets: 0,
      bodyBytes: new TextEncoder().encode(html).byteLength,
      redirectsFollowed: 0,
      elapsedMs: 0,
    });

    const source = result.sources[0];
    expect(source).toMatchObject({
      requestedUrl: "https://example.com/source#fragment",
      finalUrl: "https://example.com/source#fragment",
      capturedAt: "2026-07-27T08:09:10.000Z",
      title: "Research & Title",
      excerpt: "Main claim Evidence one & two.",
      status: 200,
      contentType: "text/html; charset=utf-8",
      bodyBytes: new TextEncoder().encode(html).byteLength,
      wordCount: 6,
      contentTruncated: false,
      excerptTruncated: false,
      responseMs: 0,
      redirectChain: [],
      availability: "available",
      limitation: null,
    });
    expect(source?.contentText).toContain("Main claim");
    expect(source?.contentText).toContain("Evidence one & two.");
    expect(source?.contentText).not.toContain("Unrelated navigation");
    expect(source?.contentText).not.toContain("doNotPersist");
    expect(source?.urlHash).toBe(sha256("https://example.com/source#fragment"));
    expect(source?.contentHash).toBe(sha256(source?.contentText ?? ""));

    const call = fetch.mock.calls[0];
    expect(call?.[0]).toBe("https://example.com/source#fragment");
    expect(call?.[1]).toMatchObject({
      method: "GET",
      redirect: "manual",
      pinnedIp: PUBLIC_IP,
    });
    expect(call?.[1].dispatcher).toBeTruthy();
    expect(call?.[1].signal).toBeInstanceOf(AbortSignal);
    expect(call?.[1].headers).toMatchObject({
      accept: "text/html, application/xhtml+xml, text/plain",
      "user-agent": "GenGrowth-Public-Web-Research/1.0",
    });
  });

  it("normalizes plain text before hashing and bounds its persisted projections", async () => {
    const raw = `  Alpha\t beta

      gamma. ${"d".repeat(PUBLIC_WEB_RESEARCH_LIMITS.maxContentTextChars + 100)} `;
    const fetch = vi
      .fn<PublicWebResearchFetch>()
      .mockResolvedValue(textResponse(raw));

    const result = await retrievePublicWebResearch(
      ["https://example.com/plain"],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
      },
    );

    const source = result.sources[0];
    expect(source?.availability).toBe("partial");
    expect(source?.title).toBeNull();
    expect(source?.contentText).toMatch(/^Alpha beta gamma\. d/);
    expect([...(source?.contentText ?? "")]).toHaveLength(
      PUBLIC_WEB_RESEARCH_LIMITS.maxContentTextChars,
    );
    expect([...(source?.excerpt ?? "")].length).toBeLessThanOrEqual(
      PUBLIC_WEB_RESEARCH_LIMITS.maxExcerptChars,
    );
    expect(source?.wordCount).toBe(
      raw.trim().split(/\s+/).filter(Boolean).length,
    );
    expect(source?.contentTruncated).toBe(true);
    expect(source?.excerptTruncated).toBe(true);
    expect(source?.limitation).toMatch(/64 KiB.*truncated/i);
    expect(source?.limitation).toMatch(/excerpt.*truncated/i);
    const fullNormalizedText = raw.replace(/\s+/g, " ").trim();
    expect(source?.contentHash).toBe(sha256(fullNormalizedText));
    expect(source?.contentHash).not.toBe(sha256(source?.contentText ?? ""));
  });

  it("marks a normalized HTML content projection truncated without hiding it as available", async () => {
    const headingTexts = Array.from(
      { length: 70 },
      (_, index) => `Heading ${index} ${"h".repeat(480)}`,
    );
    const paragraphTexts = Array.from(
      { length: 40 },
      (_, index) => `Paragraph ${index} ${"p".repeat(980)}`,
    );
    const headings = headingTexts.map((text) => `<h2>${text}</h2>`).join("");
    const paragraphs = paragraphTexts
      .map((text) => `<p>${text}</p>`)
      .join("");
    const fetch = vi
      .fn<PublicWebResearchFetch>()
      .mockResolvedValue(htmlResponse(`<body>${headings}${paragraphs}</body>`));

    const result = await retrievePublicWebResearch(
      ["https://example.com/long-html"],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
      },
    );

    const source = result.sources[0];
    expect(source?.availability).toBe("partial");
    expect(source?.contentTruncated).toBe(true);
    expect(source?.excerptTruncated).toBe(true);
    expect([...(source?.contentText ?? "")]).toHaveLength(
      PUBLIC_WEB_RESEARCH_LIMITS.maxContentTextChars,
    );
    expect(source?.limitation).toMatch(
      /normalized HTML content projection.*64 KiB.*truncated/i,
    );
    expect(source?.contentHash).toBe(
      sha256([...headingTexts, ...paragraphTexts].join(" ")),
    );
    expect(source?.contentHash).not.toBe(sha256(source?.contentText ?? ""));
  });

  it("explains a bounded HTML excerpt without misclassifying the retained body projection", async () => {
    const paragraph = `Preview begins. ${"body ".repeat(150)}`;
    const fetch = vi
      .fn<PublicWebResearchFetch>()
      .mockResolvedValue(htmlResponse(`<body><p>${paragraph}</p></body>`));

    const result = await retrievePublicWebResearch(
      ["https://example.com/excerpt"],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
      },
    );

    const source = result.sources[0];
    expect(source?.availability).toBe("available");
    expect(source?.contentTruncated).toBe(false);
    expect(source?.excerptTruncated).toBe(true);
    expect([...(source?.excerpt ?? "")]).toHaveLength(500);
    expect([...(source?.contentText ?? "")].length).toBeGreaterThan(500);
    expect(source?.limitation).toMatch(
      /excerpt.*bounded preview.*truncated/i,
    );
    expect(source?.limitation).not.toMatch(/content projection.*truncated/i);
  });

  it("produces the same normalized content hash for whitespace-only HTML changes", async () => {
    const fetch = vi
      .fn<PublicWebResearchFetch>()
      .mockResolvedValueOnce(
        htmlResponse("<html><body><h1>Stable</h1><p>Same claim.</p></body></html>"),
      )
      .mockResolvedValueOnce(
        htmlResponse(
          "<html> <body> <h1> Stable </h1> <p> Same   claim. </p> </body> </html>",
        ),
      );

    const result = await retrievePublicWebResearch(
      ["https://one.example/a", "https://two.example/b"],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
      },
    );

    expect(result.sources[0]?.contentText).toBe(
      result.sources[1]?.contentText,
    );
    expect(result.sources[0]?.contentHash).toBe(
      result.sources[1]?.contentHash,
    );
  });

  it("re-guards and DNS-pins every safe redirect hop while retaining the chain", async () => {
    const guard = vi.fn<PublicWebResearchUrlGuard>(async (rawUrl) => ({
      safe: true,
      normalizedUrl: new URL(rawUrl).href,
      pinnedIp:
        new URL(rawUrl).hostname === "www.example.net"
          ? "93.184.216.35"
          : PUBLIC_IP,
      reason: null,
    }));
    const fetch = vi.fn<PublicWebResearchFetch>(
      async (url) =>
        url === "https://example.com/start"
          ? redirect("https://www.example.net/final", 301)
          : htmlResponse("<title>Final</title><p>Redirected evidence.</p>"),
    );

    const result = await retrievePublicWebResearch(
      ["https://example.com/start"],
      {
        fetch,
        guard,
        now: () => FIXED_NOW,
      },
    );

    expect(guard.mock.calls.map(([url]) => url)).toEqual([
      "https://example.com/start",
      "https://www.example.net/final",
    ]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://example.com/start",
      "https://www.example.net/final",
    ]);
    expect(fetch.mock.calls.map(([, init]) => init.pinnedIp)).toEqual([
      PUBLIC_IP,
      "93.184.216.35",
    ]);
    expect(fetch.mock.calls[0]?.[1].dispatcher).not.toBe(
      fetch.mock.calls[1]?.[1].dispatcher,
    );
    expect(result.sources[0]).toMatchObject({
      requestedUrl: "https://example.com/start",
      finalUrl: "https://www.example.net/final",
      redirectChain: ["https://www.example.net/final"],
      status: 200,
      availability: "available",
    });
    expect(result.sources[0]?.urlHash).toBe(
      sha256("https://www.example.net/final"),
    );
    expect(result.usage.redirectsFollowed).toBe(1);
  });

  it("rejects unsafe initial targets as unavailable records without transport", async () => {
    const guard = createCanonicalUrlGuard({
      lookup: async () => [PUBLIC_IP],
    });
    const fetch = vi.fn<PublicWebResearchFetch>();
    const targets = [
      "file:///etc/passwd",
      "https://user:secret@example.com/private",
      "https://example.com:8443/admin",
      "http://127.0.0.1/internal",
      "http://169.254.169.254/latest/meta-data",
      "http://metadata.google.internal/computeMetadata/v1/",
    ];

    const result = await retrievePublicWebResearch(targets, {
      fetch,
      guard,
      now: () => FIXED_NOW,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.availability).toBe("unavailable");
    expect(result.stopReason).toBeNull();
    expect(result.sources).toHaveLength(targets.length);
    expect(
      result.sources.every(
        (source) =>
          source.availability === "unavailable" &&
          source.status === null &&
          source.finalUrl === null &&
          source.contentHash === null &&
          source.limitation?.includes("safety guard"),
      ),
    ).toBe(true);
    expect(result.sources[1]?.requestedUrl).not.toContain("secret");
  });

  it("never persists credentials from an overlong malformed target", async () => {
    const guard = vi.fn<PublicWebResearchUrlGuard>();
    const fetch = vi.fn<PublicWebResearchFetch>();
    const target =
      `https://user:top-secret@${"a".repeat(
        PUBLIC_WEB_RESEARCH_LIMITS.maxUrlChars,
      )}.example/source`;

    const result = await retrievePublicWebResearch([target], {
      fetch,
      guard,
      now: () => FIXED_NOW,
    });

    expect(guard).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(result.sources[0]?.availability).toBe("unavailable");
    expect(result.sources[0]?.requestedUrl).not.toContain("top-secret");
    expect(result.sources[0]?.requestedUrl.length).toBeLessThanOrEqual(
      PUBLIC_WEB_RESEARCH_LIMITS.maxUrlChars,
    );
    expect(result.sources[0]?.limitation).toContain("URL length");
  });

  it("fails closed when the guard throws or supplies a non-IP pin", async () => {
    const guard = vi.fn<PublicWebResearchUrlGuard>(async (url) => {
      if (url.includes("throws")) throw new Error("resolver fixture details");
      return {
        safe: true,
        normalizedUrl: new URL(url).href,
        pinnedIp: "not-an-ip",
        reason: null,
      };
    });
    const fetch = vi.fn<PublicWebResearchFetch>();

    const result = await retrievePublicWebResearch(
      [
        "https://throws.example/source",
        "https://bad-pin.example/source",
      ],
      {
        fetch,
        guard,
        now: () => FIXED_NOW,
      },
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(result.availability).toBe("unavailable");
    expect(
      result.sources.every(
        (source) =>
          source.availability === "unavailable" &&
          source.limitation?.includes("safety guard"),
      ),
    ).toBe(true);
    expect(result.limitation).not.toContain("fixture");
  });

  it("rejects a guard-normalized URL that exceeds the persisted URL bound", async () => {
    const guard = vi.fn<PublicWebResearchUrlGuard>(async () => ({
      safe: true,
      normalizedUrl:
        `https://example.com/${"x".repeat(
          PUBLIC_WEB_RESEARCH_LIMITS.maxUrlChars,
        )}`,
      pinnedIp: PUBLIC_IP,
      reason: null,
    }));
    const fetch = vi.fn<PublicWebResearchFetch>();

    const result = await retrievePublicWebResearch(
      ["https://example.com/source"],
      {
        fetch,
        guard,
        now: () => FIXED_NOW,
      },
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(result.sources[0]?.availability).toBe("unavailable");
    expect(result.sources[0]?.limitation).toContain("safety guard");
  });

  it("fails closed on an HTTPS-to-HTTP downgrade after guarding the redirect target", async () => {
    const guard = vi.fn<PublicWebResearchUrlGuard>(allowPublicUrl);
    const fetch = vi
      .fn<PublicWebResearchFetch>()
      .mockResolvedValueOnce(redirect("http://public.example/final"));

    const result = await retrievePublicWebResearch(
      ["https://secure.example/start"],
      {
        fetch,
        guard,
        now: () => FIXED_NOW,
      },
    );

    expect(guard.mock.calls.map(([url]) => url)).toEqual([
      "https://secure.example/start",
      "http://public.example/final",
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(result.sources[0]).toMatchObject({
      requestedUrl: "https://secure.example/start",
      finalUrl: "https://secure.example/start",
      status: 302,
      availability: "partial",
    });
    expect(result.sources[0]?.limitation).toContain(
      "HTTPS-to-HTTP redirect downgrade",
    );
  });

  it("re-runs the canonical guard and never transports a private redirect target", async () => {
    const guard = vi.fn(
      createCanonicalUrlGuard({
        lookup: async () => [PUBLIC_IP],
      }),
    );
    const fetch = vi
      .fn<PublicWebResearchFetch>()
      .mockResolvedValueOnce(
        redirect("http://169.254.169.254/latest/meta-data"),
      );

    const result = await retrievePublicWebResearch(
      ["https://public.example/start"],
      {
        fetch,
        guard,
        now: () => FIXED_NOW,
      },
    );

    expect(guard.mock.calls.map(([url]) => url)).toEqual([
      "https://public.example/start",
      "http://169.254.169.254/latest/meta-data",
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(result.sources[0]).toMatchObject({
      finalUrl: "https://public.example/start",
      status: 302,
      redirectChain: [],
      availability: "partial",
    });
    expect(result.sources[0]?.limitation).toContain("safety guard");
  });

  it("stops after four followed redirects and reports the source as partial", async () => {
    const fetch = vi.fn<PublicWebResearchFetch>(async (url) => {
      const hop = Number(new URL(url).pathname.slice(1) || "0");
      return redirect(`https://example.com/${hop + 1}`);
    });

    const result = await retrievePublicWebResearch(
      ["https://example.com/0"],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
      },
    );

    expect(fetch).toHaveBeenCalledTimes(5);
    expect(result.sources[0]).toMatchObject({
      finalUrl: "https://example.com/4",
      status: 302,
      redirectChain: [
        "https://example.com/1",
        "https://example.com/2",
        "https://example.com/3",
        "https://example.com/4",
      ],
      availability: "partial",
    });
    expect(result.sources[0]?.limitation).toContain("redirect limit");
  });

  it("rejects malformed and overlong redirect targets without guarding or fetching them", async () => {
    const guard = vi.fn<PublicWebResearchUrlGuard>(allowPublicUrl);
    const fetch = vi.fn<PublicWebResearchFetch>(async (url) =>
      url.includes("invalid")
        ? redirect("http://[")
        : redirect(
            `https://example.com/${"x".repeat(
              PUBLIC_WEB_RESEARCH_LIMITS.maxUrlChars,
            )}`,
          ),
    );

    const result = await retrievePublicWebResearch(
      [
        "https://example.com/invalid",
        "https://example.com/overlong",
      ],
      {
        fetch,
        guard,
        now: () => FIXED_NOW,
      },
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(result.sources.map((source) => source.availability)).toEqual([
      "partial",
      "partial",
    ]);
    expect(
      result.sources.every((source) =>
        source.limitation?.includes("invalid redirect target"),
      ),
    ).toBe(true);
  });

  it("accepts only HTML, XHTML, and plain text without letting one bad source fail the batch", async () => {
    const fetch = vi
      .fn<PublicWebResearchFetch>()
      .mockResolvedValueOnce(
        new Response('{"unsafe":"for research ingestion"}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("<title>XHTML</title><p>Accepted.</p>", {
          status: 200,
          headers: {
            "content-type": "application/xhtml+xml; charset=UTF-8",
          },
        }),
      )
      .mockResolvedValueOnce(textResponse("Also accepted."));

    const result = await retrievePublicWebResearch(
      [
        "https://example.com/data",
        "https://example.com/xhtml",
        "https://example.com/plain",
      ],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
      },
    );

    expect(result.availability).toBe("partial");
    expect(result.limitation).toContain("1 of 3");
    expect(result.sources.map((source) => source.availability)).toEqual([
      "unavailable",
      "available",
      "available",
    ]);
    expect(result.sources[0]).toMatchObject({
      status: 200,
      contentType: "application/json",
      bodyBytes: 0,
      contentText: null,
      contentHash: null,
    });
    expect(result.sources[0]?.limitation).toContain(
      "Unsupported response content type",
    );
  });

  it("retains accepted non-2xx response content as explicitly partial evidence", async () => {
    const fetch = vi
      .fn<PublicWebResearchFetch>()
      .mockResolvedValue(
        htmlResponse("<title>Unavailable</title><p>Maintenance notice.</p>", {
          status: 503,
        }),
      );

    const result = await retrievePublicWebResearch(
      ["https://example.com/status"],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
      },
    );

    expect(result.availability).toBe("partial");
    expect(result.sources[0]).toMatchObject({
      status: 503,
      availability: "partial",
      title: "Unavailable",
    });
    expect(result.sources[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sources[0]?.limitation).toContain("HTTP status 503");
  });

  it("converts a transport failure into one unavailable source and continues the batch", async () => {
    const fetch = vi
      .fn<PublicWebResearchFetch>()
      .mockRejectedValueOnce(new Error("fixture network details"))
      .mockResolvedValueOnce(textResponse("The second source is usable."));

    const result = await retrievePublicWebResearch(
      ["https://one.example/source", "https://two.example/source"],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
      },
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.availability).toBe("partial");
    expect(result.sources[0]).toMatchObject({
      finalUrl: "https://one.example/source",
      status: null,
      contentHash: null,
      availability: "unavailable",
    });
    expect(result.sources[0]?.limitation).not.toContain("fixture");
    expect(result.sources[1]?.availability).toBe("available");
  });

  it("caps one decoded body at 256 KiB, cancels it, and continues with later targets", async () => {
    let cancelled = false;
    const oversized = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(
          new Uint8Array(PUBLIC_WEB_RESEARCH_LIMITS.maxBodyBytes + 1),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetch = vi
      .fn<PublicWebResearchFetch>()
      .mockResolvedValueOnce(
        new Response(oversized, {
          headers: { "content-type": "text/plain" },
        }),
      )
      .mockResolvedValueOnce(textResponse("Later source remains available."));

    const result = await retrievePublicWebResearch(
      ["https://example.com/large", "https://example.com/later"],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
      },
    );

    expect(cancelled).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.sources[0]).toMatchObject({
      availability: "partial",
      contentText: null,
      contentHash: null,
    });
    expect(result.sources[0]?.bodyBytes).toBeLessThanOrEqual(
      PUBLIC_WEB_RESEARCH_LIMITS.maxBodyBytes,
    );
    expect(result.sources[0]?.limitation).toContain("256 KiB");
    expect(result.sources[1]?.availability).toBe("available");
  });

  it("rejects an oversized declared content length before reading the body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("must not be read"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetch = vi.fn<PublicWebResearchFetch>().mockResolvedValue(
      new Response(body, {
        headers: {
          "content-type": "text/plain",
          "content-length": String(
            PUBLIC_WEB_RESEARCH_LIMITS.maxBodyBytes + 1,
          ),
        },
      }),
    );

    const result = await retrievePublicWebResearch(
      ["https://example.com/declared-large"],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
      },
    );

    expect(cancelled).toBe(true);
    expect(result.sources[0]).toMatchObject({
      bodyBytes: 0,
      availability: "partial",
      contentHash: null,
    });
    expect(result.sources[0]?.limitation).toContain("256 KiB");
  });

  it("stops before a declared body would cross the remaining total-byte budget", async () => {
    const fullPage = "a".repeat(PUBLIC_WEB_RESEARCH_LIMITS.maxBodyBytes);
    const shorterPage = "b".repeat(200 * 1024);
    const fetch = vi
      .fn<PublicWebResearchFetch>()
      .mockResolvedValueOnce(textResponse(fullPage))
      .mockResolvedValueOnce(textResponse(fullPage))
      .mockResolvedValueOnce(textResponse(fullPage))
      .mockResolvedValueOnce(textResponse(shorterPage))
      .mockResolvedValueOnce(
        new Response("not read", {
          headers: {
            "content-type": "text/plain",
            "content-length": String(100 * 1024),
          },
        }),
      );

    const result = await retrievePublicWebResearch(
      [
        "https://one.example/source",
        "https://two.example/source",
        "https://three.example/source",
        "https://four.example/source",
        "https://five.example/source",
      ],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
      },
    );

    expect(fetch).toHaveBeenCalledTimes(5);
    expect(result.stopReason).toBe("max_total_bytes");
    expect(result.sources[4]).toMatchObject({
      bodyBytes: 0,
      availability: "partial",
      contentHash: null,
    });
    expect(result.sources[4]?.limitation).toContain("1 MiB");
    expect(result.usage.bodyBytes).toBe(
      PUBLIC_WEB_RESEARCH_LIMITS.maxBodyBytes * 3 + 200 * 1024,
    );
  });

  it("reports response-stream errors and caller aborts during body reads", async () => {
    const controller = new AbortController();
    let pendingReadStarted = false;
    const pendingBody = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
    });
    const getPendingReader = pendingBody.getReader.bind(pendingBody);
    Object.defineProperty(pendingBody, "getReader", {
      value: () => {
        pendingReadStarted = true;
        return getPendingReader();
      },
    });
    const erroredBody = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.error(new Error("stream fixture details"));
      },
    });
    const fetch = vi
      .fn<PublicWebResearchFetch>()
      .mockResolvedValueOnce(
        new Response(erroredBody, {
          headers: { "content-type": "text/plain" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(pendingBody, {
          headers: { "content-type": "text/plain" },
        }),
      );

    const errored = await retrievePublicWebResearch(
      ["https://example.com/errored"],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
      },
    );
    expect(errored.sources[0]?.availability).toBe("partial");
    expect(errored.sources[0]?.limitation).toContain("decode");
    expect(errored.sources[0]?.limitation).not.toContain("fixture");

    const pending = retrievePublicWebResearch(
      ["https://example.com/pending"],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
        signal: controller.signal,
      },
    );
    await vi.waitFor(() => expect(pendingReadStarted).toBe(true));
    controller.abort();
    const aborted = await pending;
    expect(aborted.stopReason).toBe("aborted");
    expect(aborted.sources[0]?.availability).toBe("partial");
  });

  it("handles bodyless text and HTML with only generic visible body content", async () => {
    const fetch = vi
      .fn<PublicWebResearchFetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { "content-type": "text/plain" },
        }),
      )
      .mockResolvedValueOnce(
        htmlResponse(
          "<html><body><div>Generic visible research content.</div></body></html>",
        ),
      );

    const result = await retrievePublicWebResearch(
      ["https://example.com/empty", "https://example.com/generic"],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
      },
    );

    expect(result.sources[0]).toMatchObject({
      availability: "partial",
      bodyBytes: 0,
      contentText: null,
      contentHash: null,
    });
    expect(result.sources[0]?.limitation).toContain("no extractable");
    expect(result.sources[1]).toMatchObject({
      availability: "available",
      contentText: "Generic visible research content.",
      excerpt: "Generic visible research content.",
    });
  });

  it("makes total-byte exhaustion explicit and marks unattempted sources unavailable", async () => {
    const exactPage = "a".repeat(PUBLIC_WEB_RESEARCH_LIMITS.maxBodyBytes);
    const fetch = vi
      .fn<PublicWebResearchFetch>()
      .mockImplementation(async () => textResponse(exactPage));

    const result = await retrievePublicWebResearch(
      [
        "https://one.example/source",
        "https://two.example/source",
        "https://three.example/source",
        "https://four.example/source",
        "https://five.example/source",
      ],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
      },
    );

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(result.stopReason).toBe("max_total_bytes");
    expect(result.availability).toBe("partial");
    expect(result.usage.bodyBytes).toBe(
      PUBLIC_WEB_RESEARCH_LIMITS.maxTotalBytes,
    );
    expect(result.sources.slice(0, 4).map((source) => source.availability)).toEqual(
      ["partial", "partial", "partial", "partial"],
    );
    expect(
      result.sources
        .slice(0, 4)
        .every((source) => source.contentTruncated),
    ).toBe(true);
    expect(result.sources[4]).toMatchObject({
      availability: "unavailable",
      status: null,
      contentText: null,
      contentHash: null,
    });
    expect(result.sources[4]?.limitation).toContain(
      "total decoded-body budget",
    );
    expect(result.limitation).toContain("1 MiB");
  });

  it("enforces the target cap before guard or transport", async () => {
    const guard = vi.fn<PublicWebResearchUrlGuard>(allowPublicUrl);
    const fetch = vi.fn<PublicWebResearchFetch>();
    const targets = Array.from(
      { length: PUBLIC_WEB_RESEARCH_LIMITS.maxTargets + 1 },
      (_, index) => `https://example.com/${index}`,
    );

    await expect(
      retrievePublicWebResearch(targets, {
        fetch,
        guard,
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/between 1 and 8 targets/);
    expect(guard).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects empty and non-array batches before any dependency runs", async () => {
    const guard = vi.fn<PublicWebResearchUrlGuard>(allowPublicUrl);
    const fetch = vi.fn<PublicWebResearchFetch>();

    await expect(
      retrievePublicWebResearch([], {
        fetch,
        guard,
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/between 1 and 8 targets/);
    await expect(
      retrievePublicWebResearch(null as unknown as readonly string[], {
        fetch,
        guard,
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/between 1 and 8 targets/);
    expect(guard).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("turns an external abort into explicit unavailable records and propagates the signal", async () => {
    const controller = new AbortController();
    let transportSignal: AbortSignal | undefined;
    const fetch = vi.fn<PublicWebResearchFetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          transportSignal = init.signal;
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const pending = retrievePublicWebResearch(
      ["https://one.example/source", "https://two.example/source"],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => FIXED_NOW,
        signal: controller.signal,
      },
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();
    const result = await pending;

    expect(transportSignal?.aborted).toBe(true);
    expect(result.stopReason).toBe("aborted");
    expect(result.availability).toBe("unavailable");
    expect(result.sources).toHaveLength(2);
    expect(
      result.sources.every(
        (source) =>
          source.availability === "unavailable" &&
          source.limitation?.includes("aborted"),
      ),
    ).toBe(true);
  });

  it("honors a signal that is already aborted before retrieval starts", async () => {
    const controller = new AbortController();
    controller.abort();
    const guard = vi.fn<PublicWebResearchUrlGuard>(allowPublicUrl);
    const fetch = vi.fn<PublicWebResearchFetch>();

    const result = await retrievePublicWebResearch(
      ["https://example.com/source"],
      {
        fetch,
        guard,
        now: () => FIXED_NOW,
        signal: controller.signal,
      },
    );

    expect(guard).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(result.stopReason).toBe("aborted");
    expect(result.availability).toBe("unavailable");
  });

  it("propagates AbortSignal into an injectable URL guard and stops waiting", async () => {
    const controller = new AbortController();
    let guardSignal: AbortSignal | undefined;
    const guard: PublicWebResearchUrlGuard = async (_url, signal) =>
      new Promise<never>((_resolve, reject) => {
        guardSignal = signal;
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    const fetch = vi.fn<PublicWebResearchFetch>();

    const pending = retrievePublicWebResearch(
      ["https://example.com/source"],
      {
        fetch,
        guard,
        now: () => FIXED_NOW,
        signal: controller.signal,
      },
    );
    await vi.waitFor(() => expect(guardSignal).toBeInstanceOf(AbortSignal));
    controller.abort();
    const result = await pending;

    expect(guardSignal?.aborted).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.stopReason).toBe("aborted");
    expect(result.sources[0]?.availability).toBe("unavailable");
  });

  it("bounds a stalled request at 15 seconds without aborting the remaining batch", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi
        .fn<PublicWebResearchFetch>()
        .mockImplementationOnce(
          async () => new Promise<Response>(() => undefined),
        )
        .mockResolvedValueOnce(textResponse("Second source succeeds."));
      const pending = retrievePublicWebResearch(
        ["https://one.example/source", "https://two.example/source"],
        {
          fetch,
          guard: allowPublicUrl,
          now: () => Date.now(),
        },
      );

      await vi.advanceTimersByTimeAsync(
        PUBLIC_WEB_RESEARCH_LIMITS.requestTimeoutMs,
      );
      const result = await pending;

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.stopReason).toBeNull();
      expect(result.sources[0]?.availability).toBe("unavailable");
      expect(result.sources[0]?.limitation).toContain("15 second");
      expect(result.sources[1]?.availability).toBe("available");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the real batch timer stop repeated stalled requests at 60 seconds", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi
        .fn<PublicWebResearchFetch>()
        .mockImplementation(async () => new Promise<Response>(() => undefined));
      const pending = retrievePublicWebResearch(
        [
          "https://one.example/source",
          "https://two.example/source",
          "https://three.example/source",
          "https://four.example/source",
          "https://five.example/source",
        ],
        {
          fetch,
          guard: allowPublicUrl,
          now: () => Date.now(),
        },
      );

      await vi.advanceTimersByTimeAsync(
        PUBLIC_WEB_RESEARCH_LIMITS.maxWallClockMs,
      );
      const result = await pending;

      expect(fetch).toHaveBeenCalledTimes(4);
      expect(result.stopReason).toBe("max_wall_clock");
      expect(result.sources).toHaveLength(5);
      expect(result.sources[4]?.limitation).toContain(
        "60 second wall-clock budget",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes the 60 second batch wall-clock cut explicit", async () => {
    let clock = FIXED_NOW;
    const fetch = vi.fn<PublicWebResearchFetch>(async () => {
      const response = textResponse("Captured before the wall-clock cut.");
      clock += PUBLIC_WEB_RESEARCH_LIMITS.maxWallClockMs;
      return response;
    });

    const result = await retrievePublicWebResearch(
      ["https://one.example/source", "https://two.example/source"],
      {
        fetch,
        guard: allowPublicUrl,
        now: () => clock,
      },
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(result.stopReason).toBe("max_wall_clock");
    expect(result.sources[0]?.availability).toBe("available");
    expect(result.sources[1]?.availability).toBe("unavailable");
    expect(result.sources[1]?.limitation).toContain(
      "60 second wall-clock budget",
    );
  });
});
