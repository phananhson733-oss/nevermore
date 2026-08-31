import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { normalizeSeoAuditUrl } from "@sf/public-tools";
import { fetchPublicResource } from "@sf/sources/public-http";
import { consumePublicToolQuota, type SharedQuotaDependencies } from "../tools/shared-rate-limit.ts";
import type { CitabilityAiContext, CitabilityAiReview } from "./citability-ai-contract.ts";
import { createCitabilityAiContext } from "./citability-ai-evidence.ts";
import { buildCitabilityAiTask, CitabilityAiProviderError } from "./citability-ai-provider.ts";
import { handleCitabilityAiRequest, type CitabilityAiHandlerDependencies } from "./citability-ai-handler.ts";

const URL = "https://acme-example-site.com/guide";
const ORIGIN = "https://gengrowth.ai";
const HTML = "<html><body><main>A small team can use the product with at least 5 members.</main></body></html>";
const RAW_SHA = createHash("sha256").update(HTML).digest("hex");
const TIME = "2026-08-31T12:00:00.000Z";
const REQUEST = { url: URL, question: "How many members?", rawSha256: RAW_SHA };
const PAGE = { kind: "ok" as const, requestedUrl: URL, finalUrl: URL, firstStatus: 200, finalStatus: 200,
  redirectChain: [], contentType: "text/html; charset=utf-8", xRobotsTag: null, body: HTML,
  bytes: Buffer.byteLength(HTML), bodyComplete: true };
function post(body: unknown = REQUEST, origin: string | null = ORIGIN): Request {
  return new Request(`${ORIGIN}/api/tools/page-citability-check/ai-review`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(origin === null ? {} : { Origin: origin }) }, body: JSON.stringify(body),
  });
}
function review(context: CitabilityAiContext): CitabilityAiReview {
  return {
    schemaVersion: "citability-ai-review.v1", inputFingerprint: context.inputFingerprint, rawSha256: context.rawSha256,
    finalUrl: context.finalUrl, targetQuestion: context.question, capturedAt: context.capturedAt,
    totalBodyChars: context.totalBodyChars, includedBodyChars: context.includedBodyChars, coverage: context.coverage, excerpts: context.excerpts,
    provider: "dataforseo", requestedModel: "gpt-4.1-mini", actualModel: "gpt-4.1-mini-2025-04-14", providerTaskId: "task-123",
    observedAt: TIME, costUsd: 0.002, inputTokens: 100, outputTokens: 200, factVerification: "not_performed",
    scope: "provided_excerpts", webSearch: false, assessmentKind: "model_assessment", summary: "The excerpt describes team size.",
    dimensions: ["answer_relevance", "answer_clarity", "attribution_clarity"].map((id) => ({
      id: id as "answer_relevance" | "answer_clarity" | "attribution_clarity",
      verdict: "insufficient_evidence", reason: "Only the supplied excerpt was reviewed.", suggestion: null, evidenceIds: [],
    })),
  };
}
function deps(overrides: Partial<CitabilityAiHandlerDependencies> = {}): CitabilityAiHandlerDependencies {
  return {
    authenticate: vi.fn(async () => ({ status: "authenticated" as const, userId: "user-1", email: null, avatarUrl: null })),
    normalizeUrl: normalizeSeoAuditUrl, extractClientIp: () => "203.0.113.8",
    providerConfigured: vi.fn(() => true), providerModel: () => "gpt-4.1-mini",
    fetchResource: vi.fn(async () => PAGE), consumeQuota: vi.fn(async () => ({ kind: "allowed" as const, hits: 1 })),
    preflight: buildCitabilityAiTask, review: vi.fn(async (context) => review(context)), now: () => new Date(TIME), ...overrides,
  };
}
async function expectFailure(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(await response.json()).toMatchObject({ error: { code } });
}

describe("AI review admission", () => {
  it.each([
    { status: "unauthenticated" as const, httpStatus: 401, code: "auth_required" },
    { status: "unavailable" as const, httpStatus: 503, code: "auth_unavailable" },
  ])("refuses $status before fetch, quota, or model work", async ({ status, httpStatus, code }) => {
    const input = deps({ authenticate: async () => ({ status }) });
    await expectFailure(await handleCitabilityAiRequest(post(), input), httpStatus, code);
    expect(input.fetchResource).not.toHaveBeenCalled(); expect(input.consumeQuota).not.toHaveBeenCalled(); expect(input.review).not.toHaveBeenCalled();
  });
  it.each([null, "null", "https://evil.example", "http://gengrowth.ai"])("requires exact browser Origin %j", async (origin) => {
    const input = deps();
    await expectFailure(await handleCitabilityAiRequest(post(REQUEST, origin), input), 403, "invalid_origin");
    expect(input.fetchResource).not.toHaveBeenCalled(); expect(input.consumeQuota).not.toHaveBeenCalled();
  });
  it.each([
    { ...REQUEST, html: HTML }, { ...REQUEST, model: "gpt-5" }, { ...REQUEST, checks: [] },
    { ...REQUEST, rawSha256: "bad" }, { ...REQUEST, rawSha256: "z".repeat(64) },
    { ...REQUEST, question: null }, { ...REQUEST, question: 12 }, { ...REQUEST, question: "q".repeat(513) },
    { url: URL }, [], null,
  ])("rejects malformed or client-evidence fields before side effects %#", async (body) => {
    const input = deps();
    await expectFailure(await handleCitabilityAiRequest(post(body), input), 400, "invalid_request");
    expect(input.fetchResource).not.toHaveBeenCalled(); expect(input.consumeQuota).not.toHaveBeenCalled(); expect(input.review).not.toHaveBeenCalled();
  });
  it("bounds JSON bodies and rejects non-JSON content", async () => {
    await expectFailure(await handleCitabilityAiRequest(post({ ...REQUEST, unexpected: "x".repeat(5000) }), deps()), 413, "payload_too_large");
    const request = new Request(`${ORIGIN}/api/tools/page-citability-check/ai-review`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain" }, body: "{}" });
    await expectFailure(await handleCitabilityAiRequest(request, deps()), 415, "unsupported_media_type");
  });
  it.each(["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data", "https://localhost/", "https://user:pass@acme-example-site.com/", "ftp://acme-example-site.com/"])("rejects unsafe URL %s", async (url) => {
    const input = deps();
    await expectFailure(await handleCitabilityAiRequest(post({ ...REQUEST, url }), input), 400, "invalid_url");
    expect(input.fetchResource).not.toHaveBeenCalled(); expect(input.review).not.toHaveBeenCalled();
  });
  it("refuses missing provider config without fetching or reserving quota", async () => {
    const input = deps({ providerConfigured: () => false });
    await expectFailure(await handleCitabilityAiRequest(post(), input), 503, "provider_unconfigured");
    expect(input.fetchResource).not.toHaveBeenCalled(); expect(input.consumeQuota).not.toHaveBeenCalled(); expect(input.review).not.toHaveBeenCalled();
  });
});

describe("AI review evidence identity", () => {
  it.each([
    { page: { ...PAGE, bodyComplete: false }, status: 422, code: "evidence_incomplete" },
    { page: { ...PAGE, finalStatus: 404 }, status: 422, code: "page_not_ok" },
    { page: { ...PAGE, contentType: "application/pdf" }, status: 422, code: "not_html" },
    { page: { ...PAGE, contentType: null }, status: 422, code: "not_html" },
    { page: { ...PAGE, contentType: "text/html; charset=gb2312" }, status: 422, code: "not_utf8" },
    { page: { ...PAGE, body: "<body>Changed HTML</body>" }, status: 409, code: "evidence_changed" },
    { page: { ...PAGE, finalUrl: `${URL}/other` }, status: 409, code: "evidence_changed" },
    { page: { ...PAGE, finalUrl: "https://another-example-site.com/guide" }, status: 409, code: "evidence_changed" },
  ])("rejects $code without provider dispatch %#", async ({ page, status, code }) => {
    const input = deps({ fetchResource: async () => page });
    await expectFailure(await handleCitabilityAiRequest(post(), input), status, code);
    expect(input.review).not.toHaveBeenCalled();
    expect(vi.mocked(input.consumeQuota).mock.calls.some(([key]) => key.includes(":snapshot:"))).toBe(false);
  });
  it.each([
    { source: "blocked" as const, code: "fetch_blocked", status: 422 },
    { source: "timeout" as const, code: "fetch_timeout", status: 504 },
    { source: "network" as const, code: "fetch_failed", status: 502 },
    { source: "redirect_limit" as const, code: "evidence_changed", status: 409 },
  ])("preserves the safe fetch error $code", async ({ source, code, status }) => {
    const input = deps({ fetchResource: async () => ({ kind: "error", code: source }) });
    await expectFailure(await handleCitabilityAiRequest(post(), input), status, code);
    expect(input.review).not.toHaveBeenCalled();
  });
  it("delegates connect-time DNS/IP rejection to the actual safe fetcher", async () => {
    const network = vi.fn();
    const input = deps({ fetchResource: (url, options) => fetchPublicResource(url, options, {
      guard: async () => ({ safe: false, normalizedUrl: null, pinnedIp: null, reason: "dns_private" }), createDispatcher: vi.fn(), fetch: network,
    }) });
    await expectFailure(await handleCitabilityAiRequest(post(), input), 422, "fetch_blocked");
    expect(network).not.toHaveBeenCalled(); expect(input.review).not.toHaveBeenCalled();
  });
  it("rejects empty server evidence and over-budget model input before snapshot reservation", async () => {
    const html = "<html><body><script>nothing visible</script></body></html>";
    const input = deps({ fetchResource: async () => ({ ...PAGE, body: html }) });
    await expectFailure(await handleCitabilityAiRequest(post({ ...REQUEST, rawSha256: createHash("sha256").update(html).digest("hex") }), input), 422, "evidence_invalid");
    const overBudget = deps({ preflight: () => { throw new CitabilityAiProviderError("input_budget_exceeded"); } });
    await expectFailure(await handleCitabilityAiRequest(post(), overBudget), 422, "input_budget_exceeded");
    expect(overBudget.review).not.toHaveBeenCalled();
    expect(vi.mocked(overBudget.consumeQuota).mock.calls.some(([key]) => key.includes(":snapshot:"))).toBe(false);
  });
});

describe("durable paid admission", () => {
  it("keeps an unknown-outcome reservation across later refetch timestamps and normalized input", async () => {
    const counts = new Map<string, number>();
    const store: SharedQuotaDependencies = { callQuota: async (key, max) => {
      const hits = (counts.get(key) ?? 0) + 1; counts.set(key, hits);
      return { allowed: hits <= max, hits, reset_at: "2026-08-31T13:00:00.000Z" };
    } };
    const paid = vi.fn(async () => { throw new CitabilityAiProviderError("network_error", null, null, true); });
    const input = deps({ review: paid, consumeQuota: (key, max, window) => consumePublicToolQuota(key, max, window, store, () => Date.parse(TIME)) });
    const first = await handleCitabilityAiRequest(post(), input);
    expect(await first.json()).toMatchObject({ error: { code: "provider_network_error" }, outcomeUnknown: true, costUsd: null });
    const second = await handleCitabilityAiRequest(post({ ...REQUEST, url: `${URL}#part`, question: ` ${REQUEST.question} `, rawSha256: RAW_SHA.toUpperCase() }),
      { ...input, now: () => new Date("2026-08-31T12:01:00.000Z") });
    await expectFailure(second, 409, "review_already_requested");
    expect(paid).toHaveBeenCalledTimes(1);
    expect([...counts.keys()].filter((key) => key.includes(":snapshot:"))).toHaveLength(1);
  });

  it("enforces hourly/daily user and hourly IP budgets, then reserves the exact snapshot immediately before dispatch", async () => {
    const events: string[] = [];
    const input = deps({
      consumeQuota: vi.fn(async (key: string) => { events.push(key.includes(":snapshot:") ? "reserve" : "quota"); return { kind: "allowed" as const, hits: 1 }; }),
      fetchResource: async () => { events.push("fetch"); return PAGE; },
      preflight: (context, model) => { events.push("preflight"); return buildCitabilityAiTask(context, model); },
      review: async (context) => { events.push("provider"); return review(context); },
    });
    expect((await handleCitabilityAiRequest(post(), input)).status).toBe(200);
    expect(events).toEqual(["quota", "quota", "quota", "fetch", "preflight", "reserve", "provider"]);
    expect(vi.mocked(input.consumeQuota).mock.calls.map(([, max, window]) => [max, window])).toEqual([[3, 3600], [10, 86400], [10, 3600], [1, 3600]]);
  });
  it.each([0, 1, 2, 3])("fails closed if quota call %i is unavailable", async (blockedCall) => {
    let calls = 0;
    const input = deps({ consumeQuota: async () => calls++ === blockedCall ? { kind: "unavailable", reason: "secret quota configuration" } : { kind: "allowed", hits: 1 } });
    const response = await handleCitabilityAiRequest(post(), input);
    await expectFailure(response, 503, "quota_unavailable"); expect(input.review).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2, 3])("honors limited quota call %i without automatic retry", async (blockedCall) => {
    let calls = 0;
    const input = deps({ consumeQuota: async () => calls++ === blockedCall ? { kind: "limited", retryAfterSeconds: 123 } : { kind: "allowed", hits: 1 } });
    const response = await handleCitabilityAiRequest(post(), input);
    expect(response.headers.get("Retry-After")).toBe("123");
    await expectFailure(response, blockedCall === 3 ? 409 : 429, blockedCall === 3 ? "review_already_requested" : "rate_limited");
    expect(input.review).not.toHaveBeenCalled();
  });
  it("uses a shared atomic reservation across concurrent handler instances", async () => {
    const counts = new Map<string, number>();
    const store: SharedQuotaDependencies = { callQuota: async (key, max) => {
      const hits = (counts.get(key) ?? 0) + 1; counts.set(key, hits);
      return { allowed: hits <= max, hits, reset_at: "2026-08-31T13:00:00.000Z" };
    } };
    const paid = vi.fn(async (context: CitabilityAiContext) => review(context));
    const input = () => deps({ review: paid, consumeQuota: (key, max, window) => consumePublicToolQuota(key, max, window, store, () => Date.parse(TIME)) });
    const responses = await Promise.all([handleCitabilityAiRequest(post(), input()), handleCitabilityAiRequest(post(), input())]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(paid).toHaveBeenCalledTimes(1);
    expect([...counts.keys()].filter((key) => key.includes(":snapshot:"))).toHaveLength(1);
  });
});

describe("AI review receipt and errors", () => {
  it("preserves observed zero cost but drops non-finite cost and unsafe task identifiers", async () => {
    const zero = deps({ review: async () => { throw new CitabilityAiProviderError("provider_error", 0, "task-0"); } });
    expect(await (await handleCitabilityAiRequest(post(), zero)).json()).toMatchObject({ costUsd: 0, providerTaskId: "task-0", outcomeUnknown: false });
    const malformed = deps({ review: async () => { throw new CitabilityAiProviderError("provider_error", Number.NaN, "<script>secret</script>"); } });
    expect(await (await handleCitabilityAiRequest(post(), malformed)).json()).toEqual({
      error: { code: "provider_error" }, costUsd: null, providerTaskId: null, outcomeUnknown: false,
    });
  });

  it.each([
    { rawSha256: "a".repeat(64) }, { finalUrl: "https://different-example-site.com/guide" },
    { inputFingerprint: "b".repeat(64) }, { targetQuestion: "A different question" },
    { capturedAt: "2026-08-31T11:00:00.000Z" }, { requestedModel: "gpt-5" },
  ])("rejects a valid-looking provider receipt bound to different evidence %#", async (patch) => {
    const input = deps({ review: async (context) => ({ ...review(context), ...patch }) });
    const response = await handleCitabilityAiRequest(post(), input);
    await expectFailure(response, 502, "provider_invalid_response");
  });
  it("rejects provider receipts that alter the excerpt text while retaining its IDs", async () => {
    const input = deps({ review: async (context) => ({ ...review(context), excerpts: context.excerpts.map((item) => ({ ...item, text: "Forged evidence" })) }) });
    await expectFailure(await handleCitabilityAiRequest(post(), input), 502, "provider_invalid_response");
  });
  it("returns only the server-derived context and measured provider receipt", async () => {
    const input = deps();
    const response = await handleCitabilityAiRequest(post({ ...REQUEST, question: "  How many members?  ", rawSha256: RAW_SHA.toUpperCase() }), input);
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({ review: review(createCitabilityAiContext({ finalUrl: URL, rawHtml: HTML, targetQuestion: "How many members?", capturedAt: TIME, checks: [] })) });
    expect(input.fetchResource).toHaveBeenCalledWith(URL, { timeoutMs: 8000, maxBodyBytes: 1500000, maxRedirects: 0 });
    expect(input.review).toHaveBeenCalledWith(expect.objectContaining({ checks: [], rawSha256: RAW_SHA, finalUrl: URL, question: "How many members?" }), "gpt-4.1-mini");
  });
  it.each([undefined, "", "   ", "q".repeat(512)])("preserves optional question semantics and the 512-char boundary %#", async (question) => {
    const input = deps();
    expect((await handleCitabilityAiRequest(post({ ...REQUEST, question }), input)).status).toBe(200);
    expect(input.review).toHaveBeenCalledWith(expect.objectContaining({ question: question?.trim() || null }), "gpt-4.1-mini");
  });
  it.each([
    { source: "invalid_response" as const, code: "provider_invalid_response", status: 502 },
    { source: "provider_error" as const, code: "provider_error", status: 502 },
    { source: "network_error" as const, code: "provider_network_error", status: 502 },
    { source: "timeout" as const, code: "provider_timeout", status: 504 },
  ])("preserves $code cost/task/unknown outcome without leaking messages or retrying", async ({ source, code, status }) => {
    const failure = new CitabilityAiProviderError(source, 0.002, "task-failed", true);
    failure.message = "secret provider password and raw body";
    const input = deps({ review: vi.fn(async () => { throw failure; }) });
    const response = await handleCitabilityAiRequest(post(), input);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code }, outcomeUnknown: true, costUsd: 0.002, providerTaskId: "task-failed" });
    expect(input.review).toHaveBeenCalledTimes(1); expect(input.consumeQuota).toHaveBeenCalledTimes(4);
  });
  it("marks unexpected post-dispatch failures as unknown without leaking the exception", async () => {
    const input = deps({ review: vi.fn(async () => { throw new Error("secret provider payload"); }) });
    const response = await handleCitabilityAiRequest(post(), input);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: "provider_error" }, outcomeUnknown: true, costUsd: null, providerTaskId: null });
    expect(input.review).toHaveBeenCalledTimes(1);
  });
  it("sanitizes authentication and quota exceptions before any provider dispatch", async () => {
    const auth = deps({ authenticate: async () => { throw new Error("secret auth config"); } });
    await expectFailure(await handleCitabilityAiRequest(post(), auth), 503, "auth_unavailable");
    const quota = deps({ consumeQuota: async () => { throw new Error("secret quota config"); } });
    await expectFailure(await handleCitabilityAiRequest(post(), quota), 503, "quota_unavailable");
    expect(auth.review).not.toHaveBeenCalled(); expect(quota.review).not.toHaveBeenCalled();
  });
});
