import { describe, expect, it, vi } from "vitest";

import { canonicalJson, type GeoCanonicalValue } from "../agents/geo-canonical.ts";
import {
  createKeywordLlmClient,
  KeywordLlmError,
  type KeywordLlmConfig,
  type KeywordLlmFailureReason,
  type KeywordLlmRequest,
} from "../tools/keyword-llm-client.ts";
import { buildGeoKnowledgeEvidenceV1 } from "./kb-knowledge-evidence.ts";
import { GEO_BRIEF_TEMPERATURE } from "./brief-llm.ts";
import { geoV2JsonbBytes } from "./kb-v2-json.ts";
import {
  buildGeoKnowledgeSynthesisInputV2,
  GEO_KNOWLEDGE_SYNTHESIS_INPUT_V2_SCHEMA,
  GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS,
  geoKnowledgeSynthesisInputV2Digest,
  geoKnowledgeSynthesisV2SourceCatalogueDigest,
} from "./kb-knowledge-synthesis-v2-contract.ts";
import {
  GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_VERSION,
  GEO_KNOWLEDGE_SYNTHESIS_V2_RESPONSE_JSON_SCHEMA,
  GEO_KNOWLEDGE_SYNTHESIS_V2_SYSTEM_PROMPT,
} from "./kb-knowledge-synthesis-v2-prompts.ts";
import {
  geoV2NarrativeFixture,
  geoV2ProfileRefFixture,
  geoV2SynthesisInputFixture,
  V2_AT,
  V2_GENERATION_INPUT_HASH,
  V2_HASH,
} from "./kb-knowledge-synthesis-v2-fixtures.ts";
import {
  GEO_KNOWLEDGE_SYNTHESIS_V2_MAX_OUTPUT_TOKENS,
  GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_BYTES,
  GEO_KNOWLEDGE_SYNTHESIS_V2_TIMEOUT_MS,
  prepareGeoKnowledgeSynthesisV2,
  synthesizeGeoKnowledgeNarrativeV2,
} from "./kb-knowledge-synthesis-v2.ts";

const CONFIG: KeywordLlmConfig = {
  apiKey: "offline-secret",
  model: "fixture-model",
  url: "https://fixture.example/completions",
  authScheme: "bearer",
  temperature: null,
};
const USAGE = { inputTokens: 321, outputTokens: 654, requestCount: 1, retryCount: 0 };

const input = () => geoV2SynthesisInputFixture();
const narrative = () => geoV2NarrativeFixture();

function completion(content: unknown) {
  return vi.fn(async (_request: KeywordLlmRequest) => ({
    content: typeof content === "string" ? content : JSON.stringify(content),
    usage: USAGE,
    modelId: "provider-reported-model",
  }));
}

function inputWithLanguage(language: string) {
  const { contentHash: _drop, ...body } = { ...input(), language };
  return { ...body, contentHash: geoKnowledgeSynthesisInputV2Digest(body as never) };
}

/**
 * A synthesis input built field by field rather than through
 * `buildGeoKnowledgeSynthesisInputV2`, so the byte assertion the builder
 * performs is the only thing a case can fail. Excerpt length, source count and
 * competitor arity all stay inside the contract.
 */
const FILL = "e".repeat(1_180);
const excerpts = (tag: string) =>
  Array.from({ length: 8 }, (_, index) => `${tag}-${index} ${FILL}`);

function bigInput(ownPages: number, competitorPages: number) {
  const own = Array.from({ length: ownPages }, (_, index) => ({
    id: `source:own-${index}`,
    kind: "own_page" as const,
    label: `Own page ${index}`,
    url: `https://product.example/p${index}`,
    competitor: null,
    availability: "available" as const,
    reason: null,
    observedAt: V2_AT,
    bodyHash: V2_HASH,
    excerpts: excerpts(`own${index}`),
  }));
  const competitors = Array.from(
    { length: Math.ceil(competitorPages / 2) },
    (_, index) => ({ key: `rival${index}.example`, name: `Rival ${index}`, confirmed: true as const }),
  );
  const rivalSources = Array.from({ length: competitorPages }, (_, index) => {
    const competitor = competitors[Math.floor(index / 2)]!;
    return {
      id: `source:rival-${index}`,
      kind: "competitor_page" as const,
      label: `Rival page ${index}`,
      url: `https://${competitor.key}/page-${index}`,
      competitor,
      availability: "available" as const,
      reason: null,
      observedAt: V2_AT,
      bodyHash: V2_HASH,
      excerpts: excerpts(`riv${index}`),
    };
  });
  const sourceCatalogue = [...own, ...rivalSources];
  const body = {
    schemaVersion: GEO_KNOWLEDGE_SYNTHESIS_INPUT_V2_SCHEMA,
    officialName: "Pine Cloud",
    aliases: ["Pine"],
    categoryTerms: ["Project software"],
    market: "US",
    language: "en-US",
    targetUrl: "https://product.example/",
    profileRef: geoV2ProfileRefFixture(),
    generationInputHash: V2_GENERATION_INPUT_HASH,
    confirmedCompetitors: competitors,
    evidenceContentHash: V2_HASH,
    sourceCatalogueHash: geoKnowledgeSynthesisV2SourceCatalogueDigest(sourceCatalogue as never),
    sourceCatalogue,
  };
  return { ...body, contentHash: geoKnowledgeSynthesisInputV2Digest(body as never) };
}

/**
 * The evidence a fully successful collection produces, at every maximum the
 * evidence contract allows: 8 own pages, 5 competitors at 2 pages each, the
 * three machine endpoints, and 8 excerpts of 1 200 code points on every page
 * source. Built through the real evidence builder, so the shape is one the
 * collector can actually emit rather than one this test invented.
 */
const MAXIMAL_FILL = "e".repeat(1_186);
function maximalEvidence() {
  const excerpts = (tag: string) =>
    Array.from({ length: 8 }, (_, index) => `${tag} line ${index} ${MAXIMAL_FILL}`);
  const own = Array.from({ length: 8 }, (_, index) => ({
    id: `source:own-${index}`, kind: "own_page", label: `Own page ${index}`,
    url: `https://product.example/p${index}`, competitor: null, availability: "available",
    reason: null, observedAt: V2_AT, bodyHash: V2_HASH, excerpts: excerpts(`own${index}`),
  }));
  const competitors = Array.from({ length: 5 }, (_, index) => ({ key: `rival${index}.example`, name: `Rival ${index}`, confirmed: true as const }));
  const rivals = competitors.flatMap((competitor, index) => [0, 1].map((page) => ({
    id: `source:rival-${index}-${page}`, kind: "competitor_page", label: `Rival ${index} page ${page}`,
    url: `https://${competitor.key}/page-${page}`, competitor, availability: "available",
    reason: null, observedAt: V2_AT, bodyHash: V2_HASH, excerpts: excerpts(`riv${index}${page}`),
  })));
  const machine = [
    ["source:robots", "robots", "https://product.example/robots.txt", "User-agent: *"],
    ["source:sitemap", "sitemap", "https://product.example/sitemap.xml", "https://product.example/"],
    ["source:llms", "llms", "https://product.example/llms.txt", "# Pine Cloud"],
  ].map(([id, kind, url, line]) => ({
    id, kind, label: kind, url, competitor: null, availability: "available",
    reason: null, observedAt: V2_AT, bodyHash: V2_HASH, excerpts: [line],
  }));
  return buildGeoKnowledgeEvidenceV1({
    schemaVersion: "marketing-geo-knowledge-evidence.v1", collectedAt: V2_AT,
    targetUrl: "https://product.example/", confirmedCompetitors: competitors,
    availability: "available", limitation: null, pages: [],
    machine: {
      jsonLd: { status: "absent", types: [], sourceRefs: own.map(({ id }) => id) },
      llms: { status: "present", sourceRefs: ["source:llms"] },
      robots: { status: "present", sourceRefs: ["source:robots"] },
      sitemap: { status: "present", sourceRefs: ["source:sitemap"], urlCount: 0, knowledgePagesListed: false, locations: [], truncated: false },
      hreflang: { status: "absent", locales: [], sourceRefs: own.map(({ id }) => id) },
    },
    sourceCatalogue: [...own, ...rivals, ...machine],
  });
}

function maximalInput() {
  return buildGeoKnowledgeSynthesisInputV2({
    officialName: "Pine Cloud", aliases: ["Pine"], categoryTerms: ["Project software"],
    market: "US", language: "en-US", profileRef: geoV2ProfileRefFixture(),
    generationInputHash: V2_GENERATION_INPUT_HASH,
  }, maximalEvidence());
}

/**
 * The largest catalogue this contract admits, sized to sit exactly on
 * `catalogueBytes`: 32 sources with kilobyte-long URLs and 8 excerpts each,
 * whose excerpt length is bisected up to the last code point that still fits.
 */
function catalogueAtBudget() {
  const build = (excerptCodePoints: number) =>
    Array.from({ length: GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.sources }, (_, index) => ({
      id: `source:own-${index}`, kind: "own_page", label: "L".repeat(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.label),
      url: `https://product.example/${"q".repeat(2_000)}${index}`, competitor: null,
      availability: "available", reason: null, observedAt: V2_AT, bodyHash: V2_HASH,
      excerpts: Array.from({ length: GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.excerpts }, (_, line) => `${index}-${line}` + "e".repeat(excerptCodePoints)),
    }));
  const fits = (length: number) => geoV2JsonbBytes(build(length)) <= GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.catalogueBytes;
  let low = 1;
  let high = GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.excerptCodePoints;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return { catalogue: build(low), overBudget: build(low + 1) };
}

describe("GEO knowledge synthesis v2 preflight", () => {
  it("returns a detached, secret-free preflight with exact v2 provider metadata", () => {
    const source = input();
    const prepared = prepareGeoKnowledgeSynthesisV2(source, CONFIG);

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error("Expected a valid preflight");
    expect(prepared.value.input).toEqual(source);
    // Re-parsed, so a caller mutating its own object afterwards cannot change
    // the input the narrative is checked against.
    expect(prepared.value.input).not.toBe(source);
    expect(prepared.value).toMatchObject({
      timeoutMs: GEO_KNOWLEDGE_SYNTHESIS_V2_TIMEOUT_MS,
      promptVersion: GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_VERSION,
      responseJsonSchema: GEO_KNOWLEDGE_SYNTHESIS_V2_RESPONSE_JSON_SCHEMA,
      provider: {
        modelRequested: CONFIG.model,
        modelReported: null,
        authScheme: CONFIG.authScheme,
        effectiveTemperature: GEO_BRIEF_TEMPERATURE,
        maxOutputTokens: GEO_KNOWLEDGE_SYNTHESIS_V2_MAX_OUTPUT_TOKENS,
      },
    });
    expect(prepared.value.prompt.system).toBe(GEO_KNOWLEDGE_SYNTHESIS_V2_SYSTEM_PROMPT);
    expect(prepared.value.prompt.user).toBe(
      canonicalJson(prepared.value.input as unknown as GeoCanonicalValue),
    );
    expect(JSON.stringify(prepared)).not.toContain(CONFIG.apiKey);
  });

  it("buys the v2 prompt and schema, never v1's", () => {
    const prepared = prepareGeoKnowledgeSynthesisV2(input(), CONFIG);
    if (!prepared.ok) throw new Error("Expected a valid preflight");
    expect(prepared.value.promptVersion).toBe("geo-kb-knowledge-pack.v2");
    expect(prepared.value.responseJsonSchema.name).toBe("marketing_geo_knowledge_narrative_v2");
    expect(prepared.value.prompt.user).toContain("marketing-geo-knowledge-synthesis-input.v2");
    expect(prepared.value.prompt.user).not.toContain("marketing-geo-knowledge-synthesis-input.v1");
  });

  it("pins the numbers the adapter buys with", () => {
    // Comparing each constant to itself proves nothing, so these are pinned to
    // literals and, where there is one, to the relationship that makes the
    // number right.
    expect(GEO_KNOWLEDGE_SYNTHESIS_V2_TIMEOUT_MS).toBe(90_000);
    expect(GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_BYTES).toBe(131_072);
    expect(GEO_KNOWLEDGE_SYNTHESIS_V2_MAX_OUTPUT_TOKENS).toBe(32_768);
    // The output budget has to be able to carry a maximum-size narrative. Four
    // bytes per token is a deliberately generous estimate for JSON of this
    // shape; anything tighter would truncate a legal answer after paying for it.
    expect(GEO_KNOWLEDGE_SYNTHESIS_V2_MAX_OUTPUT_TOKENS * 4).toBeGreaterThanOrEqual(
      GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.narrativeBytes,
    );
    // The prompt budget must leave room for a real catalogue: the contract's
    // own input ceiling is the thing it is deliberately tighter than.
    expect(GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_BYTES).toBeLessThan(
      GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBytes,
    );
  });

  it("fits the transport's own response-schema budget", () => {
    // The shared client refuses a response schema over 32 KiB with
    // `not_configured` from inside `complete()`, which this adapter can only
    // report as a possible charge. Keeping the shipped schema under the bound
    // is what stops that phantom attempt from ever being recorded.
    const bytes = new TextEncoder().encode(
      JSON.stringify(GEO_KNOWLEDGE_SYNTHESIS_V2_RESPONSE_JSON_SCHEMA.schema),
    ).byteLength;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(32 * 1024);
  });

  it("refuses invalid config, language, timeout and input before dispatch", async () => {
    const complete = completion(narrative());
    const cases = [
      [input(), null, undefined, "not_configured"],
      [input(), { ...CONFIG, model: "bad model" }, undefined, "not_configured"],
      [input(), { ...CONFIG, apiKey: " " }, undefined, "not_configured"],
      [input(), { ...CONFIG, url: "http://fixture.example/x" }, undefined, "not_configured"],
      [inputWithLanguage("zh-CN"), CONFIG, undefined, "unsupported_language"],
      [{ ...input(), contentHash: V2_HASH }, CONFIG, undefined, "invalid_input"],
      [{ ...input(), generationInputHash: undefined }, CONFIG, undefined, "invalid_input"],
      [input(), CONFIG, 44_999, "not_configured"],
      [input(), CONFIG, 120_001, "not_configured"],
      [input(), CONFIG, Number.NaN, "not_configured"],
    ] as const;

    for (const [source, config, timeoutMs, reason] of cases) {
      expect(
        await synthesizeGeoKnowledgeNarrativeV2(source, { config, timeoutMs, client: { complete } }),
      ).toMatchObject({ ok: false, reason, attemptedCalls: 0, delivery: "not_attempted" });
    }
    expect(complete).not.toHaveBeenCalled();
  });

  it("labels an oversized input by its size, not by the words the contract threw", async () => {
    const oversized = bigInput(8, 10);
    expect(geoV2JsonbBytes(oversized)).toBeGreaterThan(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBytes);
    // Same builder, fewer pages, accepted: so the rejection above is about size
    // and not about some other way the hand-built input is malformed.
    expect(prepareGeoKnowledgeSynthesisV2(bigInput(8, 2), CONFIG).ok).toBe(true);
    const complete = completion(narrative());
    expect(
      await synthesizeGeoKnowledgeNarrativeV2(oversized, { config: CONFIG, client: { complete } }),
    ).toMatchObject({ ok: false, reason: "input_too_large", attemptedCalls: 0, delivery: "not_attempted" });

    // Within budget and malformed for an unrelated reason: still `invalid_input`,
    // so the size label cannot be produced by anything but size.
    const malformed = { ...input(), aliases: ["Pine", "pine"] };
    expect(geoV2JsonbBytes(malformed)).toBeLessThanOrEqual(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBytes);
    expect(
      await synthesizeGeoKnowledgeNarrativeV2(malformed, { config: CONFIG, client: { complete } }),
    ).toMatchObject({ ok: false, reason: "invalid_input", attemptedCalls: 0, delivery: "not_attempted" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("refuses a contract-valid input whose prompt passes the byte budget, before dispatch", async () => {
    const source = bigInput(8, 5);
    // The gap this test exists for: the contract admits this input and the
    // adapter still will not buy it.
    expect(geoV2JsonbBytes(source)).toBeLessThanOrEqual(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBytes);
    const promptBytes = new TextEncoder().encode(
      JSON.stringify({
        prompt: { system: GEO_KNOWLEDGE_SYNTHESIS_V2_SYSTEM_PROMPT, user: canonicalJson(source as unknown as GeoCanonicalValue) },
        responseJsonSchema: GEO_KNOWLEDGE_SYNTHESIS_V2_RESPONSE_JSON_SCHEMA,
      }),
    ).byteLength;
    expect(promptBytes).toBeGreaterThan(GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_BYTES);

    const complete = completion(narrative());
    expect(
      await synthesizeGeoKnowledgeNarrativeV2(source, { config: CONFIG, client: { complete } }),
    ).toMatchObject({ ok: false, reason: "input_too_large", attemptedCalls: 0, delivery: "not_attempted" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("buys the prompt for a full collection instead of refusing it", async () => {
    const evidence = maximalEvidence();
    const collected = evidence.sourceCatalogue.filter((source) => source.availability !== "unavailable");
    // The cliff, measured: the catalogue a completely successful collection
    // produces is on its own past the ceiling for the whole input. Before the
    // contract fitted it, this owner -- the one whose site has the most to say
    // -- got `invalid_input` and no knowledge base, while a thin site
    // synthesised fine.
    expect(collected).toHaveLength(21);
    expect(geoV2JsonbBytes(collected)).toBeGreaterThan(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBytes);

    const source = maximalInput();
    const prepared = prepareGeoKnowledgeSynthesisV2(source, CONFIG);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error("Expected a full collection to be buyable");
    // Every collected source still reaches the model, in the order it was
    // collected: the fit shortens pages, it never drops one.
    expect(prepared.value.input.sourceCatalogue.map(({ id }) => id)).toEqual(collected.map(({ id }) => id));
    // And the shortened ones say so, in the input the hash covers.
    expect(prepared.value.input.sourceCatalogue.filter((entry) => entry.availability === "partial")).toHaveLength(18);
    expect(prepared.value.input.sourceCatalogue.every((entry) => entry.availability === "partial"
      ? entry.reason === "partial_body" : entry.reason === null)).toBe(true);

    const complete = completion(narrative());
    // The fixture narrative cites the small fixture's source ids, so this
    // answer is refused after purchase. What matters here is that the call
    // happened at all: the refusal that used to stand in its place is gone.
    expect(
      await synthesizeGeoKnowledgeNarrativeV2(source, { config: CONFIG, client: { complete } }),
    ).toMatchObject({ ok: false, reason: "schema_invalid", attemptedCalls: 1, delivery: "response_received" });
    expect(complete).toHaveBeenCalledTimes(1);
    const request = complete.mock.calls[0]![0];
    for (const { id } of collected) expect(request.user).toContain(`"${id}"`);
  });

  it("refuses no catalogue that fits its own budget", () => {
    // The two constants have to agree, and the agreement is what makes the
    // fitted catalogue buyable rather than merely smaller. This builds the
    // heaviest input the contract admits at the catalogue budget -- 32 sources
    // with kilobyte URLs, and every other field at its own maximum -- and
    // measures it exactly the way `prepareGeoKnowledgeSynthesisV2` does.
    const { catalogue, overBudget } = catalogueAtBudget();
    expect(geoV2JsonbBytes(catalogue)).toBeLessThanOrEqual(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.catalogueBytes);
    // Sitting on the boundary, not comfortably below it: one more code point
    // per excerpt is over.
    expect(geoV2JsonbBytes(overBudget)).toBeGreaterThan(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.catalogueBytes);

    const limits = GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS;
    const body = {
      schemaVersion: GEO_KNOWLEDGE_SYNTHESIS_INPUT_V2_SCHEMA,
      officialName: "N".repeat(limits.shortText),
      aliases: Array.from({ length: limits.aliases }, (_, index) => `${index}${"A".repeat(limits.shortText - 1)}`),
      categoryTerms: Array.from({ length: limits.categoryTerms }, (_, index) => `${index}${"C".repeat(limits.shortText - 1)}`),
      market: "M".repeat(limits.label), language: "en-US",
      targetUrl: `https://product.example/${"t".repeat(2_023)}`,
      profileRef: geoV2ProfileRefFixture(), generationInputHash: V2_GENERATION_INPUT_HASH,
      confirmedCompetitors: Array.from({ length: limits.competitors }, (_, index) => ({ key: `rival${index}.example`, name: "R".repeat(limits.shortText), confirmed: true })),
      evidenceContentHash: V2_HASH,
      sourceCatalogueHash: geoKnowledgeSynthesisV2SourceCatalogueDigest(catalogue as never),
      sourceCatalogue: catalogue,
    };
    const heaviest = { ...body, contentHash: geoKnowledgeSynthesisInputV2Digest(body as never) };
    const promptBytes = new TextEncoder().encode(
      JSON.stringify({
        prompt: { system: GEO_KNOWLEDGE_SYNTHESIS_V2_SYSTEM_PROMPT, user: canonicalJson(heaviest as unknown as GeoCanonicalValue) },
        responseJsonSchema: GEO_KNOWLEDGE_SYNTHESIS_V2_RESPONSE_JSON_SCHEMA,
      }),
    ).byteLength;
    expect(promptBytes).toBeLessThanOrEqual(GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_BYTES);
  });
});

describe("GEO knowledge synthesis v2 dispatch", () => {
  it("dispatches exactly one strict v2 request and returns usage", async () => {
    const complete = completion(narrative());
    const result = await synthesizeGeoKnowledgeNarrativeV2(input(), { config: CONFIG, client: { complete } });

    expect(result).toMatchObject({
      ok: true,
      value: narrative(),
      usage: USAGE,
      attemptedCalls: 1,
      delivery: "response_received",
      provider: { modelRequested: CONFIG.model, modelReported: null, effectiveTemperature: GEO_BRIEF_TEMPERATURE },
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![0]).toMatchObject({
      temperature: GEO_BRIEF_TEMPERATURE,
      maxOutputTokens: GEO_KNOWLEDGE_SYNTHESIS_V2_MAX_OUTPUT_TOKENS,
      timeoutMs: GEO_KNOWLEDGE_SYNTHESIS_V2_TIMEOUT_MS,
      responseJsonSchema: GEO_KNOWLEDGE_SYNTHESIS_V2_RESPONSE_JSON_SCHEMA,
    });
  });

  it("sends the parsed catalogue and nothing else as the user turn", async () => {
    // The reuse property depends on this: the v2 catalogue is built from
    // on-site receipts, and `evidenceContentHash` covers exactly what the model
    // was shown. Anything this adapter appended would be invisible to that hash.
    const source = input();
    const complete = completion(narrative());
    await synthesizeGeoKnowledgeNarrativeV2(source, { config: CONFIG, client: { complete } });

    const request = complete.mock.calls[0]![0];
    expect(request.system).toBe(GEO_KNOWLEDGE_SYNTHESIS_V2_SYSTEM_PROMPT);
    // Byte-identical, not merely JSON-equal: a trailing space appended by this
    // adapter still parses to the same object, and would still be text the
    // model was shown that no hash covers.
    expect(request.user).toBe(canonicalJson(source as unknown as GeoCanonicalValue));
    expect(JSON.parse(request.user)).toEqual(source);
    expect(Object.keys(request).sort()).toEqual(
      ["maxOutputTokens", "responseJsonSchema", "system", "temperature", "timeoutMs", "user"],
    );
  });

  it("returns the identity fields the merge is built from", async () => {
    const complete = completion(narrative());
    const result = await synthesizeGeoKnowledgeNarrativeV2(input(), { config: CONFIG, client: { complete } });
    if (!result.ok) throw new Error("Expected a narrative");
    expect(result.value.facts.map((fact) => ({ subject: fact.subject, attribute: fact.attribute, qualifiers: fact.qualifiers }))).toEqual([
      { subject: "Pine Cloud", attribute: "Supported team size", qualifiers: [] },
      { subject: "Pine Cloud", attribute: "Monthly price", qualifiers: ["Pro plan"] },
      { subject: "Pine Cloud", attribute: "Monthly price", qualifiers: ["Team plan"] },
      { subject: "Pine Cloud", attribute: "Monthly price", qualifiers: ["Enterprise plan"] },
    ]);
    expect(result.value.qa.map((item) => item.canonicalQuestion)).toEqual([
      "Does Pine Cloud support teams of 2?",
      "What is Pine Cloud?",
    ]);
    // Unavailable is a null value plus a reason, never a zero and never "".
    expect(result.value.facts[3]).toMatchObject({ value: null, reason: "notPublished" });
  });

  it("serializes the v2 schema through the real transport with an offline provider response", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        model: "provider-model",
        usage: { prompt_tokens: 321, completion_tokens: 654 },
        choices: [{ message: { content: JSON.stringify(narrative()) } }],
      }),
    );
    const client = createKeywordLlmClient({ config: CONFIG, fetchImpl });
    expect(await synthesizeGeoKnowledgeNarrativeV2(input(), { config: CONFIG, client })).toMatchObject({
      ok: true,
      usage: USAGE,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "marketing_geo_knowledge_narrative_v2",
        strict: true,
        schema: { properties: { facts: { items: { anyOf: expect.any(Array) } } } },
      },
    });
  });

  it("uses only the pinned GEO Brief configuration and temperature", async () => {
    const complete = completion(narrative());
    expect(
      await synthesizeGeoKnowledgeNarrativeV2(input(), {
        env: { GEO_BRIEF_API_KEY: "offline-secret", GEO_BRIEF_MODEL: "pinned-geo-model", GEO_BRIEF_TEMPERATURE: "1" },
        client: { complete },
      }),
    ).toMatchObject({ ok: true, provider: { modelRequested: "pinned-geo-model", effectiveTemperature: 1 } });
    expect(complete.mock.calls[0]![0].temperature).toBe(1);

    const foreignComplete = completion(narrative());
    expect(
      await synthesizeGeoKnowledgeNarrativeV2(input(), {
        env: { OPENAI_API_KEY: "other", OPENAI_MODEL: "other" },
        client: { complete: foreignComplete },
      }),
    ).toMatchObject({ ok: false, reason: "not_configured", attemptedCalls: 0, delivery: "not_attempted" });
    expect(foreignComplete).not.toHaveBeenCalled();
  });
});

const factCase = (overrides: Record<string, unknown>) => {
  const base = narrative();
  return { ...base, facts: [{ ...base.facts[0], ...overrides }, ...base.facts.slice(1)] };
};

describe("GEO knowledge synthesis v2 provider output", () => {
  it.each([
    ["output that is not JSON", "not JSON", "invalid_response"],
    ["an added top-level key", { ...narrative(), debug: true }, "schema_invalid"],
    ["a model-authored item key", factCase({ itemKey: "facts|feature|pine cloud" }), "schema_invalid"],
    ["a model-authored confidence", factCase({ confidence: "high" }), "schema_invalid"],
    ["a model-authored evidence check", factCase({ evidenceCheck: "cited_and_literals_match" }), "schema_invalid"],
    ["a model-authored origin", factCase({ origin: "declared_owner" }), "schema_invalid"],
    ["an invented source id", factCase({ sourceRefs: ["source:invented"] }), "schema_invalid"],
    ["a number no cited excerpt carries", factCase({ statement: "Pine Cloud supports teams of 99." }), "schema_invalid"],
    ["a value carrying an unavailable reason", factCase({ reason: "notPublished" }), "schema_invalid"],
  ])("refuses %s without a repair call", async (_label, raw, reason) => {
    const complete = completion(raw);
    expect(await synthesizeGeoKnowledgeNarrativeV2(input(), { config: CONFIG, client: { complete } })).toMatchObject({
      ok: false,
      reason,
      usage: USAGE,
      attemptedCalls: 1,
      delivery: "response_received",
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("refuses two facts that share one identity triple", async () => {
    const base = narrative();
    const duplicate = {
      ...base,
      facts: [
        ...base.facts,
        {
          ...base.facts[1]!,
          id: "fact:pro-price-again",
          statement: "The Pro tier costs $9 per month.",
        },
      ],
    };
    const complete = completion(duplicate);
    expect(await synthesizeGeoKnowledgeNarrativeV2(input(), { config: CONFIG, client: { complete } })).toMatchObject({
      ok: false,
      reason: "schema_invalid",
      attemptedCalls: 1,
      delivery: "response_received",
    });
  });

  it("bounds an oversized response before parsing it, without retry", async () => {
    // Deliberately *valid* JSON. A junk string of the same length would fail
    // `JSON.parse` too, so the test would pass with the size guard deleted and
    // prove nothing. Well-formed JSON separates the two: with the guard the
    // answer is `invalid_response` (too big to look at), without it the parse
    // succeeds and the contract answers `schema_invalid` instead.
    const content = JSON.stringify("x".repeat(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.narrativeBytes));
    expect(new TextEncoder().encode(content).byteLength).toBeGreaterThan(
      GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.narrativeBytes,
    );
    expect(() => JSON.parse(content)).not.toThrow();
    const complete = vi.fn(async () => ({ content, usage: USAGE }));
    expect(await synthesizeGeoKnowledgeNarrativeV2(input(), { config: CONFIG, client: { complete } })).toMatchObject({
      ok: false,
      reason: "invalid_response",
      usage: USAGE,
      attemptedCalls: 1,
      delivery: "response_received",
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  /**
   * Every `KeywordLlmFailureReason` and the delivery it must be recorded as.
   *
   * A `Record` over the union rather than a list of the ones somebody thought
   * of: a tenth reason added upstream stops this file compiling instead of
   * being classified by omission. That omission is exactly how
   * `not_configured` went untested -- the shared client raises it from
   * `responseFormat()` and the reasoning-effort check, both of which run before
   * a request is built, so nothing leaves the process. Recording it as
   * `response_received` would write "the provider answered", with
   * `attemptedCalls: 1`, into a durable generation attempt for a call that was
   * never sent.
   */
  const DELIVERY: Record<KeywordLlmFailureReason, "response_received" | "outcome_unknown"> = {
    auth_failed: "response_received",
    rate_limited: "response_received",
    server_error: "response_received",
    bad_request: "response_received",
    invalid_response: "response_received",
    schema_invalid: "response_received",
    not_configured: "outcome_unknown",
    timeout: "outcome_unknown",
    network_error: "outcome_unknown",
  };

  it.each(Object.entries(DELIVERY))("records a thrown %s as %s, once, without retry", async (reason, delivery) => {
    const complete = vi.fn(async () => {
      throw new KeywordLlmError(reason as KeywordLlmFailureReason, "PRIVATE_PROVIDER_DIAGNOSTIC", USAGE);
    });
    const result = await synthesizeGeoKnowledgeNarrativeV2(input(), { config: CONFIG, client: { complete } });
    expect(result).toMatchObject({ ok: false, reason, usage: USAGE, attemptedCalls: 1, delivery });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PROVIDER_DIAGNOSTIC");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("carries an empty usage when the failure reported none", async () => {
    const complete = vi.fn(async () => {
      throw new KeywordLlmError("timeout", "PRIVATE_TRANSPORT_DIAGNOSTIC");
    });
    expect(await synthesizeGeoKnowledgeNarrativeV2(input(), { config: CONFIG, client: { complete } })).toMatchObject({
      ok: false, reason: "timeout", attemptedCalls: 1, delivery: "outcome_unknown",
      usage: { inputTokens: null, outputTokens: null, requestCount: 0, retryCount: 0 },
    });
  });

  it("sanitizes an unexpected transport failure as an unknown outcome", async () => {
    const complete = vi.fn(async () => {
      throw new Error("PRIVATE_UNEXPECTED_DIAGNOSTIC");
    });
    const result = await synthesizeGeoKnowledgeNarrativeV2(input(), { config: CONFIG, client: { complete } });
    expect(result).toMatchObject({ ok: false, reason: "provider_error", attemptedCalls: 1, delivery: "outcome_unknown" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_UNEXPECTED_DIAGNOSTIC");
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
