// @input  -- fake reads, quotas, grants and identities driving the brief handler
// @output -- proof of admission order, deadlines, the GSC lane, degradation and the self-checked envelope
// @pos    -- the brief handler's unit tests
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it, vi } from "vitest";

import {
  BRIEF_ACCOUNT_MAX_PER_HOUR,
  BRIEF_DAILY_MAX,
  BRIEF_IP_MAX_PER_HOUR,
  RUN_BUDGET_MS,
  SUPPORTING_KEYWORDS_MAX,
} from "@sf/public-tools/content-brief/constants";
import type { ContentBrief, CrawlObservation } from "@sf/public-tools/content-brief/contract";
import { parseContentBrief } from "@sf/public-tools/content-brief/parse-brief";
import { CONTENT_BRIEF_V2_SCHEMA } from "@sf/public-tools/content-brief/v2-contract";
import { parseContentBriefV2 } from "@sf/public-tools/content-brief/v2-brief";

import type { MarketingWebsiteProfileV1 } from "../account-websites/contracts.ts";
import type { ContentBriefCrawlResult } from "./content-brief-crawl.ts";
import {
  handleContentBriefRequest,
  parseContentBriefRequest,
  profileFacts,
  type ContentBriefHandlerDependencies,
  type GscDimensionsRead,
  type ProfileReadResult,
} from "./content-brief-handler.ts";
import type { ContentBriefLlmResult } from "./content-brief-llm.ts";
import type { ContentBriefSerpResult } from "./content-brief-serp.ts";

/* ------------------------------------------------------------------ */
/* fixtures                                                             */
/* ------------------------------------------------------------------ */

const PROPERTY = "sc-domain:site.example";

function request(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://example.test/api/tools/content-brief/run", {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: JSON.stringify(body),
    ...init,
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return { primary: "brew coffee", supporting: ["pour over"], market: "US", language: "en", ...overrides };
}

function confirmedProfile(): MarketingWebsiteProfileV1 {
  return {
    schemaVersion: "marketing-website-profile.v1",
    productName: "Brewly",
    oneLinePositioning: "Coffee workflow software for cafes",
    valueProposition: "",
    coreFeatures: ["Roast tracking"],
    categories: [],
    businessModel: "",
    primaryCta: "",
    trustSignals: [],
    primaryIcp: "",
    buyer: "",
    user: "",
    triggerPain: "",
    icpInterests: [],
    icpPain: "",
    icpBehavior: "",
    icpPositioning: "",
    jtbd: "",
    useCases: [],
    outcomes: [],
    barriers: [],
    qualificationSignals: [],
    disqualifiers: [],
    directCompetitors: [],
    indirectAlternatives: [],
    excludedAlternatives: [],
    firstOutcome: "",
    country: "US",
    locale: "en",
    fieldProvenance: [
      {
        path: "/productName",
        derivation: "declared",
        confidence: "high",
        source: "supplied_product_information",
        limitation: null,
        observedAt: null,
        evidenceUrls: [],
      },
      {
        path: "/oneLinePositioning",
        derivation: "observed",
        confidence: "medium",
        source: "public_page",
        limitation: null,
        observedAt: "2026-08-31T00:00:00.000Z",
        evidenceUrls: ["https://owned.test/about"],
      },
      {
        path: "/coreFeatures",
        derivation: "observed",
        confidence: "medium",
        source: "public_page",
        limitation: null,
        observedAt: "2026-08-31T00:00:00.000Z",
        evidenceUrls: ["https://owned.test/features"],
      },
    ],
  };
}

function serpResult(returned = 10): ContentBriefSerpResult {
  return {
    rows: Array.from({ length: returned }, (_, index) => ({
      rank: index + 1,
      url: `https://site${index + 1}.example/blog/coffee-${index + 1}`,
      domain: `site${index + 1}.example`,
      title: `How to brew coffee ${index + 1}`,
    })),
    reads:
      returned === 0
        ? { status: "unavailable", reason: "insufficient_evidence", attempted: 10 }
        : { status: returned === 10 ? "complete" : "partial", requested: 10, returned, unresolved: 0 },
    costUsd: 0.002,
    itemTypes: null,
  };
}

function observation(id: number, serpId: number = id): CrawlObservation {
  return {
    id: `C${id}`,
    serp_id: `S${serpId}`,
    url: `https://site${serpId}.example/blog/coffee-${serpId}`,
    final_url: `https://site${serpId}.example/blog/coffee-${serpId}`,
    fetched_at: "2026-08-29T00:00:00.000Z",
    body_complete: true,
    word_count: 1000 + id,
    h2: ["What is pour over coffee", "How much coffee per cup", "Water temperature"],
    h3: [],
    excerpts: [{ heading: "What is pour over coffee", level: "h2", text: "Pour over is manual." }],
    content_hash: `hash-${id}`,
  };
}

function crawlResult(count = 6, targets = 10): ContentBriefCrawlResult {
  return {
    observed: Array.from({ length: count }, (_, index) => observation(index + 1)),
    failed: Array.from({ length: Math.max(0, targets - count) }, (_, index) => ({
      serp_id: `S${count + index + 1}`,
      url: `https://site${count + index + 1}.example/blog/coffee-${count + index + 1}`,
      reason: "timeout" as const,
      code: null,
    })),
  };
}

function llmResult(): ContentBriefLlmResult {
  return {
    output: null,
    reads: {
      status: "unavailable",
      reason: "not_configured",
      attempted: 0,
      calls: 0,
      model_id: null,
      input_tokens: null,
      output_tokens: null,
    },
    derived_from: ["crawl", "user_input"],
  };
}

function gscRead(overrides: Partial<GscDimensionsRead> = {}): GscDimensionsRead {
  const paging = { pagesFetched: 1, truncated: false };
  return {
    query: {
      rows: [{ query: "brew coffee", clicks: 4, impressions: 80, position: 12 }],
      paging,
      responseAggregationType: "byPage",
      unreadableRows: 0,
    },
    queryPage: {
      rows: [{ query: "brew coffee", page: "https://site.example/coffee", clicks: 4, impressions: 80, position: 12 }],
      paging,
      unreadableRows: 0,
    },
    page: {
      rows: [
        { page: "https://site.example/coffee", clicks: 4, impressions: 80, position: 12 },
        { page: "https://site.example/grinders", clicks: 1, impressions: 20, position: 30 },
      ],
      paging,
      unreadableRows: 0,
    },
    ...overrides,
  };
}

type Deps = ContentBriefHandlerDependencies & { readonly lines: string[] };

function dependencies(overrides: Partial<ContentBriefHandlerDependencies> = {}): Deps {
  const lines: string[] = [];
  let clock = 1_000_000;
  const base: ContentBriefHandlerDependencies = {
    getServerAuthenticatedUser: async () => ({
      status: "authenticated",
      userId: "user-1",
      email: null,
      avatarUrl: null,
      googleSubject: "google-sub-1",
    }),
    readJson: async (req) => ({ ok: true, value: await req.json() }),
    extractClientIp: () => "203.0.113.9",
    acquireSlot: () => ({ acquired: true, release: () => undefined }),
    consumeQuota: async () => ({ kind: "allowed", hits: 1 }),
    readGscSession: async () => ({ properties: [PROPERTY] }) as unknown as Awaited<ReturnType<ContentBriefHandlerDependencies["readGscSession"]>>,
    readGscIdentity: async () => ({ sub: "google-sub-1" }),
    openGscGate: async () => ({ ok: true, release: () => undefined }),
    resolveGscGrant: async () => ({ kind: "grant", accessToken: "token", properties: [PROPERTY], propertyTotal: 1 }),
    readGscDimensions: async () => gscRead(),
    readSerp: async () => serpResult(),
    crawl: async () => crawlResult(),
    crawlV2: async () => { throw new Error("unexpected v2 crawl in legacy fixture"); },
    readWebsite: async (): Promise<ProfileReadResult> => ({ kind: "missing" }),
    runLlm: async () => llmResult(),
    runLlmV2: async () => { throw new Error("unexpected v2 model in legacy fixture"); },
    now: () => {
      clock += 100;
      return clock;
    },
    runId: () => "run-fixed",
    emit: (line) => {
      lines.push(line);
    },
  };
  return { ...base, ...overrides, lines };
}

/** Offline source seams; the real v2 run and exact envelope parser remain in the test. */
function v2Dependencies(overrides: Partial<ContentBriefHandlerDependencies> = {}): Deps {
  return dependencies({
    readSerp: async () => ({ ...serpResult(), peopleAlsoAsk: { status: "complete", items: [], unreadableItems: 0, unreadableBlocks: 0, truncatedItems: 0 } }),
    crawlV2: async ({ targets }) => ({
      observed: targets.map((target) => ({
        ...target, final_url: target.url, fetched_at: "2026-08-31T00:00:00.000Z", content_hash: "b".repeat(64), body_complete: true,
        research: {
          segments: [{ heading: null, text: "Coffee brewing needs a stable ratio.", truncated: false }],
          segments_total: 1, omitted_segments: 0, length: { value: 6, unit: "words", tokenizer: "whitespace" },
        },
      })),
      failed: [],
    }),
    runLlmV2: async ({ context }) => ({
      context,
      output: {
        research: { questions: [], outline: [] }, intent: null, format: null,
        page_plan: { action: "undecidable", rationale: "The sampled evidence does not resolve a page action.", target_ref: null, steps: [] },
        gap_angle: null, internal_links: [], do_not_cover: [],
      },
      reads: { status: "complete", calls: 1, model_id: "fixture-model", temperature_requested: 0.2, temperature_effective: 1, input_tokens: 123, output_tokens: 45 },
      prompt_bytes: 2048,
    }),
    ...overrides,
  });
}

function v2Body(overrides: Record<string, unknown> = {}) {
  return validBody({ response_schema: CONTENT_BRIEF_V2_SCHEMA, ...overrides });
}

async function briefOf(response: Response): Promise<ContentBrief> {
  expect(response.status).toBe(200);
  const brief = (await response.json()) as ContentBrief;
  // Every brief the handler emits must survive the draft side's exact parser,
  // fingerprint included; anything else is an assembly/parser disagreement.
  const parsed = await parseContentBrief(brief);
  expect(parsed).toMatchObject({ ok: true });
  return brief;
}

async function briefV2Of(response: Response) {
  expect(response.status).toBe(200);
  const brief = await response.json();
  const parsed = await parseContentBriefV2(brief);
  expect(parsed).toMatchObject({ ok: true });
  if (!parsed.ok) throw new Error("expected a v2 brief");
  return parsed.value;
}

function lastRunLine(deps: Deps): Record<string, unknown> {
  const line = deps.lines.map((entry) => JSON.parse(entry) as Record<string, unknown>).find((entry) => "mode" in entry);
  if (line === undefined) throw new Error("no run log line emitted");
  return line;
}

/* ------------------------------------------------------------------ */
/* request parsing                                                      */
/* ------------------------------------------------------------------ */

describe("parseContentBriefRequest", () => {
  it.each([9, 10])("carries %i supporting terms through the v2 handler's actual self-check", async (count) => {
    const supporting = Array.from({ length: count }, (_, index) => "support " + index);
    const result = await briefV2Of(await handleContentBriefRequest(request(v2Body({ supporting })), v2Dependencies()));
    expect(result.context.input.supporting).toEqual(supporting);
  });
  it("normalises keywords and dedupes supporting terms", () => {
    const parsed = parseContentBriefRequest(validBody({ primary: "  Brew   coffee ", supporting: ["a", " a ", "b"] }));
    expect(parsed).toEqual({
      ok: true,
      value: { primary: "Brew coffee", supporting: ["a", "b"], market: "US", language: "en", website_id: null, gsc_property: null, response_schema: "gengrowth.content_brief/v1" },
    });
  });

  it("accepts an explicit v2 response schema but defaults to v1", () => {
    expect(parseContentBriefRequest(validBody())).toMatchObject({
      ok: true,
      value: { response_schema: "gengrowth.content_brief/v1" },
    });
    expect(parseContentBriefRequest(validBody({ response_schema: CONTENT_BRIEF_V2_SCHEMA }))).toMatchObject({
      ok: true,
      value: { response_schema: CONTENT_BRIEF_V2_SCHEMA },
    });
  });

  it("deduplicates v2 supporting identities and excludes the primary before applying the cap", () => {
    const supporting = ["Brew coffee", "Ｂｒｅｗ ｃｏｆｆｅｅ", " Pour   Over ", "pour over", "Ｐｏｕｒ Ｏｖｅｒ", ...Array.from({ length: 7 }, (_, index) => `side ${index}`)];
    expect(parseContentBriefRequest(v2Body({ supporting }))).toMatchObject({
      ok: true, value: { primary: "brew coffee", supporting: ["Pour Over", ...Array.from({ length: 7 }, (_, index) => `side ${index}`)] },
    });
  });

  it("preserves v1 supporting normalization for both default and explicit legacy callers", () => {
    const supporting = ["brew coffee", "Brew coffee", "Pour Over", "pour over"];
    for (const body of [validBody({ supporting }), validBody({ supporting, response_schema: "gengrowth.content_brief/v1" })]) {
      expect(parseContentBriefRequest(body)).toMatchObject({ ok: true, value: { supporting } });
    }
  });

  it("refuses too many supporting keywords with its own code", () => {
    const supporting = Array.from({ length: SUPPORTING_KEYWORDS_MAX + 1 }, (_, i) => `k${i}`);
    expect(parseContentBriefRequest(validBody({ supporting }))).toEqual({ ok: false, code: "too_many_supporting_keywords" });
  });

  it("refuses unknown markets, languages, keys and blank optionals", () => {
    expect(parseContentBriefRequest(validBody({ market: "XX" }))).toEqual({ ok: false, code: "unsupported_market" });
    expect(parseContentBriefRequest(validBody({ language: "xx" }))).toEqual({ ok: false, code: "unsupported_language" });
    expect(parseContentBriefRequest(validBody({ response_schema: "gengrowth.content_brief/v3" }))).toEqual({ ok: false, code: "invalid_request" });
    expect(parseContentBriefRequest(validBody({ extra: 1 }))).toEqual({ ok: false, code: "invalid_request" });
    expect(parseContentBriefRequest(validBody({ gsc_property: "  " }))).toEqual({ ok: false, code: "invalid_request" });
  });
});

/* ------------------------------------------------------------------ */
/* admission                                                            */
/* ------------------------------------------------------------------ */

describe("handleContentBriefRequest admission", () => {
  it("refuses anonymous callers before reading the body or spending anything", async () => {
    const readSerp = vi.fn<ContentBriefHandlerDependencies["readSerp"]>(async () => serpResult());
    const deps = dependencies({ getServerAuthenticatedUser: async () => ({ status: "unauthenticated" }), readSerp });
    const response = await handleContentBriefRequest(request(validBody()), deps);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: "auth_required" } });
    expect(readSerp).not.toHaveBeenCalled();
  });

  it("turns a hung identity provider into 503 instead of waiting for the platform kill", async () => {
    vi.useFakeTimers();
    try {
      const deps = dependencies({
        getServerAuthenticatedUser: () => new Promise(() => undefined),
        now: () => Date.now(),
      });
      const pending = handleContentBriefRequest(request(validBody()), deps);
      await vi.advanceTimersByTimeAsync(6_000);
      const response = await pending;
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: { code: "auth_unavailable" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("consumes account then ip buckets and refuses on the first limit, before any daily spend", async () => {
    const consumeQuota = vi.fn<ContentBriefHandlerDependencies["consumeQuota"]>(async (key) =>
      key.includes(":ip:") ? { kind: "limited", retryAfterSeconds: 42 } : { kind: "allowed", hits: 1 },
    );
    const readSerp = vi.fn<ContentBriefHandlerDependencies["readSerp"]>(async () => serpResult());
    const response = await handleContentBriefRequest(request(validBody()), dependencies({ consumeQuota, readSerp }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(consumeQuota.mock.calls.map((call) => call[0])).toEqual([
      "public-content-brief:account:user-1",
      "public-content-brief:ip:203.0.113.9",
    ]);
    expect(consumeQuota.mock.calls[0]?.[1]).toBe(BRIEF_ACCOUNT_MAX_PER_HOUR);
    expect(readSerp).not.toHaveBeenCalled();
  });

  it("spends the SERP daily bucket last, with the daily cap", async () => {
    const consumeQuota = vi.fn<ContentBriefHandlerDependencies["consumeQuota"]>(async () => ({ kind: "allowed", hits: 1 }));
    await handleContentBriefRequest(request(validBody()), dependencies({ consumeQuota }));
    const daily = consumeQuota.mock.calls[2];
    expect(daily?.[0]).toMatch(/^public-content-brief:daily:\d{4}-\d{2}-\d{2}$/u);
    expect(daily?.[1]).toBe(BRIEF_DAILY_MAX);
    expect(consumeQuota.mock.calls[1]?.[1]).toBe(BRIEF_IP_MAX_PER_HOUR);
  });

  it("does not spend the daily bucket on a refused Search Console preflight", async () => {
    const consumeQuota = vi.fn<ContentBriefHandlerDependencies["consumeQuota"]>(async () => ({ kind: "allowed", hits: 1 }));
    const response = await handleContentBriefRequest(
      request(validBody({ gsc_property: "sc-domain:other.example" })),
      dependencies({ consumeQuota }),
    );
    expect(response.status).toBe(403);
    expect(consumeQuota.mock.calls.map((call) => call[0])).toEqual([
      "public-content-brief:account:user-1",
      "public-content-brief:ip:203.0.113.9",
    ]);
  });

  it.each(["gengrowth.content_brief/v1", CONTENT_BRIEF_V2_SCHEMA])("fails closed when the quota store is unavailable (%s)", async (response_schema) => {
    const response = await handleContentBriefRequest(
      request(validBody({ response_schema })),
      dependencies({ consumeQuota: async () => ({ kind: "unavailable", reason: "store_down" }) }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: { code: "quota_unavailable" } });
  });

  it("answers a concurrent run for the same account with 409", async () => {
    const response = await handleContentBriefRequest(request(validBody()), dependencies({ acquireSlot: () => ({ acquired: false }) }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "scan_in_progress" } });
  });
});

/* ------------------------------------------------------------------ */
/* GSC preflight                                                        */
/* ------------------------------------------------------------------ */

describe("handleContentBriefRequest GSC preflight", () => {
  it.each(["gengrowth.content_brief/v1", CONTENT_BRIEF_V2_SCHEMA])("refuses a property the visitor never granted, before any paid call (%s)", async (response_schema) => {
    const readSerp = vi.fn<ContentBriefHandlerDependencies["readSerp"]>(async () => serpResult());
    const response = await handleContentBriefRequest(
      request(validBody({ gsc_property: "sc-domain:other.example", response_schema })),
      dependencies({ readSerp }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: { code: "property_not_granted" } });
    expect(readSerp).not.toHaveBeenCalled();
  });

  it("consumes the shared GSC gate once and releases it after the run", async () => {
    const release = vi.fn();
    const openGscGate = vi.fn<ContentBriefHandlerDependencies["openGscGate"]>(async () => ({ ok: true, release }));
    await briefOf(await handleContentBriefRequest(request(validBody({ gsc_property: PROPERTY })), dependencies({ openGscGate })));
    expect(openGscGate).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("tells a gone grant and a temporary refresh failure apart", async () => {
    const revoked = await handleContentBriefRequest(
      request(validBody({ gsc_property: PROPERTY })),
      dependencies({ resolveGscGrant: async () => ({ kind: "none" }) }),
    );
    expect(revoked.status).toBe(401);
    await expect(revoked.json()).resolves.toEqual({ error: { code: "gsc_revoked" } });

    const unavailable = await handleContentBriefRequest(
      request(validBody({ gsc_property: PROPERTY })),
      dependencies({ resolveGscGrant: async () => ({ kind: "unavailable" }) }),
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("Retry-After")).not.toBeNull();
    await expect(unavailable.json()).resolves.toEqual({ error: { code: "gsc_temporarily_unavailable" } });
  });

  it("refuses to combine one account's profile with another identity's Search Console", async () => {
    const readGscDimensions = vi.fn<ContentBriefHandlerDependencies["readGscDimensions"]>(async () => gscRead());
    const response = await handleContentBriefRequest(
      request(validBody({ gsc_property: PROPERTY })),
      dependencies({ readGscIdentity: async () => ({ sub: "someone-else" }), readGscDimensions }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: "gsc_auth_required" } });
    expect(readGscDimensions).not.toHaveBeenCalled();

    const noSubject = await handleContentBriefRequest(
      request(validBody({ gsc_property: PROPERTY })),
      dependencies({
        getServerAuthenticatedUser: async () => ({ status: "authenticated", userId: "user-1", email: null, avatarUrl: null }),
      }),
    );
    expect(noSubject.status).toBe(401);
  });

  it.each(["gengrowth.content_brief/v1", CONTENT_BRIEF_V2_SCHEMA])("releases a gate that was acquired after its budget ran out (%s)", async (response_schema) => {
    vi.useFakeTimers();
    try {
      const release = vi.fn();
      let resolveGate: (value: Awaited<ReturnType<ContentBriefHandlerDependencies["openGscGate"]>>) => void = () => undefined;
      const deps = dependencies({
        now: () => Date.now(),
        openGscGate: () => new Promise((resolve) => {
          resolveGate = resolve;
        }),
      });
      const pending = handleContentBriefRequest(request(validBody({ gsc_property: PROPERTY, response_schema })), deps);
      await vi.advanceTimersByTimeAsync(6_000);
      const response = await pending;
      expect(response.status).toBe(503);
      resolveGate({ ok: true, release });
      await vi.advanceTimersByTimeAsync(0);
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never touches the gate or grant when no property was chosen", async () => {
    const openGscGate = vi.fn<ContentBriefHandlerDependencies["openGscGate"]>(async () => ({ ok: true, release: () => undefined }));
    const readGscDimensions = vi.fn<ContentBriefHandlerDependencies["readGscDimensions"]>(async () => gscRead());
    await briefOf(await handleContentBriefRequest(request(validBody()), dependencies({ openGscGate, readGscDimensions })));
    expect(openGscGate).not.toHaveBeenCalled();
    expect(readGscDimensions).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* run                                                                  */
/* ------------------------------------------------------------------ */

describe("handleContentBriefRequest v2 admission and evidence", () => {
  it("normalizes duplicate supporting identities before quotas and returns a usable v2 envelope", async () => {
    const consumeQuota = vi.fn<ContentBriefHandlerDependencies["consumeQuota"]>(async () => ({ kind: "allowed", hits: 1 }));
    const brief = await briefV2Of(await handleContentBriefRequest(
      request(v2Body({ supporting: ["BREW coffee", "Ｐｏｕｒ Ｏｖｅｒ", "pour over"] })), v2Dependencies({ consumeQuota }),
    ));
    expect(brief.context.input.supporting).toEqual(["Ｐｏｕｒ Ｏｖｅｒ"]);
    expect(consumeQuota).toHaveBeenCalledTimes(3);
  });

  it.each([null, 2, "", "gengrowth.content_brief/v3"])("refuses unsupported schema %j before taking slots or quotas", async (response_schema) => {
    const acquireSlot = vi.fn<ContentBriefHandlerDependencies["acquireSlot"]>(() => ({ acquired: false }));
    const consumeQuota = vi.fn<ContentBriefHandlerDependencies["consumeQuota"]>();
    const readSerp = vi.fn<ContentBriefHandlerDependencies["readSerp"]>();
    const response = await handleContentBriefRequest(request(v2Body({ response_schema })), v2Dependencies({ acquireSlot, consumeQuota, readSerp }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_request" } });
    expect(acquireSlot).not.toHaveBeenCalled();
    expect(consumeQuota).not.toHaveBeenCalled();
    expect(readSerp).not.toHaveBeenCalled();
  });

  it("keeps v2 anonymous callers outside body reads, slots and paid work", async () => {
    const readJson = vi.fn<ContentBriefHandlerDependencies["readJson"]>();
    const acquireSlot = vi.fn<ContentBriefHandlerDependencies["acquireSlot"]>();
    const readSerp = vi.fn<ContentBriefHandlerDependencies["readSerp"]>();
    const response = await handleContentBriefRequest(request(v2Body()), v2Dependencies({
      getServerAuthenticatedUser: async () => ({ status: "unauthenticated" }), readJson, acquireSlot, readSerp,
    }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: "auth_required" } });
    expect(readJson).not.toHaveBeenCalled();
    expect(acquireSlot).not.toHaveBeenCalled();
    expect(readSerp).not.toHaveBeenCalled();
  });

  it("refuses a concurrent v2 account run before quotas", async () => {
    const consumeQuota = vi.fn<ContentBriefHandlerDependencies["consumeQuota"]>();
    const response = await handleContentBriefRequest(request(v2Body()), v2Dependencies({ acquireSlot: () => ({ acquired: false }), consumeQuota }));
    expect(response.status).toBe(409);
    expect(consumeQuota).not.toHaveBeenCalled();
  });

  it.each(["account", "ip", "daily"])("releases v2 admission resources when the %s quota refuses", async (bucket) => {
    const slotRelease = vi.fn();
    const gateRelease = vi.fn();
    const readSerp = vi.fn<ContentBriefHandlerDependencies["readSerp"]>();
    const readWebsite = vi.fn<ContentBriefHandlerDependencies["readWebsite"]>();
    const consumeQuota = vi.fn<ContentBriefHandlerDependencies["consumeQuota"]>(async (key) => key.includes(`:${bucket}:`)
      ? { kind: "limited", retryAfterSeconds: 42 } : { kind: "allowed", hits: 1 });
    const response = await handleContentBriefRequest(request(v2Body({ gsc_property: PROPERTY, website_id: "w-1" })), v2Dependencies({
      acquireSlot: () => ({ acquired: true, release: slotRelease }),
      openGscGate: async () => ({ ok: true, release: gateRelease }), consumeQuota, readSerp, readWebsite,
    }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(slotRelease).toHaveBeenCalledTimes(1);
    expect(gateRelease).toHaveBeenCalledTimes(bucket === "daily" ? 1 : 0);
    expect(readSerp).not.toHaveBeenCalled();
    expect(readWebsite).not.toHaveBeenCalled();
  });

  it("refuses cross-subject v2 GSC before private profile reads or the paid daily quota", async () => {
    const slotRelease = vi.fn();
    const openGscGate = vi.fn<ContentBriefHandlerDependencies["openGscGate"]>();
    const readWebsite = vi.fn<ContentBriefHandlerDependencies["readWebsite"]>();
    const readSerp = vi.fn<ContentBriefHandlerDependencies["readSerp"]>();
    const consumeQuota = vi.fn<ContentBriefHandlerDependencies["consumeQuota"]>(async () => ({ kind: "allowed", hits: 1 }));
    const response = await handleContentBriefRequest(request(v2Body({ gsc_property: PROPERTY, website_id: "w-1" })), v2Dependencies({
      acquireSlot: () => ({ acquired: true, release: slotRelease }), readGscIdentity: async () => ({ sub: "other-user" }),
      openGscGate, readWebsite, readSerp, consumeQuota,
    }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: "gsc_auth_required" } });
    expect(consumeQuota.mock.calls.map(([key]) => key)).toEqual(["public-content-brief:account:user-1", "public-content-brief:ip:203.0.113.9"]);
    expect(openGscGate).not.toHaveBeenCalled();
    expect(readWebsite).not.toHaveBeenCalled();
    expect(readSerp).not.toHaveBeenCalled();
    expect(slotRelease).toHaveBeenCalledTimes(1);
  });

  it("releases the v2 GSC gate on a revoked grant without spending the daily quota", async () => {
    const slotRelease = vi.fn();
    const gateRelease = vi.fn();
    const consumeQuota = vi.fn<ContentBriefHandlerDependencies["consumeQuota"]>(async () => ({ kind: "allowed", hits: 1 }));
    const readSerp = vi.fn<ContentBriefHandlerDependencies["readSerp"]>();
    const response = await handleContentBriefRequest(request(v2Body({ gsc_property: PROPERTY })), v2Dependencies({
      acquireSlot: () => ({ acquired: true, release: slotRelease }), openGscGate: async () => ({ ok: true, release: gateRelease }),
      resolveGscGrant: async () => ({ kind: "none" }), consumeQuota, readSerp,
    }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: "gsc_revoked" } });
    expect(slotRelease).toHaveBeenCalledTimes(1);
    expect(gateRelease).toHaveBeenCalledTimes(1);
    expect(consumeQuota).toHaveBeenCalledTimes(2);
    expect(readSerp).not.toHaveBeenCalled();
  });

  it.each([false, true])("releases v2 account and GSC slots after the run (model throws: %s)", async (throws) => {
    const slotRelease = vi.fn();
    const gateRelease = vi.fn();
    const deps = v2Dependencies({
      acquireSlot: () => ({ acquired: true, release: slotRelease }), openGscGate: async () => ({ ok: true, release: gateRelease }),
      ...(throws ? { runLlmV2: async () => { throw new Error("private upstream detail"); } } : {}),
    });
    const response = await handleContentBriefRequest(request(v2Body({ gsc_property: PROPERTY })), deps);
    if (throws) {
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: { code: "brief_unavailable" } });
      expect(deps.lines.join("\n")).not.toContain("private upstream detail");
    } else await briefV2Of(response);
    expect(slotRelease).toHaveBeenCalledTimes(1);
    expect(gateRelease).toHaveBeenCalledTimes(1);
  });

  it("uses one run-start GSC window even when the lane deadline crosses UTC midnight", async () => {
    const readGscDimensions = vi.fn<ContentBriefHandlerDependencies["readGscDimensions"]>(async () => gscRead());
    const brief = await briefV2Of(await handleContentBriefRequest(request(v2Body({ gsc_property: PROPERTY })), v2Dependencies({
      now: () => Date.parse("2026-08-31T23:59:59.500Z"), readGscDimensions,
    })));
    expect(readGscDimensions.mock.calls[0]?.[0].window).toEqual({ startDate: "2026-08-01", endDate: "2026-08-28" });
    expect(brief.context.gsc.window).toEqual({ start: "2026-08-01", end: "2026-08-28", lookback_days: 28 });
  });

  it.each([
    ["query", "paging"], ["query", "unreadable"], ["queryPage", "paging"], ["queryPage", "unreadable"], ["page", "paging"], ["page", "unreadable"],
  ] as const)("reports a partial GSC read when %s has %s loss", async (source, loss) => {
    const read = gscRead();
    const lane = read[source];
    const deps = v2Dependencies({ readGscDimensions: async () => ({
      ...read, [source]: { ...lane, ...(loss === "paging" ? { paging: { ...lane.paging, truncated: true } } : { unreadableRows: 1 }) },
    }) });
    const brief = await briefV2Of(await handleContentBriefRequest(request(v2Body({ gsc_property: PROPERTY })), deps));
    expect(brief.context.gsc.status).toBe("partial");
    expect(brief.run.reads.find(({ source }) => source === "gsc")?.status).toBe("partial");
  });

  it("retains 32 profile facts with actual source counts and the exact selected snapshot", async () => {
    const profile = { ...confirmedProfile(), coreFeatures: Array.from({ length: 32 }, (_, index) => `feature ${index}`) };
    const readWebsite = vi.fn<ContentBriefHandlerDependencies["readWebsite"]>(async () => ({
      kind: "ok", websiteId: "w-1", snapshotRevision: 9, profileHash: "d".repeat(64), profile,
    }));
    const brief = await briefV2Of(await handleContentBriefRequest(request(v2Body({ website_id: "w-1" })), v2Dependencies({ readWebsite })));
    expect(readWebsite).toHaveBeenCalledWith("user-1", "w-1");
    expect(brief.context.profile_snapshot).toEqual({ website_id: "w-1", revision: 9, hash: "d".repeat(64) });
    expect(brief.context.facts).toHaveLength(32);
    expect(brief.context.facts[31]).toMatchObject({ id: "P32", text: "feature 29" });
    expect(brief.run.reads.find(({ source }) => source === "profile")).toEqual({ source: "profile", status: "partial", attempted: 34, retained: 32, reason: null });
  });

  it.each(["missing", "not_confirmed", "error"] as const)("does not turn a %s profile read into an invented one-fact count", async (kind) => {
    const brief = await briefV2Of(await handleContentBriefRequest(request(v2Body({ website_id: "w-1" })), v2Dependencies({ readWebsite: async () => ({ kind }) })));
    expect(brief.context.facts).toEqual([]);
    expect(brief.context.profile_snapshot).toBeNull();
    expect(brief.run.reads.find(({ source }) => source === "profile")).toMatchObject({ status: "unavailable", attempted: null, retained: null });
  });

  it("does not attach facts from a different website than the selected profile", async () => {
    const brief = await briefV2Of(await handleContentBriefRequest(request(v2Body({ website_id: "w-1" })), v2Dependencies({ readWebsite: async () => ({
      kind: "ok", websiteId: "w-2", snapshotRevision: 9, profileHash: "d".repeat(64), profile: confirmedProfile(),
    }) })));
    expect(brief.context.facts).toEqual([]);
    expect(brief.context.profile_snapshot).toBeNull();
    expect(brief.run.reads.find(({ source }) => source === "profile")).toMatchObject({ status: "unavailable", attempted: null, retained: null, reason: "provider_error" });
  });

  it("excludes unrequested optional sources from complete telemetry", async () => {
    const deps = v2Dependencies();
    await briefV2Of(await handleContentBriefRequest(request(v2Body()), deps));
    expect(lastRunLine(deps)["mode"]).toBe("complete");
  });

  it("reports partial telemetry when generation succeeds with a partial source", async () => {
    const deps = v2Dependencies({ readSerp: async () => ({ ...serpResult(8), peopleAlsoAsk: { status: "complete", items: [], unreadableItems: 0, unreadableBlocks: 0, truncatedItems: 0 } }) });
    await briefV2Of(await handleContentBriefRequest(request(v2Body()), deps));
    expect(lastRunLine(deps)["mode"]).toBe("partial");
  });

  it("reports degraded telemetry when generation succeeds but a requested source was unavailable", async () => {
    const deps = v2Dependencies({ readSerp: async () => serpResult() });
    await briefV2Of(await handleContentBriefRequest(request(v2Body()), deps));
    expect(lastRunLine(deps)["mode"]).toBe("degraded");
  });

  it("reports unavailable telemetry when no requested source or generation is available", async () => {
    const deps = v2Dependencies({
      readSerp: async () => { throw new Error("provider unavailable"); },
      runLlmV2: async ({ context }) => ({ context, output: null, reads: llmResult().reads, prompt_bytes: 0 }),
    });
    await briefV2Of(await handleContentBriefRequest(request(v2Body()), deps));
    expect(lastRunLine(deps)["mode"]).toBe("unavailable");
  });

  it("reports degraded telemetry when evidence survives but generation is unavailable", async () => {
    const deps = v2Dependencies({ runLlmV2: async ({ context }) => ({ context, output: null, reads: llmResult().reads, prompt_bytes: 0 }) });
    const brief = await briefV2Of(await handleContentBriefRequest(request(v2Body()), deps));
    expect(brief.context.research.pages).not.toHaveLength(0);
    expect(lastRunLine(deps)["mode"]).toBe("degraded");
  });
});

describe("handleContentBriefRequest run", () => {
  it("keeps the existing route on v1 unless the caller explicitly negotiates v2", async () => {
    const response = await handleContentBriefRequest(request(validBody()), dependencies());
    const body = await response.json();
    expect(body).toMatchObject({ schema: "gengrowth.content_brief/v1" });
  });

  it("returns a self-checked v2 brief only when the caller explicitly requests that contract", async () => {
    const ownedUrl = "https://site.example/coffee";
    const deps = dependencies({
      readWebsite: async (): Promise<ProfileReadResult> => ({
        kind: "ok",
        websiteId: "w-1",
        snapshotRevision: 7,
        profileHash: "a".repeat(64),
        profile: confirmedProfile(),
      }),
      readGscDimensions: async () => gscRead({
        query: { rows: [], paging: { pagesFetched: 1, truncated: false }, responseAggregationType: "byPage", unreadableRows: 0 },
        queryPage: {
          rows: [{ query: "pour over", page: ownedUrl, clicks: 0, impressions: 2, position: 51 }],
          paging: { pagesFetched: 1, truncated: false },
          unreadableRows: 0,
        },
        page: {
          rows: [{ page: ownedUrl, clicks: 0, impressions: 2, position: 51 }],
          paging: { pagesFetched: 1, truncated: false },
          unreadableRows: 0,
        },
      }),
      crawlV2: async () => ({
        observed: [
          {
            id: "C1",
            role: "competitor",
            url: "https://site1.example/blog/coffee-1",
            final_url: "https://site1.example/blog/coffee-1",
            fetched_at: "2026-08-31T00:00:00.000Z",
            content_hash: "b".repeat(64),
            body_complete: true,
            research: {
              segments: [{ heading: null, text: "Pour over coffee needs a stable brew ratio.", truncated: false }],
              segments_total: 1,
              omitted_segments: 0,
              length: { value: 8, unit: "words", tokenizer: "whitespace" },
            },
          },
          {
            id: "T1",
            role: "owned",
            url: ownedUrl,
            final_url: ownedUrl,
            fetched_at: "2026-08-31T00:00:00.000Z",
            content_hash: "c".repeat(64),
            body_complete: true,
            research: {
              segments: [{ heading: { level: "h2", text: "Pour over coffee" }, text: "Our coffee guide explains the brew workflow.", truncated: false }],
              segments_total: 1,
              omitted_segments: 0,
              length: { value: 7, unit: "words", tokenizer: "whitespace" },
            },
          },
        ],
        failed: [],
      }),
      runLlmV2: async ({ context }) => ({
        context,
        output: {
          research: {
            questions: [{ id: "Q1", anchor: "U1", q: "How do you brew pour over coffee?", source_refs: ["U1"], covered_by: 1, paa_refs: [] }],
            outline: [{ id: "O1", h2: "Brew pour over coffee", h3: [], answers: ["Q1"] }],
          },
          intent: { value: "informational", rationale: "The reader is learning the brewing workflow." },
          format: { value: "guide", rationale: "A step-by-step explainer fits the observed evidence." },
          page_plan: { action: "update", rationale: "A supporting-query page already exists and was read.", target_ref: "T1", steps: [
            { kind: "keep", instruction: "Keep the current brew workflow explanation.", sources: ["U2"], answers: [] },
            { kind: "add", instruction: "Add the missing brew-ratio explanation.", sources: ["U1"], answers: ["Q1"] },
          ] },
          gap_angle: null,
          internal_links: [],
          do_not_cover: [],
        },
        reads: { status: "complete", calls: 1, model_id: "fixture-model", temperature_requested: 0.2, temperature_effective: 1, input_tokens: 123, output_tokens: 45 },
        prompt_bytes: 2048,
      }),
    });
    const brief = await briefV2Of(await handleContentBriefRequest(
      request(validBody({ website_id: "w-1", gsc_property: PROPERTY, response_schema: CONTENT_BRIEF_V2_SCHEMA })),
      deps,
    ));
    expect(brief.schema).toBe(CONTENT_BRIEF_V2_SCHEMA);
    expect(brief.context.gsc.matches).toEqual([
      { id: "G1", query: "pour over", keyword: "pour over", scope: "supporting", page: ownedUrl, clicks: 0, impressions: 2, position: 51 },
    ]);
    expect(brief.context.candidates).toEqual([{ id: "T1", url: ownedUrl, match_refs: ["G1"], read: "observed" }]);
    expect(brief.context.profile_snapshot).toEqual({ website_id: "w-1", revision: 7, hash: "a".repeat(64) });
    expect(brief.generated?.page_plan).toMatchObject({ action: "update", target_ref: "T1" });
  });

  it("assembles a brief with an undecidable verdict and prints the budget", async () => {
    const deps = dependencies();
    const brief = await briefOf(await handleContentBriefRequest(request(validBody()), deps));
    expect(brief.verdict).toEqual({ action: "undecidable", reason: "no_gsc_property", provenance: null });
    expect(brief.run.budget_ms).toBe(RUN_BUDGET_MS);
    expect(brief.run.run_id).toBe("run-fixed");
    expect(brief.run.reads.serp).toMatchObject({ status: "complete", returned: 10 });
    expect(brief.run.reads.crawl).toMatchObject({ status: "partial", attempted: 10, observed: 6, skipped: 0, failed: 4 });
    expect(brief.run.reads.llm).toMatchObject({ status: "unavailable", reason: "not_configured" });
    expect(brief.run.mode).toBe("degraded");
    expect(brief.must_answer.status).toBe("available");
    expect(brief.draft_readiness.gaps).toContain("llm_unavailable");
    expect(lastRunLine(deps)).toMatchObject({ tool: "content-brief", run_id: "run-fixed", serp_cost_usd: 0.002, self_check: "ok" });
  });

  it("measures elapsed time from the moment the request arrived, admission included", async () => {
    const deps = dependencies();
    const brief = await briefOf(await handleContentBriefRequest(request(validBody()), deps));
    // The fake clock ticks 100 ms per read; admission alone makes several reads.
    expect(brief.run.elapsed_ms).toBeGreaterThanOrEqual(500);
  });

  it("does not crawl when the SERP is unavailable and reports the run as unavailable", async () => {
    const crawl = vi.fn<ContentBriefHandlerDependencies["crawl"]>(async () => crawlResult());
    const brief = await briefOf(
      await handleContentBriefRequest(request(validBody()), dependencies({ readSerp: async () => serpResult(0), crawl })),
    );
    expect(crawl).not.toHaveBeenCalled();
    expect(brief.run.mode).toBe("unavailable");
    expect(brief.run.reads.crawl).toEqual({ status: "unavailable", reason: "insufficient_evidence", attempted: 0 });
    expect(brief.must_answer).toEqual({ status: "unavailable", reason: "insufficient_evidence", attempted: 0 });
  });

  it("counts a SERP whose rows all lack a URL as skipped, not as a failed crawl", async () => {
    const noUrls: ContentBriefSerpResult = {
      ...serpResult(3),
      rows: serpResult(3).rows.map((row) => ({ ...row, url: null })),
    };
    const crawl = vi.fn<ContentBriefHandlerDependencies["crawl"]>(async () => crawlResult());
    const brief = await briefOf(await handleContentBriefRequest(request(validBody()), dependencies({ readSerp: async () => noUrls, crawl })));
    expect(crawl).not.toHaveBeenCalled();
    expect(brief.run.reads.crawl).toEqual({ status: "complete", attempted: 3, observed: 0, truncated: 0, failed: 0, skipped: 3 });
    expect(brief.evidence.crawl.skipped.every((entry) => entry.reason === "no_url")).toBe(true);
  });

  it("reads the profile only when a website was chosen and reports an unconfirmed one honestly", async () => {
    const readWebsite = vi.fn(async (): Promise<ProfileReadResult> => ({ kind: "not_confirmed" }));
    const deps = dependencies({ readWebsite });
    const without = await briefOf(await handleContentBriefRequest(request(validBody()), deps));
    expect(readWebsite).not.toHaveBeenCalled();
    expect(without.run.reads.product_profile).toEqual({ status: "unavailable", reason: "not_requested", attempted: null });

    const withSite = await briefOf(await handleContentBriefRequest(request(validBody({ website_id: "w-1" })), deps));
    expect(readWebsite).toHaveBeenCalledWith("user-1", "w-1");
    expect(withSite.run.reads.product_profile).toEqual({ status: "unavailable", reason: "insufficient_evidence", attempted: 1 });
    expect(withSite.gap_angle).toMatchObject({ status: "unavailable", reason: "insufficient_evidence" });
  });

  it("records a profile read that outlives its budget as a timeout, not a provider error", async () => {
    vi.useFakeTimers();
    try {
      const deps = dependencies({
        readWebsite: () => new Promise(() => undefined),
        now: () => Date.now(),
      });
      const pending = handleContentBriefRequest(request(validBody({ website_id: "w-1" })), deps);
      await vi.advanceTimersByTimeAsync(20_000);
      const brief = await briefOf(await pending);
      expect(brief.run.reads.product_profile).toEqual({ status: "unavailable", reason: "timeout", attempted: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands the model the selected questions, their excerpts and every observed page", async () => {
    const runLlm = vi.fn<ContentBriefHandlerDependencies["runLlm"]>(async () => llmResult());
    await handleContentBriefRequest(request(validBody()), dependencies({ runLlm }));
    const input = runLlm.mock.calls[0]?.[0];
    expect(input?.primary).toBe("brew coffee");
    expect(input?.supporting).toEqual(["pour over"]);
    expect(input?.observedIds).toEqual(["C1", "C2", "C3", "C4", "C5", "C6"]);
    expect(input?.observedPages.map((page) => page.id)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6"]);
    expect(input?.questions.length).toBeGreaterThan(0);
    expect(input?.questions[0]?.excerpts[0]).toMatchObject({ observation_id: "C1" });
    expect(input?.facts).toBeNull();
    expect(input?.gscPages).toBeNull();
  });

  it("dedupes same-host SERP rows before crawling", async () => {
    const crawl = vi.fn<ContentBriefHandlerDependencies["crawl"]>(async () => ({
      observed: [{ ...observation(1), url: "https://one.example/p0", final_url: "https://one.example/p0" }],
      failed: [],
    }));
    const sameHost: ContentBriefSerpResult = {
      ...serpResult(3),
      rows: serpResult(3).rows.map((row, index) => ({ ...row, url: `https://one.example/p${index}`, domain: "one.example" })),
    };
    const brief = await briefOf(await handleContentBriefRequest(request(validBody()), dependencies({ readSerp: async () => sameHost, crawl })));
    expect(crawl.mock.calls[0]?.[0]?.targets).toEqual([{ serp_id: "S1", url: "https://one.example/p0" }]);
    expect(brief.run.reads.crawl).toMatchObject({ attempted: 3, observed: 1, skipped: 2 });
    expect(brief.evidence.crawl.skipped).toEqual([
      { serp_id: "S2", reason: "same_host", kept_serp_id: "S1" },
      { serp_id: "S3", reason: "same_host", kept_serp_id: "S1" },
    ]);
  });

  it("drops a model answer the parser rejects and says so, instead of sending an unusable brief", async () => {
    const deps = dependencies({
      runLlm: async () => ({
        output: {
          // An outline answer pointing at a question the brief never assigned:
          // the LLM validator would have caught this, so this simulates the two
          // validators disagreeing.
          questions: [],
          outline: [{ h2: "Getting started", h3: [], answers: ["Q99"] }],
          gap_angle: null,
          internal_links: null,
          do_not_cover: null,
        },
        reads: { status: "complete", calls: 1, model_id: "gpt-test", temperature_requested: 0.2, temperature_effective: null, input_tokens: 10, output_tokens: 5 },
        derived_from: ["crawl", "user_input"],
      }),
    });
    const brief = await briefOf(await handleContentBriefRequest(request(validBody()), deps));
    expect(brief.run.reads.llm).toMatchObject({ status: "unavailable", reason: "validation_failed", calls: 1 });
    expect(lastRunLine(deps)).toMatchObject({ self_check: "recovered" });
  });
});

/* ------------------------------------------------------------------ */
/* GSC lane                                                             */
/* ------------------------------------------------------------------ */

describe("handleContentBriefRequest with Search Console", () => {
  it("decides update from the primary keyword's own rows and ships the page ledger", async () => {
    const deps = dependencies();
    const brief = await briefOf(await handleContentBriefRequest(request(validBody({ gsc_property: PROPERTY })), deps));
    expect(brief.verdict).toMatchObject({ action: "update", reason: "self_compete", target_url: "https://site.example/coffee" });
    expect(brief.run.reads.gsc).toMatchObject({
      status: "complete",
      property: PROPERTY,
      matched_queries: 1,
      primary_coverage: { ratio: 1 },
      rows: { query: 1, query_page: 1, page: 2 },
      unreadable_rows: { query: 0, query_page: 0, page: 0 },
    });
    expect(brief.evidence.gsc_query_page).toHaveLength(1);
    expect(brief.evidence.gsc_pages.map((row) => row.id)).toEqual(["G1", "G2"]);
    expect(brief.draft_readiness.gaps).not.toContain("no_gsc");
  });

  it("hands the page ledger to the model when it exists", async () => {
    const runLlm = vi.fn<ContentBriefHandlerDependencies["runLlm"]>(async () => llmResult());
    await handleContentBriefRequest(request(validBody({ gsc_property: PROPERTY })), dependencies({ runLlm }));
    expect(runLlm.mock.calls[0]?.[0]?.gscPages?.map((row) => row.id)).toEqual(["G1", "G2"]);
  });

  it("says create when the primary keyword is not in a complete sample", async () => {
    const deps = dependencies({
      readGscDimensions: async () =>
        gscRead({
          query: { rows: [{ query: "other", clicks: 1, impressions: 5, position: 3 }], paging: { pagesFetched: 1, truncated: false }, responseAggregationType: "byPage", unreadableRows: 0 },
          queryPage: { rows: [], paging: { pagesFetched: 1, truncated: false }, unreadableRows: 0 },
        }),
    });
    const brief = await briefOf(await handleContentBriefRequest(request(validBody({ gsc_property: PROPERTY })), deps));
    expect(brief.verdict).toMatchObject({ action: "create", reason: "not_observed" });
    expect(brief.run.reads.gsc).toMatchObject({ primary_coverage: { ratio: null, reason: "query_not_in_sample" } });
  });

  it("refuses to decide on a truncated or unreadable sample", async () => {
    const deps = dependencies({
      readGscDimensions: async () =>
        gscRead({
          query: { rows: [{ query: "other", clicks: 1, impressions: 5, position: 3 }], paging: { pagesFetched: 4, truncated: true }, responseAggregationType: "byPage", unreadableRows: 2 },
          queryPage: { rows: [], paging: { pagesFetched: 1, truncated: false }, unreadableRows: 0 },
        }),
    });
    const brief = await briefOf(await handleContentBriefRequest(request(validBody({ gsc_property: PROPERTY })), deps));
    expect(brief.verdict).toMatchObject({ action: "undecidable", reason: "gsc_partial" });
    expect(brief.run.reads.gsc).toMatchObject({ status: "partial", truncated: ["query"], unreadable_rows: { query: 2 } });
  });

  it("answers an unexpected exception with a closed code, not a platform 500", async () => {
    const deps = dependencies({
      readSerp: async () => {
        throw new TypeError("boom");
      },
    });
    const response = await handleContentBriefRequest(request(validBody()), deps);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: { code: "brief_unavailable" } });
    expect(deps.lines.some((line) => line.includes("unhandled") && !line.includes("boom"))).toBe(true);
  });

  it("turns a failed Search Console read into an undecidable verdict without losing the rest", async () => {
    const deps = dependencies({
      readGscDimensions: async () => {
        throw new Error("boom");
      },
    });
    const brief = await briefOf(await handleContentBriefRequest(request(validBody({ gsc_property: PROPERTY })), deps));
    expect(brief.verdict).toMatchObject({ action: "undecidable", reason: "gsc_unavailable" });
    expect(brief.run.reads.gsc).toEqual({ status: "unavailable", reason: "provider_error", attempted: 1 });
    expect(brief.run.mode).toBe("degraded");
    expect(brief.must_answer.status).toBe("available");
  });
});

/* ------------------------------------------------------------------ */
/* profile facts                                                        */
/* ------------------------------------------------------------------ */

describe("profileFacts", () => {
  it("walks the contract's field order, skips missing fields and marks inferred ones as model", () => {
    const profile = {
      schemaVersion: "marketing.website-profile.v1",
      productName: "Brewly",
      oneLinePositioning: "Coffee gear for home baristas",
      valueProposition: "",
      coreFeatures: ["Grinder", "Kettle"],
      categories: [],
      country: "US",
      locale: "en",
      fieldProvenance: [
        { path: "/productName", derivation: "declared", confidence: "high", source: "supplied_product_information" },
        { path: "/oneLinePositioning", derivation: "inferred", confidence: "low", source: "local_inference" },
        { path: "/coreFeatures", derivation: "observed", confidence: "medium", source: "visitor_url" },
      ],
    } as unknown as MarketingWebsiteProfileV1;
    const facts = profileFacts(profile);
    expect(facts.map((fact) => [fact.id, fact.field, fact.derivation])).toEqual([
      ["P1", "productName", "declared"],
      ["P2", "oneLinePositioning", "inferred"],
      ["P3", "coreFeatures[0]", "observed"],
      ["P4", "coreFeatures[1]", "observed"],
    ]);
    expect(facts[1]?.provenance).toEqual({ method: "model", derived_from: ["product_profile"] });
    expect(facts[0]?.provenance).toEqual({ method: "observed", origin: "product_profile" });
  });
});
