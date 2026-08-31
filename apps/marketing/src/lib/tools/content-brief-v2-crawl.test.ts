import { createHash } from "node:crypto";
import {
  CRAWL_CONCURRENCY, CRAWL_DEADLINE_MS, CRAWL_FETCH_TIMEOUT_MS,
  CRAWL_MAX_BYTES_PER_PAGE, ENVELOPE_MS,
} from "@sf/public-tools/content-brief/constants";
import { buildResearchBundle } from "@sf/public-tools/content-brief/v2-research";
import {
  fetchPublicResource,
  type PublicResourceFetchDependencies,
  type PublicResourceFetchOptions, type PublicResourceResult, type PublicResourceSuccess,
} from "@sf/sources/public-http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CRAWL_TEARDOWN_GRACE_MS } from "./content-brief-crawl.ts";
import {
  crawlContentBriefV2Targets, type ContentBriefV2CrawlTarget,
} from "./content-brief-v2-crawl.ts";
import * as crawlModule from "./content-brief-v2-crawl.ts";

const START = 1_700_000_000_000;
const DEADLINE = START + 45_000;
const HTML = "<main><p>Opening paragraph.</p><h2>Research plan</h2><p>Read actual sources.</p></main>";
const competitor = (id: number): ContentBriefV2CrawlTarget => ({
  id: `C${id}`, role: "competitor", url: `https://source${id}.test/article`,
});
const owned = (url = "https://owned.test/guide"): ContentBriefV2CrawlTarget => ({ id: "T1", role: "owned", url });
function page(url: string, overrides: Partial<PublicResourceSuccess> = {}): PublicResourceSuccess {
  return {
    kind: "ok", requestedUrl: url, finalUrl: url, firstStatus: 200, finalStatus: 200,
    redirectChain: [], contentType: "text/html; charset=utf-8", xRobotsTag: null,
    body: HTML, bytes: Buffer.byteLength(HTML), bodyComplete: true, ...overrides,
  };
}
function run(targets: readonly ContentBriefV2CrawlTarget[], respond: (url: string, options: PublicResourceFetchOptions) => Promise<PublicResourceResult>, language = "en", deadlineAt = DEADLINE, now = () => START) {
  return crawlContentBriefV2Targets({ targets, language, deadlineAt }, { fetchResource: (url, options = {}) => respond(url, options), now });
}
const success = async (url: string): Promise<PublicResourceResult> => page(url);

describe("isContentBriefV2CrawlUrl", () => {
  it.each([
    ["https://source.test/guide?view=summary#part", true],
    ["http://www.source.test/guide/", true],
    ["https://例子.test/研究", true],
    ["not-a-url", false],
    ["file:///tmp/page", false],
    ["https://user:pass@source.test/", false],
    ["http://127.0.0.1/", false],
    ["http://localhost/", false],
    ["https://metadata.google.internal/", false],
    ["https://source.test:8080/", false],
    ["https://source.test/a\\b", false],
    ["https://source.test/a\nb", false],
    [`https://source.test/${"a".repeat(2_048)}`, false],
  ])("shares the crawler's lexical admission for %s", (raw, expected) => {
    expect(crawlModule.isContentBriefV2CrawlUrl).toBeTypeOf("function");
    expect(crawlModule.isContentBriefV2CrawlUrl(raw)).toBe(expected);
  });
});

describe("crawlContentBriefV2Targets", () => {
  afterEach(() => vi.useRealTimers());

  it("reads actual HTML into v2 evidence with the raw-body hash and no v1 wrapper", async () => {
    const fetchResource = vi.fn(success);
    const result = await run([competitor(2)], fetchResource);
    expect(result).toEqual({ observed: [{
      id: "C2", role: "competitor", url: competitor(2).url, final_url: competitor(2).url,
      fetched_at: new Date(START).toISOString(), body_complete: true,
      content_hash: createHash("sha256").update(HTML).digest("hex"),
      research: {
        segments: [
          { heading: null, text: "Opening paragraph.", truncated: false },
          { heading: { level: "h2", text: "Research plan" }, text: "Read actual sources.", truncated: false },
        ], segments_total: 2, omitted_segments: 0,
        length: { value: 7, unit: "words", tokenizer: "whitespace" },
      },
    }], failed: [] });
    expect(fetchResource).toHaveBeenCalledExactlyOnceWith(competitor(2).url, {
      timeoutMs: CRAWL_FETCH_TIMEOUT_MS, maxBodyBytes: CRAWL_MAX_BYTES_PER_PAGE, allowRedirect: expect.any(Function),
    });
    expect(buildResearchBundle(result.observed, []).ok).toBe(true);
  });

  it("retains headingless Chinese and labels truncated HTTP bodies honestly", async () => {
    const result = await run([owned()], async (url) => page(url, {
      body: "<main><div>这是需要回答的问题。</div></main>", bodyComplete: false,
    }), "zh");
    expect(result.observed[0]).toMatchObject({
      id: "T1", role: "owned", body_complete: false,
      research: {
        segments: [{ heading: null, text: "这是需要回答的问题。", truncated: false }],
        length: { value: 10, unit: "non_whitespace_characters", tokenizer: "unicode_code_points" },
      },
    });
  });

  it("keeps the extractor's segment and character caps with omitted counts", async () => {
    const body = `<main>${Array.from({ length: 15 }, () => `<p>${"字".repeat(350)}</p>`).join("")}</main>`;
    const result = await run([competitor(1)], async (url) => page(url, { body }), "zh");
    const research = result.observed[0]?.research;
    expect(research?.segments).toHaveLength(12);
    expect(research?.segments[0]?.text).toBe("字".repeat(300));
    expect(research?.segments[0]?.truncated).toBe(true);
    expect(research?.omitted_segments).toBe(3);
    expect(research?.length.value).toBe(5_250);
  });

  it.each(["", "<nav><h2>Navigation</h2><p>Home</p></nav>", "<main><h2>Heading without prose</h2></main>"])(
    "does not treat an empty cleaned body as observed evidence: %s", async (body) => {
      const result = await run([competitor(1)], async (url) => page(url, { body }));
      expect(result).toEqual({ observed: [], failed: [{ id: "C1", url: competitor(1).url, reason: "insufficient_evidence" }] });
    },
  );

  it.each([null, "application/json", "application/x-not-text/htmlish"])("rejects a non-HTML media type %s", async (contentType) => {
    expect((await run([competitor(1)], async (url) => page(url, { contentType }))).failed[0]?.reason).toBe("insufficient_evidence");
  });

  it("accepts exact XHTML media type case-insensitively", async () => {
    expect((await run([competitor(1)], async (url) => page(url, { contentType: "Application/XHTML+XML; charset=utf-8" }))).observed).toHaveLength(1);
  });

  it.each([199, 301, 404, 500])("rejects status %s rather than extracting its error text", async (finalStatus) => {
    const result = await run([competitor(1)], async (url) => page(url, { finalStatus }));
    expect(result.observed).toEqual([]);
    expect(result.failed[0]?.reason).toBe("provider_error");
  });

  it.each(["blocked", "cross_origin", "invalid_redirect", "network", "redirect_limit", "timeout"] as const)("maps transport failure %s without losing the target", async (code) => {
    expect(await run([owned()], async () => ({ kind: "error", code }))).toEqual({
      observed: [], failed: [{ id: "T1", url: owned().url, reason: code === "timeout" ? "timeout" : "provider_error" }],
    });
  });

  it("contains synchronous throws and asynchronous rejections per target", async () => {
    const result = await run([competitor(1), competitor(2)], (url) => {
      if (url === competitor(1).url) throw new Error("private transport detail");
      return Promise.reject(new Error("private provider detail"));
    });
    expect(result.observed).toEqual([]);
    expect(result.failed.map((failure) => failure.reason)).toEqual(["provider_error", "provider_error"]);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it.each([
    [{ id: "C11", role: "competitor", url: "https://source.test/" }],
    [{ id: "T4", role: "owned", url: "https://owned.test/" }],
    [{ id: "C1", role: "owned", url: "https://owned.test/" }],
    [competitor(1), { ...competitor(2), id: "C1" }],
    [competitor(1), { ...competitor(2), url: `${competitor(1).url}#other` }],
    [competitor(1), { ...owned(), url: competitor(1).url }],
  ].map((targets) => ({ targets })))("rejects malformed or duplicate targets before any fetch", async ({ targets }) => {
    const fetchResource = vi.fn(success);
    await expect(run(targets as ContentBriefV2CrawlTarget[], fetchResource)).rejects.toThrow(RangeError);
    expect(fetchResource).not.toHaveBeenCalled();
  });

  it.each(["invalid", "file:///tmp/page", "https://user:pass@owned.test/", "http://127.0.0.1/", "http://localhost/", "https://metadata.google.internal/", "https://owned.test:8080/", "https://owned.test/a\\b", `https://owned.test/${"a".repeat(2_048)}`])(
    "rejects bad target URL before any network: %s", async (url) => {
      const fetchResource = vi.fn(success);
      await expect(run([competitor(1), owned(url)], fetchResource)).rejects.toThrow(RangeError);
      expect(fetchResource).not.toHaveBeenCalled();
    },
  );

  it.each(["file:///tmp/page", "https://user:pass@external.test/", "http://127.0.0.1/", "https://metadata.google.internal/", "https://external.test:8080/"])("never retains unsafe final URL %s", async (finalUrl) => {
    const result = await run([competitor(1)], async (url) => page(url, { finalUrl }));
    expect(result.observed).toEqual([]);
    expect(result.failed[0]?.reason).toBe("provider_error");
  });

  it("allows a competitor's safe cross-site redirect and preserves requested/final identities", async () => {
    const finalUrl = "https://publisher.test/new-article";
    const result = await run([competitor(1)], async (url) => page(url, { finalUrl, redirectChain: [finalUrl] }));
    expect(result.observed[0]).toMatchObject({ url: competitor(1).url, final_url: finalUrl });
  });

  it.each([
    ["http://owned.test/guide", "https://www.owned.test/guide/"],
    ["https://www.owned.test/guide?b=2&a=1&utm_source=test#part", "https://owned.test/guide/?a=1&b=2"],
    ["https://owned.test/%67uide", "https://owned.test/guide"],
  ])("permits the existing same-page normalization %s → %s", async (url, finalUrl) => {
    let allowed: boolean | undefined;
    const result = await run([owned(url)], async (_, options) => {
      allowed = options.allowRedirect?.(url, finalUrl);
      return page(url, { finalUrl, redirectChain: [finalUrl] });
    });
    expect(allowed).toBe(true);
    expect(result.observed).toHaveLength(1);
    expect(result.observed[0]).toMatchObject({ url, final_url: finalUrl });
  });

  it.each([
    "https://owned.test/other", "https://owned.test/guide?view=other", "https://other.test/guide",
    "https://blog.owned.test/guide", "http://owned.test/guide",
  ])("rejects an owned-page replacement before following it: %s", async (destination) => {
    let allowed: boolean | undefined;
    const result = await run([owned()], async (url, options) => {
      allowed = options.allowRedirect?.(url, destination);
      return { kind: "error", code: "cross_origin" };
    });
    expect(allowed).toBe(false);
    expect(result).toEqual({ observed: [], failed: [{ id: "T1", url: owned().url, reason: "redirected" }] });
  });

  it("independently refuses an owned final URL or intermediate hop that replaced the target", async () => {
    for (const patch of [
      { finalUrl: "https://owned.test/other" },
      { redirectChain: ["https://owned.test/other", owned().url] },
    ]) {
      expect((await run([owned()], async (url) => page(url, patch))).failed[0]?.reason).toBe("redirected");
    }
  });

  it.each([owned("http://owned.test/guide"), { ...competitor(1), url: "http://source1.test/article" }])(
    "rejects HTTPS downgrade on a later hop even when the original URL was HTTP: $role", async (target) => {
      const secure = target.url.replace("http:", "https:");
      const allowed: (boolean | undefined)[] = [];
      const result = await run([target], async (url, options) => {
        allowed.push(options.allowRedirect?.(url, secure), options.allowRedirect?.(secure, url));
        return { kind: "error", code: "cross_origin" };
      });
      expect(allowed).toEqual([true, false]);
      expect(result.observed).toEqual([]);
      expect(result.failed[0]?.reason).toBe(target.role === "owned" ? "redirected" : "provider_error");
    },
  );

  it.each([owned("http://owned.test/guide"), { ...competitor(1), url: "http://source1.test/article" }])(
    "rejects an unsafe intermediate hop even when the final URL looks valid: $role", async (target) => {
      const result = await run([target], async (url) => page(url, {
        redirectChain: [url.replace("http:", "https:"), url],
      }));
      expect(result.observed).toEqual([]);
      expect(result.failed[0]?.reason).toBe(target.role === "owned" ? "redirected" : "provider_error");
    },
  );

  it("uses the real public transport redirect policy before any destination fetch", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 301, headers: { location: "/other" } }));
    const guard = vi.fn(async () => ({ safe: true, normalizedUrl: owned().url, pinnedIp: "8.8.8.8", reason: null }));
    const dependencies: PublicResourceFetchDependencies = {
      fetch, guard, createDispatcher: () => ({ close: async () => undefined }) as never,
    };
    const result = await run([owned()], (url, options) => fetchPublicResource(url, options, dependencies));
    expect(result).toEqual({ observed: [], failed: [{ id: "T1", url: owned().url, reason: "redirected" }] });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledTimes(1);
  });

  it("limits the pool to five and preserves input order despite mixed completion order", async () => {
    vi.useFakeTimers({ now: START });
    let active = 0;
    let peak = 0;
    const targets = [...Array.from({ length: 10 }, (_, i) => competitor(i + 1)), owned()];
    const pending = run(targets, async (url) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, url === competitor(1).url ? 50 : 2));
      active -= 1;
      return url === competitor(3).url ? { kind: "error", code: "network" } : page(url);
    }, "en", DEADLINE, Date.now);
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(peak).toBe(CRAWL_CONCURRENCY);
    expect(result.observed.map((item) => item.id)).toEqual(targets.filter((item) => item.id !== "C3").map((item) => item.id));
    expect(result.failed.map((item) => item.id)).toEqual(["C3"]);
  });

  it("does not start anything without time past the five-second envelope", async () => {
    const fetchResource = vi.fn(success);
    const result = await run([competitor(1), owned()], fetchResource, "en", START + ENVELOPE_MS);
    expect(fetchResource).not.toHaveBeenCalled();
    expect(result.observed).toEqual([]);
    expect(result.failed.map((item) => item.reason)).toEqual(["timeout", "timeout"]);
  });

  it("caps timeout to the remaining overall budget", async () => {
    const fetchResource = vi.fn(success);
    await run([competitor(1)], fetchResource, "en", START + ENVELOPE_MS + 750);
    expect(fetchResource).toHaveBeenCalledWith(competitor(1).url, { timeoutMs: 750, maxBodyBytes: CRAWL_MAX_BYTES_PER_PAGE, allowRedirect: expect.any(Function) });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid deadline %s before fetching", async (deadline) => {
    const fetchResource = vi.fn(success);
    await expect(run([competitor(1)], fetchResource, "en", deadline)).rejects.toThrow(RangeError);
    expect(fetchResource).not.toHaveBeenCalled();
  });

  it("releases a hung teardown at per-fetch timeout plus grace so queued work runs", async () => {
    vi.useFakeTimers({ now: START });
    const targets = Array.from({ length: 6 }, (_, i) => competitor(i + 1));
    const fetchResource = vi.fn((url: string) => Number(/source(\d+)/u.exec(url)?.[1]) <= 5
      ? new Promise<PublicResourceResult>(() => undefined) : Promise.resolve(page(url)));
    const pending = run(targets, fetchResource, "en", DEADLINE, Date.now);
    await vi.advanceTimersByTimeAsync(CRAWL_FETCH_TIMEOUT_MS + CRAWL_TEARDOWN_GRACE_MS - 1);
    expect(fetchResource).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.observed.map((item) => item.id)).toEqual(["C6"]);
    expect(result.failed).toHaveLength(5);
  });

  it.each([750, CRAWL_DEADLINE_MS])("never extends the wall clock by teardown grace with %s ms remaining", async (remaining) => {
    vi.useFakeTimers({ now: START });
    let settled = false;
    const fetchResource = vi.fn(() => new Promise<PublicResourceResult>(() => undefined));
    const targets = Array.from({ length: 10 }, (_, i) => competitor(i + 1));
    const pending = run(targets, fetchResource, "en", START + ENVELOPE_MS + remaining, Date.now).then((result) => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(remaining - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(settled).toBe(true);
    expect(result.observed).toEqual([]);
    expect(result.failed).toHaveLength(10);
  });

  it("discards a result arriving at or after the wall clock and leaves queued pages unstarted", async () => {
    let at = START;
    const fetchResource = vi.fn(async (url: string) => {
      await Promise.resolve();
      at = START + CRAWL_DEADLINE_MS;
      return page(url);
    });
    const result = await run(Array.from({ length: 7 }, (_, i) => competitor(i + 1)), fetchResource, "en", DEADLINE, () => at);
    expect(fetchResource).toHaveBeenCalledTimes(5);
    expect(result.observed).toEqual([]);
    expect(result.failed.map((item) => item.reason)).toEqual(Array(7).fill("timeout"));
  });

  it("also discards evidence when processing the received body consumes the remaining budget", async () => {
    let at = START;
    const result = await run([competitor(1)], async (url) => ({ ...page(url), get body() {
      at = START + CRAWL_DEADLINE_MS;
      return HTML;
    } }), "en", DEADLINE, () => at);
    expect(result.observed).toEqual([]);
    expect(result.failed[0]?.reason).toBe("timeout");
  });

  it.each(["resolve", "reject"])("absorbs late %s after a hung fetch has timed out", async (outcome) => {
    vi.useFakeTimers({ now: START });
    const pending = run([competitor(1)], (url) => new Promise((resolve, reject) => {
      setTimeout(() => outcome === "resolve" ? resolve(page(url)) : reject(new Error("late")), 11_000);
    }), "en", DEADLINE, Date.now);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result.observed).toEqual([]);
    expect(result.failed[0]?.reason).toBe("timeout");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(result.observed).toEqual([]);
  });
});
