import { createHash } from "node:crypto";
import {
  CRAWL_CONCURRENCY,
  CRAWL_DEADLINE_MS,
  CRAWL_EXCERPT_MAX_CHARS,
  CRAWL_EXCERPTS_PER_PAGE_MAX,
  CRAWL_FETCH_TIMEOUT_MS,
  CRAWL_HEADINGS_PER_PAGE_MAX,
  CRAWL_MAX_BYTES_PER_PAGE,
  ENVELOPE_MS,
  HEADING_MAX_CHARS,
} from "@sf/public-tools/content-brief/constants";
import {
  assembleContentBrief,
  buildMustAnswerDraft,
} from "@sf/public-tools/content-brief/assemble";
import { contentBriefFixture } from "@sf/public-tools/content-brief/fixtures";
import {
  parseContentBrief,
  parseContentBriefShape,
} from "@sf/public-tools/content-brief/parse-brief";
import type {
  fetchPublicResource,
  PublicResourceFetchOptions,
  PublicResourceResult,
  PublicResourceSuccess,
} from "@sf/sources/public-http";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CRAWL_TEARDOWN_GRACE_MS,
  crawlContentBriefTargets,
  type CrawlTarget,
} from "./content-brief-crawl.ts";

const START = 1_700_000_000_000;
/** A deadline far enough away that only CRAWL_DEADLINE_MS bounds the crawl. */
const GENEROUS_DEADLINE = START + CRAWL_DEADLINE_MS * 4;

const PAGE_HTML = `<!doctype html>
<html><head><title>Birth chart guide</title><style>h2 { color: red }</style></head>
<body>
<h1>Birth chart guide</h1>
<p>Intro paragraph about birth charts &amp; houses.</p>
<h2>What is a birth chart?</h2>
<p>A birth chart maps the sky at your birth.</p>
<script>window.track("noise")</script>
<h3>Why the time matters</h3>
<p>The ascendant changes every two hours.</p>
<h2>How to read the houses</h2>
<p>Each house governs one area of life.</p>
<h2>Empty heading follows</h2>
<h3></h3>
</body></html>`;

function page(overrides: Partial<PublicResourceSuccess> = {}): PublicResourceSuccess {
  return {
    kind: "ok",
    requestedUrl: "https://a.test/guide",
    finalUrl: "https://a.test/guide",
    firstStatus: 200,
    finalStatus: 200,
    redirectChain: [],
    contentType: "text/html; charset=utf-8",
    xRobotsTag: null,
    body: PAGE_HTML,
    bytes: PAGE_HTML.length,
    bodyComplete: true,
    ...overrides,
  };
}

function target(ordinal: number, host = `site${ordinal}.test`): CrawlTarget {
  return { serp_id: `S${ordinal}`, url: `https://${host}/page-${ordinal}` };
}

function targets(count: number): CrawlTarget[] {
  return Array.from({ length: count }, (_, index) => target(index + 1));
}

type FetchCall = { url: string; options: PublicResourceFetchOptions };

function fetchReturning(
  respond: (url: string) => PublicResourceResult,
): { fetchResource: typeof fetchPublicResource; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchResource = vi.fn(async (url: string, options: PublicResourceFetchOptions = {}) => {
    calls.push({ url, options });
    return respond(url);
  });
  return { fetchResource: fetchResource as never, calls };
}

function fixedClock(at = START): () => number {
  return () => at;
}

function inspectUtf16(value: string): {
  readonly wellFormed: boolean;
  readonly loneHighSurrogates: number[];
  readonly loneLowSurrogates: number[];
} {
  const loneHighSurrogates: number[] = [];
  const loneLowSurrogates: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
      } else {
        loneHighSurrogates.push(index);
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      loneLowSurrogates.push(index);
    }
  }
  return {
    wellFormed: loneHighSurrogates.length === 0 && loneLowSurrogates.length === 0,
    loneHighSurrogates,
    loneLowSurrogates,
  };
}

function expectBoundedAstralString(value: string | undefined, codePoints: number): void {
  expect(value).toBe("😀".repeat(codePoints));
  if (value === undefined) throw new Error("expected a bounded crawl string");
  expect([...value]).toHaveLength(codePoints);
  expect(inspectUtf16(value)).toEqual({
    wellFormed: true,
    loneHighSurrogates: [],
    loneLowSurrogates: [],
  });
}

describe("crawlContentBriefTargets", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("projects a fetched page into an observation with headings, excerpts and a hash", async () => {
    const { fetchResource, calls } = fetchReturning(() => page());

    const result = await crawlContentBriefTargets(
      { targets: [target(3, "a.test")], deadlineAt: GENEROUS_DEADLINE, language: "en" },
      { fetchResource, now: fixedClock() },
    );

    expect(result.failed).toEqual([]);
    expect(result.observed).toHaveLength(1);
    const observation = result.observed[0];
    expect(observation).toMatchObject({
      id: "C3",
      serp_id: "S3",
      url: "https://a.test/page-3",
      final_url: "https://a.test/guide",
      fetched_at: new Date(START).toISOString(),
      body_complete: true,
      h2: ["What is a birth chart?", "How to read the houses", "Empty heading follows"],
      h3: ["Why the time matters"],
    });
    expect(observation?.word_count).toBeGreaterThan(0);
    // Excerpts: document order, split at every h2/h3, script noise stripped,
    // headings with nothing under them dropped.
    expect(observation?.excerpts).toEqual([
      {
        heading: "What is a birth chart?",
        level: "h2",
        text: "A birth chart maps the sky at your birth.",
      },
      {
        heading: "Why the time matters",
        level: "h3",
        text: "The ascendant changes every two hours.",
      },
      {
        heading: "How to read the houses",
        level: "h2",
        text: "Each house governs one area of life.",
      },
    ]);
    expect(observation?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toEqual({
      timeoutMs: CRAWL_FETCH_TIMEOUT_MS,
      maxBodyBytes: CRAWL_MAX_BYTES_PER_PAGE,
    });
  });

  it("hashes the prose text so the same page with different markup hashes alike", async () => {
    const prose = "Alpha beta gamma.";
    const first = fetchReturning(() =>
      page({ body: `<html><body><p>${prose}</p></body></html>` }),
    );
    const second = fetchReturning(() =>
      page({ body: `<html><body><div><span>Alpha</span>  beta\n gamma.</div></body></html>` }),
    );

    const [a, b] = await Promise.all([
      crawlContentBriefTargets(
        { targets: [target(1)], deadlineAt: GENEROUS_DEADLINE, language: "en" },
        { fetchResource: first.fetchResource, now: fixedClock() },
      ),
      crawlContentBriefTargets(
        { targets: [target(1)], deadlineAt: GENEROUS_DEADLINE, language: "en" },
        { fetchResource: second.fetchResource, now: fixedClock() },
      ),
    ]);

    const expected = createHash("sha256").update(prose).digest("hex");
    expect(a.observed[0]?.content_hash).toBe(expected);
    expect(b.observed[0]?.content_hash).toBe(expected);
  });

  it("keeps a truncated page as observed with body_complete false and no word count", async () => {
    const { fetchResource } = fetchReturning(() => page({ bodyComplete: false }));

    const result = await crawlContentBriefTargets(
      { targets: [target(1)], deadlineAt: GENEROUS_DEADLINE, language: "en" },
      { fetchResource, now: fixedClock() },
    );

    expect(result.failed).toEqual([]);
    expect(result.observed[0]).toMatchObject({
      body_complete: false,
      word_count: null,
    });
    expect(result.observed[0]?.h2.length).toBeGreaterThan(0);
    expect(result.observed[0]?.excerpts.length).toBeGreaterThan(0);
  });

  it("gives no word count for a language the counter cannot tokenise", async () => {
    const { fetchResource } = fetchReturning(() => page());

    const result = await crawlContentBriefTargets(
      { targets: [target(1)], deadlineAt: GENEROUS_DEADLINE, language: "zh" },
      { fetchResource, now: fixedClock() },
    );

    expect(result.observed[0]).toMatchObject({ body_complete: true, word_count: null });
  });

  it("maps a fetch timeout to timeout and every other fetch error to provider_error, keeping the code", async () => {
    const codes = {
      "https://site1.test/page-1": "timeout",
      "https://site2.test/page-2": "blocked",
      "https://site3.test/page-3": "network",
      "https://site4.test/page-4": "cross_origin",
    } as const;
    const { fetchResource } = fetchReturning((url) => ({
      kind: "error",
      code: codes[url as keyof typeof codes],
    }));

    const result = await crawlContentBriefTargets(
      { targets: targets(4), deadlineAt: GENEROUS_DEADLINE, language: "en" },
      { fetchResource, now: fixedClock() },
    );

    expect(result.observed).toEqual([]);
    expect(result.failed).toEqual([
      { serp_id: "S1", url: "https://site1.test/page-1", reason: "timeout", code: "timeout" },
      { serp_id: "S2", url: "https://site2.test/page-2", reason: "provider_error", code: "blocked" },
      { serp_id: "S3", url: "https://site3.test/page-3", reason: "provider_error", code: "network" },
      { serp_id: "S4", url: "https://site4.test/page-4", reason: "provider_error", code: "cross_origin" },
    ]);
  });

  it("keeps a 2xx page but fails a non-2xx page as provider_error with the status in code", async () => {
    const statuses: Record<string, number> = {
      "https://site1.test/page-1": 200,
      "https://site2.test/page-2": 404,
      "https://site3.test/page-3": 500,
    };
    const { fetchResource } = fetchReturning((url) =>
      page({ finalStatus: statuses[url] ?? 200, firstStatus: statuses[url] ?? 200 }),
    );

    const result = await crawlContentBriefTargets(
      { targets: targets(3), deadlineAt: GENEROUS_DEADLINE, language: "en" },
      { fetchResource, now: fixedClock() },
    );

    expect(result.observed.map((observation) => observation.id)).toEqual(["C1"]);
    expect(result.failed).toEqual([
      { serp_id: "S2", url: "https://site2.test/page-2", reason: "provider_error", code: "http_404" },
      { serp_id: "S3", url: "https://site3.test/page-3", reason: "provider_error", code: "http_500" },
    ]);
  });

  it("records a non-HTML response as validation_failed with no code, matching the media type exactly", async () => {
    const contentTypes: Record<string, string | null> = {
      "https://site1.test/page-1": "application/pdf",
      "https://site2.test/page-2": null,
      "https://site3.test/page-3": "application/x-not-text/htmlish",
      "https://site4.test/page-4": " Text/HTML ; charset=ISO-8859-1",
      "https://site5.test/page-5": "application/xhtml+xml",
    };
    const { fetchResource } = fetchReturning((url) =>
      page({ contentType: contentTypes[url] ?? null }),
    );

    const result = await crawlContentBriefTargets(
      { targets: targets(5), deadlineAt: GENEROUS_DEADLINE, language: "en" },
      { fetchResource, now: fixedClock() },
    );

    expect(result.observed.map((observation) => observation.id)).toEqual(["C4", "C5"]);
    expect(result.failed).toEqual([
      { serp_id: "S1", url: "https://site1.test/page-1", reason: "validation_failed", code: null },
      { serp_id: "S2", url: "https://site2.test/page-2", reason: "validation_failed", code: null },
      { serp_id: "S3", url: "https://site3.test/page-3", reason: "validation_failed", code: null },
    ]);
  });

  it("keeps only the first CRAWL_HEADINGS_PER_PAGE_MAX headings per level, in document order", async () => {
    const extra = 20;
    const h2s = Array.from(
      { length: CRAWL_HEADINGS_PER_PAGE_MAX + extra },
      (_, index) => `<h2>Heading ${index + 1}</h2><p>Body ${index + 1}</p>`,
    ).join("");
    const { fetchResource } = fetchReturning(() =>
      page({ body: `<html><body><h3>Only h3</h3><p>x</p>${h2s}</body></html>` }),
    );

    const result = await crawlContentBriefTargets(
      { targets: [target(1)], deadlineAt: GENEROUS_DEADLINE, language: "en" },
      { fetchResource, now: fixedClock() },
    );

    const observation = result.observed[0];
    expect(observation?.h2).toHaveLength(CRAWL_HEADINGS_PER_PAGE_MAX);
    expect(observation?.h2[0]).toBe("Heading 1");
    expect(observation?.h2[CRAWL_HEADINGS_PER_PAGE_MAX - 1]).toBe(`Heading ${CRAWL_HEADINGS_PER_PAGE_MAX}`);
    expect(observation?.h3).toEqual(["Only h3"]);
    // The excerpt cap is its own bound and is not widened by the heading cap.
    expect(observation?.excerpts).toHaveLength(CRAWL_EXCERPTS_PER_PAGE_MAX);
  });

  it("records a fetch that throws as provider_error rather than failing the crawl", async () => {
    const fetchResource = vi.fn(async () => {
      throw new Error("dispatcher exploded");
    });

    const result = await crawlContentBriefTargets(
      { targets: [target(1)], deadlineAt: GENEROUS_DEADLINE, language: "en" },
      { fetchResource: fetchResource as never, now: fixedClock() },
    );

    expect(result.failed).toEqual([
      { serp_id: "S1", url: "https://site1.test/page-1", reason: "provider_error", code: null },
    ]);
  });

  it("never has more than CRAWL_CONCURRENCY fetches in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchResource = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return page();
    });
    const count = CRAWL_CONCURRENCY * 2 + 1;

    const result = await crawlContentBriefTargets(
      { targets: targets(count), deadlineAt: GENEROUS_DEADLINE, language: "en" },
      { fetchResource: fetchResource as never, now: fixedClock() },
    );

    expect(peak).toBe(CRAWL_CONCURRENCY);
    expect(fetchResource).toHaveBeenCalledTimes(count);
    expect(result.observed).toHaveLength(count);
    expect(result.observed.map((observation) => observation.id)).toEqual(
      Array.from({ length: count }, (_, index) => `C${index + 1}`),
    );
  });

  it("bounds each fetch by what is left of the run deadline, less the envelope", async () => {
    const remaining = CRAWL_FETCH_TIMEOUT_MS - 1_000;
    const { fetchResource, calls } = fetchReturning(() => page());

    await crawlContentBriefTargets(
      { targets: [target(1)], deadlineAt: START + ENVELOPE_MS + remaining, language: "en" },
      { fetchResource, now: fixedClock() },
    );

    expect(calls[0]?.options.timeoutMs).toBe(remaining);
  });

  it("bounds each fetch by the crawl wall clock as well as its own cap", async () => {
    let at = START;
    const now = (): number => at;
    const { fetchResource, calls } = fetchReturning(() => page());
    // The first fetch moves the clock to 500 ms before the wall clock as it is
    // issued, so the second worker computes its timeout against what is left.
    const advanceThenFetch = vi.fn((url: string, options: PublicResourceFetchOptions) => {
      at = START + CRAWL_DEADLINE_MS - 500;
      return fetchResource(url, options);
    });

    await crawlContentBriefTargets(
      { targets: targets(2), deadlineAt: GENEROUS_DEADLINE, language: "en" },
      { fetchResource: advanceThenFetch as never, now },
    );

    expect(calls.map((call) => call.options.timeoutMs)).toEqual([CRAWL_FETCH_TIMEOUT_MS, 500]);
  });

  it("releases a worker slot once a fetch outlives its timeout plus the teardown grace", async () => {
    vi.useFakeTimers({ now: START });
    const fetchResource = vi.fn(() => new Promise<PublicResourceResult>(() => undefined));
    const limitMs = CRAWL_FETCH_TIMEOUT_MS + CRAWL_TEARDOWN_GRACE_MS;
    let settled = false;

    const pending = crawlContentBriefTargets(
      { targets: [target(1)], deadlineAt: GENEROUS_DEADLINE, language: "en" },
      { fetchResource: fetchResource as never, now: fixedClock() },
    ).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(limitMs - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(settled).toBe(true);
    expect(Date.now() - START).toBeLessThan(limitMs + 500);
    expect(fetchResource).toHaveBeenCalledTimes(1);
    expect(result.observed).toEqual([]);
    expect(result.failed).toEqual([
      { serp_id: "S1", url: "https://site1.test/page-1", reason: "timeout", code: null },
    ]);
  });

  it("frees the slot for the next URL when one fetch hangs, so the pool keeps moving", async () => {
    vi.useFakeTimers({ now: START });
    const fetchResource = vi.fn((url: string) =>
      url.endsWith("page-1")
        ? new Promise<PublicResourceResult>(() => undefined)
        : Promise.resolve(page()),
    );
    const count = CRAWL_CONCURRENCY + 1;

    const pending = crawlContentBriefTargets(
      { targets: targets(count), deadlineAt: GENEROUS_DEADLINE, language: "en" },
      { fetchResource: fetchResource as never, now: fixedClock() },
    );
    await vi.advanceTimersByTimeAsync(CRAWL_FETCH_TIMEOUT_MS + CRAWL_TEARDOWN_GRACE_MS);
    const result = await pending;

    expect(fetchResource).toHaveBeenCalledTimes(count);
    expect(result.observed).toHaveLength(count - 1);
    expect(result.failed.map((failure) => failure.serp_id)).toEqual(["S1"]);
  });

  it("does not start a URL once the wall clock has passed and records it as timeout", async () => {
    let at = START;
    const now = (): number => at;
    const fetchResource = vi.fn(async () => {
      // Yield so the whole first wave is issued at START; it then completes
      // only after the wall clock is gone.
      await Promise.resolve();
      at = START + CRAWL_DEADLINE_MS + 1;
      return page();
    });
    const count = CRAWL_CONCURRENCY + 2;

    const result = await crawlContentBriefTargets(
      { targets: targets(count), deadlineAt: GENEROUS_DEADLINE, language: "en" },
      { fetchResource: fetchResource as never, now },
    );

    expect(fetchResource).toHaveBeenCalledTimes(CRAWL_CONCURRENCY);
    expect(result.observed).toHaveLength(CRAWL_CONCURRENCY);
    expect(result.failed).toEqual([
      {
        serp_id: `S${CRAWL_CONCURRENCY + 1}`,
        url: `https://site${CRAWL_CONCURRENCY + 1}.test/page-${CRAWL_CONCURRENCY + 1}`,
        reason: "timeout",
        code: null,
      },
      {
        serp_id: `S${CRAWL_CONCURRENCY + 2}`,
        url: `https://site${CRAWL_CONCURRENCY + 2}.test/page-${CRAWL_CONCURRENCY + 2}`,
        reason: "timeout",
        code: null,
      },
    ]);
  });

  it("starts nothing when the run deadline already leaves no room past the envelope", async () => {
    const { fetchResource, calls } = fetchReturning(() => page());

    const result = await crawlContentBriefTargets(
      { targets: targets(2), deadlineAt: START + ENVELOPE_MS, language: "en" },
      { fetchResource, now: fixedClock() },
    );

    expect(calls).toEqual([]);
    expect(result.observed).toEqual([]);
    expect(result.failed.map((failure) => failure.reason)).toEqual(["timeout", "timeout"]);
  });

  it("caps excerpts per page and bounds each heading and excerpt by characters", async () => {
    const longHeading = "H".repeat(HEADING_MAX_CHARS + 40);
    const longText = "word ".repeat(CRAWL_EXCERPT_MAX_CHARS).trim();
    const sections = Array.from(
      { length: CRAWL_EXCERPTS_PER_PAGE_MAX + 3 },
      (_, index) => `<h2>${index === 0 ? longHeading : `Section ${index}`}</h2><p>${longText}</p>`,
    ).join("");
    const { fetchResource } = fetchReturning(() =>
      page({ body: `<html><body>${sections}</body></html>` }),
    );

    const result = await crawlContentBriefTargets(
      { targets: [target(1)], deadlineAt: GENEROUS_DEADLINE, language: "en" },
      { fetchResource, now: fixedClock() },
    );

    const observation = result.observed[0];
    expect(observation?.excerpts).toHaveLength(CRAWL_EXCERPTS_PER_PAGE_MAX);
    expect(observation?.excerpts[0]?.heading).toHaveLength(HEADING_MAX_CHARS);
    expect(observation?.h2[0]).toHaveLength(HEADING_MAX_CHARS);
    for (const excerpt of observation?.excerpts ?? []) {
      expect(excerpt.text.length).toBeLessThanOrEqual(CRAWL_EXCERPT_MAX_CHARS);
    }
    expect(observation?.excerpts.map((excerpt) => excerpt.heading).slice(1, 3)).toEqual([
      "Section 1",
      "Section 2",
    ]);
  });

  it("bounds well-formed astral crawl strings and round-trips every emitted field through the parser", async () => {
    const heading = "😀".repeat(HEADING_MAX_CHARS + 1);
    const prose = "😀".repeat(CRAWL_EXCERPT_MAX_CHARS + 1);
    const fixture = contentBriefFixture({ llm: "validation_failed" });
    const firstSerp = fixture.evidence.serp[0];
    const firstUrl = firstSerp?.url;
    if (firstUrl === null || firstUrl === undefined) {
      throw new Error("expected fixture S1 to have a URL");
    }
    const { fetchResource } = fetchReturning(() =>
      page({
        requestedUrl: firstUrl,
        finalUrl: firstUrl,
        body: `<html><body><h2>${heading}</h2><p>${prose}</p><h3>${heading}</h3><p>${prose}</p></body></html>`,
      }),
    );

    const result = await crawlContentBriefTargets(
      {
        targets: [{ serp_id: firstSerp.id, url: firstUrl }],
        deadlineAt: GENEROUS_DEADLINE,
        language: fixture.keyword.language,
      },
      { fetchResource, now: fixedClock() },
    );

    const observation = result.observed[0];
    const excerpt = observation?.excerpts[0];
    expectBoundedAstralString(observation?.h2[0], HEADING_MAX_CHARS);
    expectBoundedAstralString(observation?.h3[0], HEADING_MAX_CHARS);
    expectBoundedAstralString(excerpt?.heading, HEADING_MAX_CHARS);
    expectBoundedAstralString(excerpt?.text, CRAWL_EXCERPT_MAX_CHARS);

    if (observation === undefined) throw new Error("expected one crawl observation");
    const observed = [observation, ...fixture.evidence.crawl.observed.slice(1)];
    const brief = await assembleContentBrief({
      run: fixture.run,
      keyword: fixture.keyword,
      reads: fixture.run.reads,
      serp: fixture.evidence.serp,
      crawl: {
        observed,
        failed: fixture.evidence.crawl.failed,
        skipped: fixture.evidence.crawl.skipped,
      },
      profileFacts: fixture.evidence.profile?.facts ?? null,
      gscQueryPage: fixture.evidence.gsc_query_page,
      gscPages: fixture.evidence.gsc_pages,
      verdict: fixture.verdict,
      mustAnswer: buildMustAnswerDraft({
        serp: fixture.evidence.serp,
        observed,
        crawlReads: fixture.run.reads.crawl,
        language: fixture.keyword.language,
      }),
      model: { output: null },
    });
    expect(parseContentBriefShape(brief)).toMatchObject({ ok: true });
    await expect(parseContentBrief(brief)).resolves.toMatchObject({ ok: true });
  });

  it("refuses a target whose serp_id is not S<n> before fetching anything", async () => {
    const { fetchResource, calls } = fetchReturning(() => page());

    await expect(
      crawlContentBriefTargets(
        {
          targets: [target(1), { serp_id: "X2", url: "https://a.test/" }],
          deadlineAt: GENEROUS_DEADLINE,
          language: "en",
        },
        { fetchResource, now: fixedClock() },
      ),
    ).rejects.toBeInstanceOf(RangeError);
    expect(calls).toEqual([]);
  });
});
