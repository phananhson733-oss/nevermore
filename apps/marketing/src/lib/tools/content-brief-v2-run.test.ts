import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseContentBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import type { BriefV2Gsc, ModelBriefV2Output, OwnedCandidate } from "@sf/public-tools/content-brief/v2-generation-contract";
import { projectBriefV2Gsc } from "@sf/public-tools/content-brief/v2-gsc";
import { createDataForSeoKeywordMetricsClient } from "@sf/sources/dataforseo/keyword-metrics";
import type { PublicResourceFetchOptions, PublicResourceResult, PublicResourceSuccess } from "@sf/sources/public-http";
import { createKeywordLlmClient, type KeywordLlmRequest } from "./keyword-llm-client.ts";
import { readContentBriefSerp } from "./content-brief-serp.ts";
import { crawlContentBriefV2Targets } from "./content-brief-v2-crawl.ts";
import { runContentBriefV2Llm } from "./content-brief-v2-llm.ts";
import { ContentBriefV2RunError, runContentBriefV2 } from "./content-brief-v2-run.ts";

const START = Date.parse("2026-08-31T01:00:00.000Z");
const WINDOW = { start: "2026-08-01", end: "2026-08-28", lookback_days: 28 as const };
const KEYWORD = { primary: "reporting delays", supporting: ["reporting timeline"], market: "US", language: "en" };
const OWNED_URL = "https://owned.test/reporting";
const REQUEST = { input: KEYWORD, runId: "fixture-run", startedAt: START, deadlineAt: START + 45_000 };
const CONFIG = { apiKey: "fixture-key", model: "fixture-model", url: "https://model.test/chat", authScheme: "api-key" as const, temperature: 1 };
const GSC: BriefV2Gsc = {
  status: "complete", property: "sc-domain:owned.test", window: WINDOW, reason: null,
  matches: [{ id: "G1", query: "reporting timeline", keyword: "reporting timeline", scope: "supporting", page: OWNED_URL, clicks: 0, impressions: 1, position: 48 }],
  omitted_matches: 0,
};
const CANDIDATES: readonly OwnedCandidate[] = [{ id: "T1", url: OWNED_URL, match_refs: ["G1"], read: "unavailable" }];
const QUESTION = "How long do reporting delays last?";
const HTML = "<main><div>Reporting data can arrive after the reporting window closes.</div></main>";
const OWNED_HTML = "<main><h2>Reporting timeline</h2><p>Check the current reporting period and its processing status.</p></main>";

function page(url: string, body = HTML): PublicResourceSuccess {
  return { kind: "ok", requestedUrl: url, finalUrl: url, firstStatus: 200, finalStatus: 200, redirectChain: [], contentType: "text/html", xRobotsTag: null, body, bytes: Buffer.byteLength(body), bodyComplete: true };
}

function model(update = false): ModelBriefV2Output {
  const anchor = update ? "U3" : "U2";
  return {
    research: { questions: [{ anchor, q: QUESTION, sources: ["U1", anchor] }], outline: [{ h2: "Understand reporting delays", h3: [], answers: [anchor] }] },
    intent: { value: "informational", rationale: "The reader needs the reporting timeline explained." },
    format: { value: "guide", rationale: "Explain the process and checks." },
    page_plan: update
      ? { action: "update", rationale: "The supporting query points to an existing reporting page, regardless of its low impressions.", target_ref: "T1", steps: [
        { kind: "keep", instruction: "Keep the existing reporting period check.", sources: ["U2"], answers: [] },
        { kind: "add", instruction: "Explain why data may arrive after the reporting window.", sources: ["U1"], answers: [anchor] },
      ] }
      : { action: "undecidable", rationale: "No site coverage sample was requested.", target_ref: null, steps: [] },
    gap_angle: null, internal_links: [], do_not_cover: [],
  };
}

function seams(output: unknown = model(), extraOrganic: readonly unknown[] = [], paa: readonly unknown[] = [{ type: "people_also_ask_element", title: QUESTION }]) {
  const serpFetch = vi.fn(async () => Response.json({ status_code: 20_000, cost: 0.002, tasks: [{ status_code: 20_000, cost: 0.002, result: [{ item_types: ["organic", "people_also_ask"], items: [
    { type: "organic", rank_group: 1, domain: "source.test", title: "Reporting delays", url: "https://source.test/reporting" },
    ...extraOrganic, { type: "people_also_ask", items: paa },
  ] }] }] }));
  const source = createDataForSeoKeywordMetricsClient({ login: "fixture-login", password: "fixture-password", fetchImpl: serpFetch });
  const fetchResource = vi.fn(async (url: string, _options?: PublicResourceFetchOptions): Promise<PublicResourceResult> => page(url, url === OWNED_URL ? OWNED_HTML : HTML));
  const complete = vi.fn(async (_request: KeywordLlmRequest) => ({ content: JSON.stringify(output), modelId: "fixture-model", usage: { requestCount: 1, retryCount: 0, inputTokens: 350, outputTokens: 200 } }));
  const readSerp = vi.fn((input: Parameters<typeof readContentBriefSerp>[0]) => readContentBriefSerp(input, { client: source }));
  const crawl = vi.fn((input: Parameters<typeof crawlContentBriefV2Targets>[0]) => crawlContentBriefV2Targets(input, { fetchResource, now: () => START }));
  const runLlm = vi.fn((input: Parameters<typeof runContentBriefV2Llm>[0]) => runContentBriefV2Llm(input, { client: { complete }, config: CONFIG, now: () => START }));
  return { serpFetch, fetchResource, complete, deps: { readSerp, crawl, runLlm, now: () => START } };
}

describe("runContentBriefV2 admitted generation", () => {
  beforeEach(() => vi.spyOn(console, "info").mockImplementation(() => undefined));
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("connects actual provider parsing, headingless extraction, PAA graph and the exact exported brief", async () => {
    const fixture = seams();
    const brief = await runContentBriefV2(REQUEST, fixture.deps);
    expect(await parseContentBriefV2(brief)).toEqual({ ok: true, value: brief });
    expect(brief.generated?.research.questions).toEqual([{ id: "Q1", anchor: "U2", q: QUESTION, source_refs: ["U1", "U2"], covered_by: 1, paa_refs: ["A1"] }]);
    expect(brief.generated?.research.outline).toEqual([{ id: "O1", h2: "Understand reporting delays", h3: [], answers: ["Q1"] }]);
    expect(brief.context.research.pages[0]?.research.segments[0]).toEqual({ heading: null, text: "Reporting data can arrive after the reporting window closes.", truncated: false });
    expect(fixture.serpFetch).toHaveBeenCalledTimes(1);
    expect(fixture.complete).toHaveBeenCalledTimes(1);
    expect(fixture.deps.readSerp.mock.calls[0]?.[0].includePeopleAlsoAsk).toBe(true);
    expect(brief.run.reads).toContainEqual({ source: "paa", status: "complete", attempted: 1, retained: 1, reason: null });
    expect(brief.run.reads).toContainEqual({ source: "gsc", status: "unavailable", attempted: 0, retained: null, reason: "not_requested" });
    expect(brief.run.llm).toMatchObject({ status: "complete", calls: 1, input_tokens: 350, output_tokens: 200 });
    expect(brief.run.serp_cost_usd).toBe(0.002);
  });

  it("reads a supporting-only candidate before selecting update and preserves source provenance", async () => {
    const fixture = seams(model(true));
    const gsc = { property: GSC.property!, window: WINDOW, read: vi.fn(async () => projectBriefV2Gsc({ input: KEYWORD, property: GSC.property!, window: WINDOW, status: "complete", rows: [
      { query: "reporting timeline", page: OWNED_URL, clicks: 0, impressions: 1, position: 48 },
      { query: "unrelated software", page: "https://owned.test/other", clicks: 10, impressions: 100, position: 1 },
    ], pages: [] })) };
    const before = structuredClone({ REQUEST, GSC, CANDIDATES });
    const brief = await runContentBriefV2({ ...REQUEST, gsc }, fixture.deps);
    expect(brief.generated?.page_plan).toMatchObject({ action: "update", target_ref: "T1", steps: [{ sources: ["U2"] }, { answers: ["Q1"] }] });
    expect(brief.context.candidates[0]?.read).toBe("observed");
    expect(brief.context.gsc.matches[0]).toEqual(GSC.matches[0]);
    expect(brief.context.research.pages.find((item) => item.id === "T1")?.research.segments[0]?.text).toContain("processing status");
    expect(fixture.fetchResource.mock.calls.map((call) => call[0])).toEqual(["https://source.test/reporting", OWNED_URL]);
    expect({ REQUEST, GSC, CANDIDATES }).toEqual(before);
  });

  it("compares the exact GSC window by values rather than object key insertion order", async () => {
    const fixture = seams(model(true));
    const brief = await runContentBriefV2({ ...REQUEST, gsc: { property: GSC.property!, window: WINDOW, read: async () => ({ gsc: { ...GSC, window: { lookback_days: 28, end: WINDOW.end, start: WINDOW.start } }, candidates: CANDIDATES }) } }, fixture.deps);
    expect(brief.context.gsc.window).toEqual(WINDOW);
    expect(brief.generated?.page_plan.action).toBe("update");
  });

  it("does not read or count the same owned URL again as a competitor", async () => {
    const fixture = seams(model(true), [{ type: "organic", rank_group: 2, domain: "owned.test", title: "Reporting", url: `${OWNED_URL}#status` }]);
    const brief = await runContentBriefV2({ ...REQUEST, gsc: { property: GSC.property!, window: WINDOW, read: async () => ({ gsc: GSC, candidates: CANDIDATES }) } }, fixture.deps);
    expect(fixture.fetchResource).toHaveBeenCalledTimes(2);
    expect(brief.context.research.pages.map((item) => [item.id, item.role])).toEqual([["C1", "competitor"], ["T1", "owned"]]);
    expect(brief.generated?.research.questions[0]?.covered_by).toBe(1);
  });

  it("retains an invalid model result as an unavailable generation without retry", async () => {
    const fixture = seams({ ...model(), page_plan: { action: "update", rationale: "Invented target", target_ref: "T3", steps: [] } });
    const brief = await runContentBriefV2(REQUEST, fixture.deps);
    expect(brief.generated).toBeNull();
    expect(brief.run.llm).toMatchObject({ status: "unavailable", reason: "validation_failed", calls: 1 });
    expect(brief.context.research.paa).toHaveLength(1);
    expect(fixture.complete).toHaveBeenCalledTimes(1);
    expect((await parseContentBriefV2(brief)).ok).toBe(true);
  });

  it("records unreadable and omitted PAA as partial without adding a provider call", async () => {
    const paa = [{ type: "people_also_ask_element", title: QUESTION }, { type: "people_also_ask_element", title: " " }, ...Array.from({ length: 9 }, (_, index) => ({ type: "people_also_ask_element", title: `Other reporting question ${index}?` }))];
    const fixture = seams(model(), [], paa);
    const brief = await runContentBriefV2(REQUEST, fixture.deps);
    expect(brief.run.reads).toContainEqual({ source: "paa", status: "partial", attempted: 11, retained: 8, reason: null });
    expect(brief.context.research.budget.paa_omitted).toBe(2);
    expect(fixture.serpFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects an accidentally widened deadline before any paid read", async () => {
    const fixture = seams();
    await expect(runContentBriefV2({ ...REQUEST, deadlineAt: START + 46_000 }, fixture.deps)).rejects.toThrow("invalid brief run clock");
    expect(fixture.serpFetch).not.toHaveBeenCalled();
  });

  it("does not classify another URL from the known owned site as competitor evidence", async () => {
    const fixture = seams(model(true), [{ type: "organic", rank_group: 2, domain: "owned.test", title: "Another owned page", url: "https://www.owned.test/other" }]);
    const brief = await runContentBriefV2({ ...REQUEST, gsc: { property: GSC.property!, window: WINDOW, read: async () => ({ gsc: GSC, candidates: CANDIDATES }) } }, fixture.deps);
    expect(fixture.fetchResource.mock.calls.map((call) => call[0])).toEqual(["https://source.test/reporting", OWNED_URL]);
    expect(brief.context.research.pages.filter((item) => item.role === "competitor")).toHaveLength(1);
  });

  it("does not count a foreign SERP URL that redirects into the owned site as competitor coverage", async () => {
    const fixture = seams();
    fixture.fetchResource.mockImplementation(async (url) => ({ ...page(url), finalUrl: "https://owned.test/other", redirectChain: ["https://owned.test/other"] }));
    const brief = await runContentBriefV2({ ...REQUEST, gsc: { property: GSC.property!, window: WINDOW, read: async () => ({ gsc: { ...GSC, matches: [] }, candidates: [] }) } }, fixture.deps);
    expect(brief.context.research.pages).toEqual([]);
    expect(brief.run.reads.find((read) => read.source === "competitors")).toMatchObject({ status: "unavailable", retained: null, reason: "insufficient_evidence" });
    expect(brief.context.candidates).toEqual([]);
  });

  it("records lost competitor evidence when only one of several SERP pages redirects into the owned site", async () => {
    const fixture = seams(model(), [{ type: "organic", rank_group: 2, domain: "second.test", title: "Redirecting source", url: "https://second.test/reporting" }]);
    fixture.fetchResource.mockImplementation(async (url) => url.startsWith("https://second.test/")
      ? { ...page(url), finalUrl: "https://owned.test/other", redirectChain: ["https://owned.test/other"] } : page(url));
    const brief = await runContentBriefV2({ ...REQUEST, gsc: { property: GSC.property!, window: WINDOW, read: async () => ({ gsc: { ...GSC, matches: [] }, candidates: [] }) } }, fixture.deps);
    expect(brief.context.research.pages.map((item) => item.id)).toEqual(["C1"]);
    expect(brief.run.reads.find((read) => read.source === "competitors")).toEqual({ source: "competitors", status: "partial", attempted: 2, retained: 1, reason: null });
  });

  it.each(["not a URL", "http://127.0.0.1/", "https://private.test:8080/page"])('keeps valid pages when an unsafe provider URL is present: %s', async (url) => {
    const fixture = seams(model(), [{ type: "organic", rank_group: 2, domain: "unsafe.test", title: "Unsafe result", url }]);
    const brief = await runContentBriefV2(REQUEST, fixture.deps);
    expect(fixture.fetchResource.mock.calls.map((call) => call[0])).toEqual(["https://source.test/reporting"]);
    expect(brief.generated?.research.questions[0]?.covered_by).toBe(1);
    expect(brief.run.reads).toContainEqual({ source: "competitors", status: "partial", attempted: 2, retained: 1, reason: null });
  });

  it("does not start source/model reads after assembly headroom begins", async () => {
    const fixture = seams();
    const brief = await runContentBriefV2(REQUEST, { ...fixture.deps, now: () => START + 40_000 });
    expect(fixture.deps.readSerp).not.toHaveBeenCalled();
    expect(fixture.deps.runLlm).not.toHaveBeenCalled();
    expect(brief.generated).toBeNull();
    expect(brief.run.llm).toMatchObject({ status: "unavailable", reason: "timeout", attempted: 0, calls: 0 });
    expect(brief.run.reads.find((read) => read.source === "competitors")).toMatchObject({ status: "unavailable", reason: "timeout" });
  });

  it("does not report complete research when all SERP rows omit their URL", async () => {
    const fixture = seams();
    const brief = await runContentBriefV2(REQUEST, { ...fixture.deps, readSerp: async () => ({ rows: [{ rank: 1, domain: "source.test", title: null, url: null }], reads: { status: "partial", requested: 10, returned: 1, unresolved: 0 }, costUsd: 0.002, itemTypes: ["organic"], peopleAlsoAsk: { status: "unavailable", reason: "missing_block" } }) });
    expect(brief.run.reads.find((read) => read.source === "competitors")).toEqual({ source: "competitors", status: "unavailable", attempted: 0, retained: null, reason: "insufficient_evidence" });
    expect(fixture.fetchResource).not.toHaveBeenCalled();
  });

  it("bounds a stalled source and aborts its signal before proceeding with available evidence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const fixture = seams();
    const readSerp = vi.fn((_input: Parameters<typeof readContentBriefSerp>[0]) => new Promise<never>(() => undefined));
    const pending = runContentBriefV2(REQUEST, { ...fixture.deps, readSerp, now: Date.now });
    const succeeds = expect(pending).resolves.toHaveProperty("schema", "gengrowth.content_brief/v2");
    await vi.advanceTimersByTimeAsync(10_000);
    await succeeds;
    const brief = await pending;
    expect(readSerp.mock.calls[0]?.[0].signal.aborted).toBe(true);
    expect(brief.run.reads.find((read) => read.source === "serp")).toEqual({ source: "serp", status: "unavailable", attempted: 10, retained: null, reason: "timeout" });
    expect(brief.generated).toBeNull();
    expect(fixture.complete).not.toHaveBeenCalled();
  });

  it("bounds stalled scoped callbacks and preserves the requested GSC identity without leaking errors", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const fixture = seams();
    const read = vi.fn((_budget: { signal: AbortSignal }) => new Promise<never>(() => undefined));
    const pending = runContentBriefV2({ ...REQUEST, gsc: { property: GSC.property!, window: WINDOW, read }, profile: { read: async () => { throw new Error("private profile secret"); } } }, { ...fixture.deps, now: Date.now });
    const succeeds = expect(pending).resolves.toHaveProperty("schema", "gengrowth.content_brief/v2");
    await vi.advanceTimersByTimeAsync(15_000);
    await succeeds;
    const brief = await pending;
    expect(read.mock.calls[0]?.[0].signal.aborted).toBe(true);
    expect(brief.context.gsc).toMatchObject({ status: "unavailable", reason: "timeout", property: GSC.property, window: WINDOW });
    expect(brief.run.reads.find((item) => item.source === "profile")).toMatchObject({ status: "unavailable", reason: "provider_error" });
    expect(JSON.stringify(brief)).not.toContain("secret");
  });

  it("fails closed and finishes if an injected LLM runner never supplies a usage receipt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const fixture = seams();
    const pending = runContentBriefV2(REQUEST, { ...fixture.deps, runLlm: async () => new Promise<never>(() => undefined), now: Date.now });
    let settled = false;
    const outcome = pending.then((value) => { settled = true; return { value }; }, (error: unknown) => { settled = true; return { error }; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(await outcome).toEqual({ error: expect.any(ContentBriefV2RunError) });
  });

  it("preserves the actual client timeout receipt instead of racing it with the outer watchdog", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const fixture = seams();
    const fetchImpl = vi.fn(async (_url: string, options?: RequestInit): Promise<Response> => new Promise((_, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("fixture timeout", "AbortError")), { once: true });
    }));
    const client = createKeywordLlmClient({ config: CONFIG, fetchImpl });
    const pending = runContentBriefV2(REQUEST, { ...fixture.deps, now: Date.now, runLlm: (input) => runContentBriefV2Llm(input, { client, config: CONFIG, now: Date.now }) });
    const outcome = pending.then((value) => ({ value }), (error: unknown) => ({ error }));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await outcome).toMatchObject({ value: { generated: null, run: { llm: { status: "unavailable", reason: "timeout", attempted: 1 }, serp_cost_usd: 0.002 } } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps all five seconds of assembly headroom when the provider timeout gets the remaining budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START + 30_000);
    const fixture = seams();
    const client = createKeywordLlmClient({ config: CONFIG, fetchImpl: async (_url, options) => new Promise((_, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("fixture timeout", "AbortError")), { once: true });
    }) });
    const pending = runContentBriefV2(REQUEST, { ...fixture.deps, now: Date.now, runLlm: (input) => runContentBriefV2Llm(input, { client, config: CONFIG, now: Date.now }) });
    const outcome = pending.then((value) => ({ value }), (error: unknown) => ({ error }));
    await vi.advanceTimersByTimeAsync(9_900);
    expect(await outcome).toMatchObject({ value: { generated: null, run: { elapsed_ms: 39_900, llm: { status: "unavailable", reason: "timeout" } } } });
  });

  it("keeps a redirected owned candidate unresolved without substituting a new-page action", async () => {
    const fixture = seams();
    fixture.fetchResource.mockImplementation(async (url) => url === OWNED_URL
      ? { ...page(url, OWNED_HTML), finalUrl: "https://owned.test/replaced", redirectChain: ["https://owned.test/replaced"] } : page(url));
    const brief = await runContentBriefV2({ ...REQUEST, gsc: { property: GSC.property!, window: WINDOW, read: async () => ({ gsc: GSC, candidates: CANDIDATES }) } }, fixture.deps);
    expect(brief.context.candidates[0]?.read).toBe("redirected");
    expect(brief.generated?.page_plan).toMatchObject({ action: "undecidable", target_ref: null, steps: [] });
    expect(brief.run.reads.find((read) => read.source === "owned_pages")).toMatchObject({ status: "unavailable", reason: "insufficient_evidence" });
  });

  it("keeps an exact profile snapshot and its source facts in the same model assembly", async () => {
    const fixture = seams({ ...model(), gap_angle: { value: "Show the status check alongside the reporting timeline.", rationale: "The declared capability supports this example.", fact_refs: ["P1"], sources: ["U1"] } });
    const snapshot = { website_id: "website-fixture", revision: 3, hash: "a".repeat(64) };
    const facts = [{ id: "P1", field: "capabilities.0", text: "Provides a reporting status check.", derivation: "declared" as const, provenance: { method: "observed" as const, origin: "product_profile" as const } }];
    const brief = await runContentBriefV2({ ...REQUEST, profile: { read: async () => ({ facts, snapshot, read: { source: "profile", status: "complete", attempted: 1, retained: 1, reason: null } }) } }, fixture.deps);
    expect(brief.context.profile_snapshot).toEqual(snapshot);
    expect(brief.context.facts).toEqual(facts);
    expect(brief.generated?.gap_angle?.fact_refs).toEqual(["P1"]);
    expect(fixture.complete).toHaveBeenCalledTimes(1);
  });

  it("can assemble one PAA-only question when organic results are unavailable", async () => {
    const fixture = seams({ ...model(), research: { questions: [{ anchor: "U1", q: QUESTION, sources: ["U1"] }], outline: [{ h2: "Understand reporting delays", h3: [], answers: ["U1"] }] } });
    fixture.serpFetch.mockResolvedValueOnce(Response.json({ status_code: 20_000, cost: 0.002, tasks: [{ status_code: 20_000, cost: 0.002, result: [{ item_types: ["people_also_ask"], items: [{ type: "people_also_ask", items: [{ type: "people_also_ask_element", title: QUESTION }] }] }] }] }));
    const brief = await runContentBriefV2(REQUEST, fixture.deps);
    expect(brief.generated?.research.questions[0]).toMatchObject({ id: "Q1", covered_by: 0, paa_refs: ["A1"] });
    expect(brief.run.reads.find((read) => read.source === "serp")).toMatchObject({ status: "unavailable", reason: "insufficient_evidence" });
    expect(brief.run.reads.find((read) => read.source === "paa")).toMatchObject({ status: "complete", retained: 1 });
    expect(fixture.fetchResource).not.toHaveBeenCalled();
    expect(fixture.complete).toHaveBeenCalledTimes(1);
  });

  it("preserves known empty PAA separately from unavailable PAA", async () => {
    const output = { ...model(), research: { questions: [{ anchor: "U1", q: QUESTION, sources: ["U1"] }], outline: [{ h2: "Understand reporting delays", h3: [], answers: ["U1"] }] } };
    const empty = seams(output, [], []);
    const known = await runContentBriefV2(REQUEST, empty.deps);
    expect(known.run.reads.find((read) => read.source === "paa")).toEqual({ source: "paa", status: "complete", attempted: 0, retained: 0, reason: null });
    const unknown = seams(output);
    const readSerp = unknown.deps.readSerp;
    const missing = await runContentBriefV2(REQUEST, { ...unknown.deps, readSerp: async (input) => {
      const { peopleAlsoAsk: _unreported, ...result } = await readSerp(input);
      return result;
    } });
    expect(missing.run.reads.find((read) => read.source === "paa")).toEqual({ source: "paa", status: "unavailable", attempted: null, retained: null, reason: "insufficient_evidence" });
  });

  it("exports the exact byte-bounded CJK model context and marks omitted excerpts partial", async () => {
    const output = { ...model(), research: { questions: [], outline: [] }, intent: null, format: null };
    const rows = Array.from({ length: 9 }, (_, index) => ({ type: "organic", rank_group: index + 2, domain: `source${index + 2}.test`, title: "中文来源", url: `https://source${index + 2}.test/reporting` }));
    const fixture = seams(output, rows, []);
    fixture.fetchResource.mockImplementation(async (url) => page(url, `<main>${Array.from({ length: 6 }, () => `<p>${"𠀀".repeat(300)}</p>`).join("")}</main>`));
    const brief = await runContentBriefV2({ ...REQUEST, input: { ...KEYWORD, language: "zh" } }, fixture.deps);
    const beforePacking = fixture.deps.runLlm.mock.calls[0]![0].context.research;
    expect(beforePacking.units).toHaveLength(60);
    expect(brief.context.research.units.length).toBeLessThan(60);
    expect(brief.context.research.budget.page_units_available).toBe(60);
    expect(brief.context.research.budget.page_units_omitted).toBe(60 - brief.context.research.units.length);
    const prompt = fixture.complete.mock.calls[0]![0];
    expect(JSON.parse(prompt.user).units).toHaveLength(brief.context.research.units.length);
    expect(brief.run.prompt_bytes).toBe(Buffer.byteLength(JSON.stringify({ system: prompt.system, user: prompt.user })));
    expect(brief.run.prompt_bytes).toBeLessThanOrEqual(48 * 1024);
    expect(brief.run.reads.find((read) => read.source === "competitors")).toEqual({ source: "competitors", status: "partial", attempted: 10, retained: 10, reason: null });
    expect(beforePacking.units).toHaveLength(60);
  });
});
