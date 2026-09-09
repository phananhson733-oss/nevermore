import { describe, expect, it } from "vitest";
import { GEO_SYNTHESIS_LIMITS } from "./kb-synthesis-contract.ts";

import {
  emptyMarketingWebsiteProfile,
  MARKETING_WEBSITE_PROFILE_VERSION,
  parseMarketingWebsiteProfile,
  WEBSITE_PROFILE_LIST_MAX_ITEMS,
  WEBSITE_PROFILE_REFERENCE_VERSION,
  type WebsiteProfileReferenceV1,
} from "../account-websites/contracts.ts";
import { buildGeoKnowledgeEvidenceV1 } from "./kb-knowledge-evidence.ts";
import { buildGeoProfileRefV3 } from "./kb-profile-ref-v3.ts";
import { canonicalGeoV2Text, geoV2JsonbBytes } from "./kb-v2-json.ts";
import {
  buildGeoKnowledgeGenerationResultV2,
  buildGeoKnowledgeSynthesisInputV2,
  GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS,
  GeoKnowledgeSynthesisInputTooLargeError,
  geoKnowledgeSynthesisInputV2Digest,
  geoKnowledgeSynthesisV2CatalogueBudget,
  geoKnowledgeSynthesisV2CataloguePromptBudget,
  geoKnowledgeSynthesisV2NonCatalogueBytes,
  geoKnowledgeSynthesisV2NonCataloguePromptBytes,
  geoKnowledgeSynthesisV2SourceCatalogueDigest,
  parseGeoKnowledgeGenerationResultV2,
  parseGeoKnowledgeNarrativeV2,
  parseGeoKnowledgeSynthesisInputV2,
  projectGeoKnowledgeSynthesisV2Catalogue,
} from "./kb-knowledge-synthesis-v2-contract.ts";
import {
  buildGeoKnowledgeSynthesisV2Prompt,
  GEO_KNOWLEDGE_SYNTHESIS_V2_RESPONSE_JSON_SCHEMA,
  GEO_KNOWLEDGE_SYNTHESIS_V2_SYSTEM_PROMPT,
} from "./kb-knowledge-synthesis-v2-prompts.ts";
import {
  GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_BYTES,
  prepareGeoKnowledgeSynthesisV2,
} from "./kb-knowledge-synthesis-v2.ts";
import type { KeywordLlmConfig } from "../tools/keyword-llm-client.ts";
import {
  geoV2EvidenceFixture,
  geoV2NarrativeFixture,
  geoV2ProfileRefFixture,
  geoV2SynthesisInputFixture,
  V2_AT,
  V2_GENERATION_ID,
  V2_GENERATION_INPUT_HASH,
  V2_HASH,
  V2_KB_ID,
  V2_SNAPSHOT_ID,
  V2_WEBSITE_ID,
} from "./kb-knowledge-synthesis-v2-fixtures.ts";

/**
 * The exact request the adapter measures, built with the real prompt module.
 *
 * Every prompt-byte claim below goes through this rather than through an
 * arithmetic model of it: the projection's whole job is to predict this number,
 * and a test that re-implemented it would only prove the model agrees with
 * itself.
 */
function requestBytes(input: Parameters<typeof buildGeoKnowledgeSynthesisV2Prompt>[0]): number {
  return new TextEncoder().encode(JSON.stringify({
    prompt: buildGeoKnowledgeSynthesisV2Prompt(input),
    responseJsonSchema: GEO_KNOWLEDGE_SYNTHESIS_V2_RESPONSE_JSON_SCHEMA,
  })).byteLength;
}

/** A usable provider config, so a refusal is never `not_configured` by accident. */
const LLM_CONFIG: KeywordLlmConfig = {
  apiKey: "offline-secret", model: "fixture-model",
  url: "https://fixture.example/completions", authScheme: "bearer", temperature: null,
};

/**
 * Text that is visibly empty but passes every length and control-character
 * bound: identity normalisation folds it to nothing, which is exactly the
 * input that would put an empty part in an item key.
 */
const INVISIBLE = "\u200b";

const evidence = geoV2EvidenceFixture;
const input = geoV2SynthesisInputFixture;
const narrative = geoV2NarrativeFixture;

function result() {
  const synthesisInput = input();
  return buildGeoKnowledgeGenerationResultV2({
    schemaVersion: "marketing-geo-knowledge-generation-result.v2",
    generationId: V2_GENERATION_ID,
    kbId: V2_KB_ID,
    manifest: {
      schemaVersion: "marketing-geo-knowledge-generation-input.v2",
      kbId: V2_KB_ID,
      baseDraftVersion: "4",
      baseDraftHash: V2_HASH,
      generationInputHash: V2_GENERATION_INPUT_HASH,
      sourceReceiptRefs: [],
      knowledgeSynthesisInput: synthesisInput,
    },
    synthesisInput,
    evidence: evidence(),
    narrative: narrative(),
    generatedAt: "2026-09-04T08:00:00.000Z",
  });
}

describe("GEO knowledge synthesis input v2", () => {
  it("carries the profile reference and the locked generation identity, and projects only usable sources", () => {
    const first = input();
    expect(first.schemaVersion).toBe("marketing-geo-knowledge-synthesis-input.v2");
    expect(first.targetUrl).toBe("https://product.example/");
    expect(first.profileRef).toEqual(geoV2ProfileRefFixture());
    expect(first.generationInputHash).toBe(V2_GENERATION_INPUT_HASH);
    // The unavailable llms.txt source is dropped, exactly as v1 dropped it.
    expect(first.sourceCatalogue.map(({ id }) => id)).toEqual(["source:own", "source:rival", "source:robots", "source:sitemap"]);
    expect(first.evidenceContentHash).toBe(evidence().contentHash);
    expect(parseGeoKnowledgeSynthesisInputV2(first)).toEqual(first);
    const { contentHash: _contentHash, ...body } = first;
    expect(geoKnowledgeSynthesisInputV2Digest(body)).toBe(first.contentHash);
    expect(geoV2JsonbBytes(first)).toBeLessThanOrEqual(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBytes);
  });

  it("accepts an entity id whose UUID version bits are not 1 through 5", () => {
    const profileRef: any = geoV2ProfileRefFixture();
    profileRef.websiteId = "1f08f279-3b6c-9d4e-1a1b-2c3d4e5f6a7b";
    const value = buildGeoKnowledgeSynthesisInputV2({
      officialName: "Pine Cloud", aliases: ["Pine"], categoryTerms: ["Project software"],
      market: "US", language: "en-US", profileRef, generationInputHash: V2_GENERATION_INPUT_HASH,
    }, evidence());
    expect(value.profileRef.websiteId).toBe("1f08f279-3b6c-9d4e-1a1b-2c3d4e5f6a7b");
  });

  it.each([
    ["a tampered content hash", (value: any) => { value.contentHash = V2_HASH; }],
    ["a tampered source catalogue hash", (value: any) => { value.sourceCatalogueHash = V2_HASH; }],
    ["a missing profile reference", (value: any) => { delete value.profileRef; }],
    ["a profile reference that is not the confirmed subset", (value: any) => { value.profileRef.subset.unexpected = "x"; }],
    ["a generation input hash that is not a digest", (value: any) => { value.generationInputHash = "not-a-hash"; }],
    ["a v1 profile copy", (value: any) => { value.profileCopy = { productName: "Pine Cloud" }; }],
    ["a foreign own-site source", (value: any) => {
      value.sourceCatalogue[0].url = "https://foreign.example/";
      value.sourceCatalogueHash = geoKnowledgeSynthesisV2SourceCatalogueDigest(value.sourceCatalogue);
    }],
    ["an unavailable source in the catalogue", (value: any) => { value.sourceCatalogue[0].availability = "unavailable"; }],
    ["a duplicate source id", (value: any) => { value.sourceCatalogue[1].id = value.sourceCatalogue[0].id; }],
  ])("rejects %s", (_label, mutate) => {
    const value: any = input();
    mutate(value);
    expect(() => parseGeoKnowledgeSynthesisInputV2(value)).toThrow();
  });
});

/**
 * The catalogue a fully successful collection produces, at every maximum the
 * evidence contract allows: 8 own pages, 5 competitors at 2 pages each, and the
 * three machine endpoints, with 8 excerpts of 1 200 code points on every page
 * source. Hand-built rather than collected, because the point is the shape, not
 * the crawl.
 */
const MAXIMAL_FILL = "e".repeat(1_186);
function maximalCatalogue(fill = MAXIMAL_FILL) {
  const excerpts = (tag: string) =>
    Array.from({ length: 8 }, (_, index) => `${tag} line ${index} ${fill}`);
  const own = Array.from({ length: 8 }, (_, index) => ({
    id: `source:own-${index}`, kind: "own_page", label: `Own page ${index}`,
    url: `https://product.example/p${index}`, competitor: null, availability: "available",
    reason: null, observedAt: V2_AT, bodyHash: V2_HASH, excerpts: excerpts(`own${index}`),
  }));
  const rivals = Array.from({ length: 5 }, (_, index) => ({ key: `rival${index}.example`, name: `Rival ${index}`, confirmed: true }))
    .flatMap((competitor, index) => [0, 1].map((page) => ({
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
  return [...own, ...rivals, ...machine] as never;
}

/**
 * The same catalogue as a collected evidence bundle, machine summaries and all.
 *
 * `fill` is one character repeated to fill each excerpt. It is a parameter
 * because escaping is the second axis this budget has to survive: the same
 * 1 200 code points of page text cost one byte each in storage and four each in
 * a request when they are quotation marks, and pages that carry markup, JSON or
 * quoted copy are the ones a knowledge base most wants.
 */
function maximalEvidence(fill?: string) {
  const sourceCatalogue: readonly any[] = maximalCatalogue(fill === undefined ? undefined : fill.repeat(1_186));
  const ownRefs = sourceCatalogue.filter(({ kind }) => kind === "own_page").map(({ id }) => id);
  const confirmedCompetitors = [...new Map(sourceCatalogue.flatMap((source) =>
    source.competitor === null ? [] : [[source.competitor.key, source.competitor] as const])).values()];
  return buildGeoKnowledgeEvidenceV1({
    schemaVersion: "marketing-geo-knowledge-evidence.v1", collectedAt: V2_AT,
    targetUrl: "https://product.example/", confirmedCompetitors,
    availability: "available", limitation: null, pages: [],
    machine: {
      jsonLd: { status: "absent", types: [], sourceRefs: ownRefs },
      llms: { status: "present", sourceRefs: ["source:llms"] },
      robots: { status: "present", sourceRefs: ["source:robots"] },
      sitemap: { status: "present", sourceRefs: ["source:sitemap"], urlCount: 0, knowledgePagesListed: false, locations: [], truncated: false },
      hreflang: { status: "absent", locales: [], sourceRefs: ownRefs },
    },
    sourceCatalogue,
  });
}

/**
 * `profileRef` at every maximum `geoProfileRefSchema` admits: five 2 000-unit
 * strings, five 64-item arrays of 500-unit strings, and three provenance rows
 * carrying a 2 048-unit URL each.
 *
 * This is the half of the input budget that was never fitted. The old constant
 * was justified against "every other field of this contract at its maximum",
 * which held this field at `geoV2ProfileRefFixture()` -- 954 bytes against a
 * schema maximum 187 times larger, and larger on its own than the ceiling for
 * the entire input.
 */
function maximalProfileRef(fill = "x") {
  const t = (n: number) => fill.repeat(n);
  const a = (count: number, length: number) =>
    Array.from({ length: count }, (_, index) => `${index}` + t(length - String(index).length));
  return {
    ...geoV2ProfileRefFixture(),
    snapshotRevision: "9".repeat(16),
    subset: {
      productName: t(160),
      oneLinePositioning: t(2_000),
      coreFeatures: a(64, 500),
      country: t(8),
      locale: t(35),
      categories: a(64, 500),
      buyer: t(2_000),
      primaryIcp: t(2_000),
      triggerPain: t(2_000),
      icpPain: t(2_000),
      qualificationSignals: a(64, 500),
      icpInterests: a(64, 500),
      directCompetitors: a(64, 500),
      fieldProvenance: [
        { path: "/productName" as const, derivation: "declared" as const, observedAt: t(40), evidenceUrl: t(2_048) },
        { path: "/oneLinePositioning" as const, derivation: "observed" as const, observedAt: t(40), evidenceUrl: t(2_048) },
        { path: "/coreFeatures" as const, derivation: "inferred" as const, observedAt: t(40), evidenceUrl: t(2_048) },
      ],
    },
  };
}

/**
 * A profile between the two: bigger than any fixture, and at 32 entries per
 * list exactly what the Website Profile the subset is projected from can
 * already hold -- `WEBSITE_PROFILE_LIST_MAX_ITEMS` is 32 and each entry may be
 * 500 characters, so this is not a schema curiosity but a Profile an owner can
 * fill in today. (`geoProfileRefSchema` admits 64, twice what produces it.)
 */
const HEAVY_PROFILE_LIST_FIELDS = ["coreFeatures", "categories", "qualificationSignals", "icpInterests", "directCompetitors"] as const;
function heavyProfileRef(itemsPerArray: number) {
  const subset: any = { ...geoV2ProfileRefFixture().subset };
  for (const [index, field] of HEAVY_PROFILE_LIST_FIELDS.entries()) {
    subset[field] = Array.from({ length: itemsPerArray }, (_, item) => {
      const prefix = `${index}-${item}-`;
      return prefix + "d".repeat(500 - prefix.length);
    });
  }
  return { ...geoV2ProfileRefFixture(), subset };
}

/**
 * The largest `profileRef` an owner can actually produce, built the way the
 * product builds one.
 *
 * Not hand-written against `geoProfileRefSchema`: a real
 * `MarketingWebsiteProfileV1` is filled to every bound the Website Profile
 * itself enforces and then run through `parseMarketingWebsiteProfile` and
 * `buildGeoProfileRefV3`. That is what makes "this Profile exceeds no product
 * limit" a fact of this test rather than a claim in its name -- if any of these
 * values were over a Profile bound, the parser would refuse it here.
 *
 * The bounds, all from `../account-websites/contracts.ts`: `boundedText` is
 * 2 000, `boundedList` is `WEBSITE_PROFILE_LIST_MAX_ITEMS` entries of 500,
 * `productName` is 160, and an evidence URL is `MAX_URL_LENGTH` = 2 048. Three
 * provenance rows, because `geoProfileSubset` keeps exactly the three paths
 * GEO reads and the Profile allows one row per path.
 */
function productMaximumProfileRef() {
  const list = (seed: string) => Array.from(
    { length: WEBSITE_PROFILE_LIST_MAX_ITEMS },
    (_, index) => `${seed}${index}-` + "d".repeat(500 - `${seed}${index}-`.length),
  );
  const profile = parseMarketingWebsiteProfile({
    ...emptyMarketingWebsiteProfile(),
    productName: "p".repeat(160),
    oneLinePositioning: "o".repeat(2_000), buyer: "b".repeat(2_000), primaryIcp: "i".repeat(2_000),
    triggerPain: "t".repeat(2_000), icpPain: "n".repeat(2_000),
    coreFeatures: list("cf"), categories: list("ct"), qualificationSignals: list("qs"),
    icpInterests: list("ii"), directCompetitors: list("dc"),
    country: "US", locale: "en-US",
    fieldProvenance: (["/productName", "/oneLinePositioning", "/coreFeatures"] as const).map((path, index) => ({
      path, derivation: "observed" as const, confidence: "high" as const, source: "public_page" as const,
      limitation: null, observedAt: V2_AT,
      evidenceUrls: ["https://product.example/" + "u".repeat(2_048 - 25) + `${index}`],
    })),
  });
  const reference: WebsiteProfileReferenceV1 = {
    schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION, websiteId: V2_WEBSITE_ID, snapshotId: V2_SNAPSHOT_ID,
    snapshotRevision: 3, profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION, profileHash: "b".repeat(64),
  };
  const built = buildGeoProfileRefV3(reference, profile);
  if (built.kind !== "ok") throw new Error(`Profile refused by the reference projection: ${built.fields.join(", ")}`);
  return built.profileRef;
}

function synthesisInputWith(profileRef: unknown, evidenceValue: any, aliases: readonly string[] = ["Pine"]) {
  return buildGeoKnowledgeSynthesisInputV2({
    officialName: "Pine Cloud", aliases, categoryTerms: ["Project software"],
    market: "US", language: "en-US", profileRef, generationInputHash: V2_GENERATION_INPUT_HASH,
  }, evidenceValue);
}

/**
 * A narrative that is legal against any catalogue carrying `source:own-0`:
 * no numbers, so no literal has to be supported, and no proper name beyond the
 * product's own. It exists to let a whole generation result be assembled around
 * a fitted catalogue.
 */
function plainNarrative() {
  return {
    schemaVersion: "marketing-geo-knowledge-narrative.v2",
    entity: {
      definitions: {
        w25: "Pine Cloud is project software for small teams.",
        w55: "Pine Cloud is project software for small teams that require approval.",
        w120: "Pine Cloud is project software for small teams whose work requires approval before it ships.",
      },
      audience: { who: "Small operations teams", notFor: null },
      founded: { year: null, team: null, location: null },
      disambiguation: null,
      sourceRefs: ["source:own-0"],
    },
    facts: [], qa: [], comparisons: [],
    scope: {
      does: [{ id: "scope:does", text: "Routes approvals to a named reviewer.", sourceRefs: ["source:own-0"] }],
      doesNot: [], needsHuman: [], misconceptions: [],
    },
  };
}

describe("GEO knowledge synthesis v2 catalogue projection", () => {
  it("leaves a catalogue that already fits exactly as it was collected", () => {
    const usable = evidence().sourceCatalogue.filter((source) => source.availability !== "unavailable");
    const projection = projectGeoKnowledgeSynthesisV2Catalogue(usable, input());

    expect(projection.excerptCap).toBe(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.excerpts);
    expect(projection.trimmedSourceIds).toEqual([]);
    expect(projection.droppedExcerpts).toBe(0);
    // Not merely equal in size: the same sources, including the one the
    // collector had already declared partial, with the reason it gave.
    expect(projection.catalogue).toEqual(usable);
    expect(input().sourceCatalogue).toEqual(usable);
  });

  it("fits a full collection instead of refusing it, keeping every source and saying which it shortened", () => {
    const sources: readonly any[] = maximalEvidence().sourceCatalogue;
    // The cliff this projection exists for, measured rather than asserted: the
    // catalogue alone is past the ceiling for the whole input, so before the
    // projection `buildGeoKnowledgeSynthesisInputV2` threw on a collection that
    // succeeded completely.
    expect(geoV2JsonbBytes(sources)).toBeGreaterThan(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBytes);

    const projection = projectGeoKnowledgeSynthesisV2Catalogue(sources as never, input());
    expect(projection.excerptCap).toBe(4);
    expect(projection.fits).toBe(true);
    expect(geoV2JsonbBytes(projection.catalogue)).toBeLessThanOrEqual(
      GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.catalogueBytes,
    );
    // Nothing is dropped: 18 page sources plus the three machine endpoints, in
    // the order they were collected.
    expect(projection.catalogue.map((source) => source.id)).toEqual(sources.map((source) => source.id));
    // 18 page sources lost four excerpts each; the three one-line machine
    // sources lost none. Pinned, not recomputed from the cap.
    expect(projection.droppedExcerpts).toBe(72);
    expect(projection.trimmedSourceIds).toEqual(sources.slice(0, 18).map((source) => source.id));

    for (const [index, source] of projection.catalogue.entries()) {
      const collected: any = sources[index];
      if (index < 18) {
        // The leading excerpts, in document order, and said out loud.
        expect(source.excerpts).toEqual(collected.excerpts.slice(0, 4));
        expect(source).toMatchObject({ availability: "partial", reason: "partial_body" });
      } else {
        expect(source).toEqual(collected);
        expect(source).toMatchObject({ availability: "available", reason: null });
      }
    }
  });

  it("refuses a result whose synthesis input shows more evidence than its own evidence holds", () => {
    const value: any = JSON.parse(JSON.stringify(result()));
    // An extra excerpt smuggled into the paid input: every literal the
    // narrative cites is still supported, so nothing else can refuse it, and
    // the model was shown a page the stored evidence does not contain.
    value.synthesisInput.sourceCatalogue[0].excerpts.push("Pine Cloud ships on Fridays.");
    value.synthesisInput.sourceCatalogueHash = geoKnowledgeSynthesisV2SourceCatalogueDigest(value.synthesisInput.sourceCatalogue);
    const { contentHash: _drop, ...body } = value.synthesisInput;
    value.synthesisInput.contentHash = geoKnowledgeSynthesisInputV2Digest(body);
    value.manifest.knowledgeSynthesisInput = value.synthesisInput;

    expect(() => parseGeoKnowledgeGenerationResultV2(value)).toThrow(/projection mismatch/iu);
  });

  it("accepts a result whose synthesis input is the fitted projection of a collection too large to send whole", () => {
    const evidenceValue = maximalEvidence();
    const synthesisInput = buildGeoKnowledgeSynthesisInputV2({
      officialName: "Pine Cloud", aliases: ["Pine"], categoryTerms: ["Project software"],
      market: "US", language: "en-US", profileRef: geoV2ProfileRefFixture(),
      generationInputHash: V2_GENERATION_INPUT_HASH,
    }, evidenceValue);
    // The input really is shorter than the evidence it came from -- otherwise
    // this would pass under a plain equality check too and prove nothing.
    expect(synthesisInput.sourceCatalogue[0]!.excerpts.length)
      .toBeLessThan(evidenceValue.sourceCatalogue[0]!.excerpts.length);

    const value = buildGeoKnowledgeGenerationResultV2({
      schemaVersion: "marketing-geo-knowledge-generation-result.v2",
      generationId: V2_GENERATION_ID, kbId: V2_KB_ID,
      manifest: {
        schemaVersion: "marketing-geo-knowledge-generation-input.v2", kbId: V2_KB_ID,
        baseDraftVersion: "4", baseDraftHash: V2_HASH,
        generationInputHash: V2_GENERATION_INPUT_HASH, sourceReceiptRefs: [],
        knowledgeSynthesisInput: synthesisInput,
      },
      synthesisInput, evidence: evidenceValue, narrative: plainNarrative(),
      generatedAt: "2026-09-04T08:00:00.000Z",
    });
    expect(parseGeoKnowledgeGenerationResultV2(value)).toEqual(value);
  });
});

/**
 * The budget the projection spends is a composite: the prompt holds the
 * catalogue *and* everything else in the input. These rebuild the other half at
 * the sizes the schema actually admits rather than at the size of a fixture.
 */
describe("GEO knowledge synthesis v2 catalogue budget", () => {
  it("is fitted against a profile reference that alone outweighs the whole input ceiling", () => {
    // The measurement the old constant's justification skipped. Not asserted
    // against the constant it is meant to falsify: the comparison is against
    // the ceiling for the entire input, which this one field passes on its own.
    expect(geoV2JsonbBytes(maximalProfileRef())).toBeGreaterThan(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBytes);
    // Held here during that fitting, three orders of magnitude smaller.
    expect(geoV2JsonbBytes(geoV2ProfileRefFixture())).toBeLessThan(1_000);
  });

  it("gives a thin input the whole catalogue ceiling and a heavy one only what is left", () => {
    const { catalogueBytes, inputBudgetBytes } = GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS;
    // A fixture-sized rest is under the old assumption, so nothing shrinks.
    expect(geoKnowledgeSynthesisV2CatalogueBudget(1_931)).toBe(catalogueBytes);
    expect(geoKnowledgeSynthesisV2CatalogueBudget(9_279)).toBe(catalogueBytes);
    // One byte past it, the catalogue starts paying. Pinned literally rather
    // than recomputed from the constants, which would assert nothing.
    expect(geoKnowledgeSynthesisV2CatalogueBudget(9_280)).toBe(102_399);
    expect(geoKnowledgeSynthesisV2CatalogueBudget(30_000)).toBe(81_679);
    expect(geoKnowledgeSynthesisV2CatalogueBudget(80_000)).toBe(31_679);
    // Below zero rather than clamped to it: a floor here would report a budget
    // that does not exist, and the projection would call an oversized
    // catalogue a fitted one.
    expect(geoKnowledgeSynthesisV2CatalogueBudget(inputBudgetBytes + 3)).toBeLessThan(0);
  });

  it("refuses to compute either budget from a size that was never measured", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      expect(() => geoKnowledgeSynthesisV2CatalogueBudget(bad)).toThrow(/measured non-catalogue size/iu);
      expect(() => geoKnowledgeSynthesisV2CataloguePromptBudget(bad)).toThrow(/measured non-catalogue size/iu);
    }
    // Zero is a measurement, not an absence, and stays legal.
    expect(geoKnowledgeSynthesisV2CatalogueBudget(0)).toBe(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.catalogueBytes);
    // Pinned literally, not recomputed from the two constants it is made of,
    // which would assert nothing about either of them.
    expect(geoKnowledgeSynthesisV2CataloguePromptBudget(0)).toBe(116_740);
  });

  it("takes the rest of the input, not a number someone measured in whichever unit came to hand", () => {
    // The projection reads both sizes off the fields itself, so the two units
    // cannot be mixed up at a call site. Shown by changing one profile field
    // and watching both budgets move -- not by handing it two numbers.
    const sources = evidence().sourceCatalogue.filter((source) => source.availability !== "unavailable");
    const thin = projectGeoKnowledgeSynthesisV2Catalogue(sources, input());
    const heavy = projectGeoKnowledgeSynthesisV2Catalogue(sources, synthesisInputWith(heavyProfileRef(24), evidence()));
    expect(heavy.budgetBytes).toBeLessThan(thin.budgetBytes);
    expect(heavy.promptBudgetBytes).toBeLessThan(thin.promptBudgetBytes);
    // And the two are genuinely different measurements of the same fields:
    // escaping makes the prompt half larger than the storage half.
    expect(geoKnowledgeSynthesisV2NonCataloguePromptBytes(input()))
      .toBeGreaterThan(0);
    expect(geoKnowledgeSynthesisV2NonCataloguePromptBytes(input()))
      .not.toBe(geoKnowledgeSynthesisV2NonCatalogueBytes(input()));
  });

  it("prices the rest of the input in bytes, not in code points", () => {
    // `geoBoundedText` bounds code points, so twelve aliases of 200 code points
    // are 2 400 bytes of ASCII and 9 588 of four-byte characters. A budget
    // fitted on "every other field at its maximum" in ASCII is not fitted on
    // the maximum at all.
    const alias = (fill: string) =>
      Array.from({ length: 12 }, (_, index) => `${index}` + fill.repeat(200 - String(index).length));
    const plain = geoKnowledgeSynthesisV2NonCatalogueBytes(synthesisInputWith(geoV2ProfileRefFixture(), evidence(), alias("a")));
    const wide = geoKnowledgeSynthesisV2NonCatalogueBytes(synthesisInputWith(geoV2ProfileRefFixture(), evidence(), alias("\u{1F600}")));
    // Ten aliases carry 199 wide code points and two carry 198, each three
    // bytes heavier than the ASCII it replaces: 3 * (10 * 199 + 2 * 198).
    expect(wide - plain).toBe(7_158);
    // And the extra weight really is taken out of the catalogue, not ignored.
    expect(geoKnowledgeSynthesisV2CatalogueBudget(wide)).toBeLessThan(geoKnowledgeSynthesisV2CatalogueBudget(plain) + 1);
  });

  it("measures every field the catalogue does not determine", () => {
    // Re-derived by spreading a parsed input, so a field the measure forgets to
    // name changes one side and not the other.
    const value = input();
    const placeholder = "0".repeat(64);
    expect(geoKnowledgeSynthesisV2NonCatalogueBytes(value)).toBe(geoV2JsonbBytes({
      ...value, sourceCatalogue: [], sourceCatalogueHash: placeholder, contentHash: placeholder,
    }));
  });

  it("shows every source fewer excerpts as the rest of the input grows, and drops none", () => {
    const evidenceValue = maximalEvidence();
    const sources: readonly any[] = evidenceValue.sourceCatalogue;
    // Four real Profiles of increasing size, each one reached through the real
    // builder rather than by handing the projection a number, and each one
    // inside `WEBSITE_PROFILE_LIST_MAX_ITEMS`.
    const projections = [1, 8, 16, 24]
      .map((items) => synthesisInputWith(heavyProfileRef(items), evidenceValue))
      .map((value) => projectGeoKnowledgeSynthesisV2Catalogue(sources as never, value));
    // Measured from the catalogue, not derived from the budget constants: at
    // the old fixed budget every one of these was 4.
    expect(projections.map((projection) => projection.excerptCap)).toEqual([4, 3, 2, 1]);
    for (const projection of projections) {
      expect(projection.fits).toBe(true);
      expect(projection.catalogueBytes).toBeLessThanOrEqual(projection.budgetBytes);
      // No source is dropped, in any of them.
      expect(projection.catalogue.map((source) => source.id)).toEqual(sources.map((source) => source.id));
    }
    // No excerpt is truncated either: what is kept is a prefix of what was
    // collected, verbatim.
    for (const [index, source] of projections[3]!.catalogue.entries()) {
      expect(source.excerpts).toEqual(sources[index]!.excerpts.slice(0, source.excerpts.length));
      if (sources[index]!.excerpts.length > source.excerpts.length) {
        expect(source).toMatchObject({ availability: "partial", reason: "partial_body" });
      }
    }
  });

  it("fits a full collection beside a profile the old constant would have refused", () => {
    const evidenceValue = maximalEvidence();
    const profileRef = heavyProfileRef(32);
    const value = synthesisInputWith(profileRef, evidenceValue);
    const nonCatalogueBytes = geoKnowledgeSynthesisV2NonCatalogueBytes(value);
    expect(nonCatalogueBytes).toBeGreaterThan(70_000);
    // What the old constant would have produced: the catalogue at the cap a
    // fixture-sized profile buys, beside this profile, is past the ceiling the
    // builder enforces -- so before this change the owner of a content-rich
    // site with a long feature list got `invalid_input` and no knowledge base.
    const unfitted = projectGeoKnowledgeSynthesisV2Catalogue(
      evidenceValue.sourceCatalogue as never, input(),
    );
    expect(unfitted.excerptCap).toBe(4);
    expect(nonCatalogueBytes - 2 + unfitted.catalogueBytes)
      .toBeGreaterThan(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBytes);

    // What it produces now: one excerpt per source, every source present, and
    // an input inside the budget the prompt was fitted to.
    expect(value.sourceCatalogue.map((source) => source.id))
      .toEqual(evidenceValue.sourceCatalogue.map((source) => source.id));
    expect(value.sourceCatalogue.every((source) => source.excerpts.length === 1)).toBe(true);
    expect(geoV2JsonbBytes(value)).toBeLessThanOrEqual(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBudgetBytes);
    // Shortened, and saying so, rather than quietly complete.
    for (const source of value.sourceCatalogue) {
      const collected = evidenceValue.sourceCatalogue.find((candidate) => candidate.id === source.id);
      expect(source.excerpts).toEqual(collected!.excerpts.slice(0, 1));
      if (collected!.excerpts.length > 1) expect(source).toMatchObject({ availability: "partial", reason: "partial_body" });
    }
  });

  it("re-derives the projection of a stored result from the budget that record's own fields leave", () => {
    const evidenceValue = maximalEvidence();
    const synthesisInput = synthesisInputWith(heavyProfileRef(32), evidenceValue);
    // Not the cap a fixture-sized profile buys, so an unchanged re-derivation
    // in `parseResultBody` would disagree and this would be refused.
    expect(synthesisInput.sourceCatalogue[0]!.excerpts.length).toBe(1);
    const value = buildGeoKnowledgeGenerationResultV2({
      schemaVersion: "marketing-geo-knowledge-generation-result.v2",
      generationId: V2_GENERATION_ID, kbId: V2_KB_ID,
      manifest: {
        schemaVersion: "marketing-geo-knowledge-generation-input.v2", kbId: V2_KB_ID,
        baseDraftVersion: "4", baseDraftHash: V2_HASH,
        generationInputHash: V2_GENERATION_INPUT_HASH, sourceReceiptRefs: [],
        knowledgeSynthesisInput: synthesisInput,
      },
      synthesisInput, evidence: evidenceValue, narrative: plainNarrative(),
      generatedAt: "2026-09-04T08:00:00.000Z",
    });
    expect(parseGeoKnowledgeGenerationResultV2(value)).toEqual(value);
  });

  it("reports a catalogue it could not fit instead of dropping sources to force one", () => {
    const evidenceValue = maximalEvidence();
    // Past what the Website Profile produces (32 entries a list) but inside
    // what `geoProfileRefSchema` accepts (64), and reached through the real
    // builder rather than by handing the projection a number.
    const value = synthesisInputWith(heavyProfileRef(41), evidenceValue);
    const projection = projectGeoKnowledgeSynthesisV2Catalogue(
      evidenceValue.sourceCatalogue as never, value,
    );
    expect(projection.fits).toBe(false);
    expect(projection.excerptCap).toBe(1);
    expect(projection.catalogueBytes).toBeGreaterThan(projection.budgetBytes);
    // Still every source, still whole excerpts. The refusal happens where it
    // can be explained, not by silently unbalancing a comparison.
    expect(projection.catalogue.map((source) => source.id)).toEqual(evidenceValue.sourceCatalogue.map((source) => source.id));
    // Three states, not two: over the fitted budget is not the same as over
    // the ceiling. This one is still built and still stored -- the adapter
    // declines to buy it as `input_too_large`, having spent nothing.
    expect(geoV2JsonbBytes(value)).toBeGreaterThan(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBudgetBytes);
    expect(geoV2JsonbBytes(value)).toBeLessThanOrEqual(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBytes);
    expect(parseGeoKnowledgeSynthesisInputV2(value)).toEqual(value);
  });

  it("prices a catalogue in the escaped bytes the request is charged in, not in the bytes the row is", () => {
    // Two catalogues of identical shape and identical excerpt length, one of
    // plain prose and one of quotation marks. A quotation mark is escaped once
    // to reach storage and a second time to reach the request, so the quoted
    // catalogue costs about twice the plain one per byte stored and about four
    // times per byte sent. The ratio between the two units is what a budget
    // kept in one of them cannot see.
    const source = (fill: string) => [{
      id: "source:own", kind: "own_page" as const, label: "Product page",
      url: "https://product.example/", competitor: null, availability: "available" as const,
      reason: null, observedAt: V2_AT, bodyHash: V2_HASH,
      excerpts: Array.from({ length: GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.excerpts },
        () => fill.repeat(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.excerptCodePoints)),
    }];
    const promptCost = (value: unknown) => new TextEncoder().encode(JSON.stringify(canonicalGeoV2Text(value))).byteLength;
    const plain = source("e");
    const quoted = source("\"");
    expect(geoV2JsonbBytes(quoted) / geoV2JsonbBytes(plain)).toBeGreaterThan(1.9);
    expect(promptCost(quoted) / promptCost(plain)).toBeGreaterThan(3.8);
    // Cost per byte of budget spent: measured at 1.0026 and 1.9842 for a full
    // page of each, which is the whole reason one unit cannot stand in for the
    // other.
    expect(promptCost(plain) / geoV2JsonbBytes(plain)).toBeLessThan(1.05);
    expect(promptCost(quoted) / geoV2JsonbBytes(quoted)).toBeGreaterThan(1.9);
    // And the projection now charges for that difference: same shape, same
    // budget, different price, different cap.
    const plainProjection = projectGeoKnowledgeSynthesisV2Catalogue(plain as never, input());
    const quotedProjection = projectGeoKnowledgeSynthesisV2Catalogue(quoted as never, input());
    expect(plainProjection.cataloguePromptBytes).toBeLessThan(plainProjection.catalogueBytes * 1.05);
    expect(quotedProjection.cataloguePromptBytes).toBeGreaterThan(quotedProjection.catalogueBytes * 1.9);
  });

  it("buys a request for the content-rich site whose pages are quote-dense, instead of refusing it", () => {
    // The regression this round exists for, and the one case where the fix is
    // visible to an owner rather than only to a budget.
    const evidenceValue = maximalEvidence("\"");
    const sources: readonly any[] = evidenceValue.sourceCatalogue;
    const value = synthesisInputWith(geoV2ProfileRefFixture(), evidenceValue);
    const projection = projectGeoKnowledgeSynthesisV2Catalogue(sources as never, value);

    // What the storage budget alone would have chosen: the largest cap whose
    // catalogue is inside `budgetBytes`, which is the whole rule this replaced.
    const storageOnlyCap = [8, 7, 6, 5, 4, 3, 2, 1].find((cap) => geoV2JsonbBytes(
      sources.map((entry) => entry.excerpts.length <= cap ? entry : { ...entry, excerpts: entry.excerpts.slice(0, cap) }),
    ) <= projection.budgetBytes);
    expect(storageOnlyCap).toBe(2);
    // And what that cap really costs. Assembled here rather than through the
    // builder, because the builder no longer produces it -- which is the point.
    const storageOnlyCatalogue = sources.map((entry) => entry.excerpts.length <= storageOnlyCap!
      ? entry
      : { ...entry, excerpts: entry.excerpts.slice(0, storageOnlyCap), availability: "partial", reason: entry.reason ?? "partial_body" });
    const { contentHash: _replaced, ...storageOnlyBody } = {
      ...value,
      sourceCatalogue: storageOnlyCatalogue as never,
      sourceCatalogueHash: geoKnowledgeSynthesisV2SourceCatalogueDigest(storageOnlyCatalogue as never),
    };
    const storageOnly = { ...storageOnlyBody, contentHash: geoKnowledgeSynthesisInputV2Digest(storageOnlyBody) };
    expect((storageOnly.sourceCatalogue as readonly any[])[0]!.excerpts).toHaveLength(2);
    // A request 63 641 bytes past the ceiling: refused as `input_too_large`,
    // and the owner of that site got no knowledge base at all.
    expect(requestBytes(storageOnly)).toBe(194_713);
    expect(requestBytes(storageOnly) - GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_BYTES).toBe(63_641);
    expect(prepareGeoKnowledgeSynthesisV2(storageOnly, LLM_CONFIG)).toMatchObject({
      ok: false, reason: "input_too_large", attemptedCalls: 0,
    });

    // What both budgets choose, and what it costs: one excerpt per source,
    // every source still present, and a request the adapter buys.
    expect(projection.excerptCap).toBe(1);
    expect(projection.fits).toBe(true);
    expect(projection.catalogue.map((entry) => entry.id)).toEqual(sources.map((entry) => entry.id));
    expect(requestBytes(value)).toBe(109_005);
    expect(prepareGeoKnowledgeSynthesisV2(value, LLM_CONFIG)).toMatchObject({ ok: true });
  });

  it("lets the request budget refuse on its own, where the storage budget sees nothing wrong", () => {
    // The case that proves the second budget is load-bearing rather than
    // decorative: a mid-weight Profile beside quote-dense pages. The catalogue
    // is well inside what the row may hold and well outside what the request
    // may carry, because a quotation mark costs twice as much on the way into a
    // request as it does on the way into storage.
    const evidenceValue = maximalEvidence("\"");
    const value = synthesisInputWith(heavyProfileRef(12), evidenceValue);
    const projection = projectGeoKnowledgeSynthesisV2Catalogue(evidenceValue.sourceCatalogue as never, value);

    expect(projection.excerptCap).toBe(1);
    expect(projection.catalogueBytes).toBe(50_379);
    expect(projection.budgetBytes).toBe(79_624);
    expect(projection.catalogueBytes).toBeLessThanOrEqual(projection.budgetBytes);
    expect(projection.cataloguePromptBytes).toBe(93_500);
    expect(projection.promptBudgetBytes).toBe(84_539);
    expect(projection.cataloguePromptBytes).toBeGreaterThan(projection.promptBudgetBytes);
    expect(projection.fits).toBe(false);
    // And the adapter agrees with the half that refused: 8 112 bytes over.
    expect(requestBytes(value) - GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_BYTES).toBe(8_112);
    expect(prepareGeoKnowledgeSynthesisV2(value, LLM_CONFIG)).toMatchObject({
      ok: false, reason: "input_too_large", attemptedCalls: 0,
    });

    // One list entry lighter and the same catalogue is bought, with 1 988 bytes
    // to spare -- so this is a boundary the budget tracks, not a blanket
    // refusal of quote-dense evidence.
    const lighter = synthesisInputWith(heavyProfileRef(8), evidenceValue);
    expect(projectGeoKnowledgeSynthesisV2Catalogue(evidenceValue.sourceCatalogue as never, lighter).fits).toBe(true);
    expect(GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_BYTES - requestBytes(lighter)).toBe(1_988);
    expect(prepareGeoKnowledgeSynthesisV2(lighter, LLM_CONFIG)).toMatchObject({ ok: true });
  });

  it("spends the request budget to its last byte, and stops at the byte after it", () => {
    /**
     * The boundary, landed on exactly rather than approached.
     *
     * The bulk of each excerpt is quotation marks, so the catalogue costs about
     * twice as much in a request as in the row and the request budget is the
     * one that binds; the last few characters are plain ASCII, which adds
     * exactly one escaped byte each, so the catalogue can be padded until it
     * costs precisely what it is allowed to cost. That is the only input that
     * tells `<=` apart from `<` and `>` apart from `>=`, and the arithmetic
     * those live in carries a `+ 4` splice correction, which is where an
     * off-by-one would hide.
     */
    const escapedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(canonicalGeoV2Text(value))).byteLength;
    const build = (count: number, perSource: number, quotes: number, extra: (index: number, line: number) => number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `source:own-${index}`, kind: "own_page" as const, label: `Own page ${index}`,
        url: `https://product.example/p${index}`, competitor: null, availability: "available" as const,
        reason: null, observedAt: V2_AT, bodyHash: V2_HASH,
        excerpts: Array.from({ length: perSource }, (_, line) => "\"".repeat(quotes) + "e".repeat(extra(index, line))),
      }));
    /**
     * The same catalogue padded until its escaped cost is exactly `target`.
     *
     * The quotation-mark count is bisected rather than written down, so this
     * keeps landing on the boundary when a budget constant moves; the last
     * bytes are then made up in ASCII, one byte each.
     */
    const atExactly = (target: number, count: number, perSource: number) => {
      const room = GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.excerptCodePoints;
      let low = 0;
      let high = room;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (escapedBytes(build(count, perSource, middle, () => 0)) <= target) low = middle;
        else high = middle - 1;
      }
      const shortfall = target - escapedBytes(build(count, perSource, low, () => 0));
      // Non-negative, and small enough to fit inside one excerpt's remaining
      // room: otherwise the padding, not the boundary, is what this measures.
      expect(shortfall).toBeGreaterThanOrEqual(0);
      expect(shortfall).toBeLessThanOrEqual(room - low);
      const padded = build(count, perSource, low, (index, line) => index === 0 && line === 0 ? shortfall : 0);
      expect(escapedBytes(padded)).toBe(target);
      return padded;
    };

    // The loop's boundary, where the cap is what moves: a cap-8 catalogue
    // sitting exactly on the request budget keeps all eight excerpts, and one
    // byte more costs every source one.
    const thin = input();
    const onLoopBudget = atExactly(
      projectGeoKnowledgeSynthesisV2Catalogue([] as never, thin).promptBudgetBytes, 32, 8,
    );
    const loopEdge = projectGeoKnowledgeSynthesisV2Catalogue(onLoopBudget as never, thin);
    // The request budget really is the one binding here, not the storage one.
    expect(loopEdge.catalogueBytes).toBeLessThan(loopEdge.budgetBytes);
    expect(loopEdge.cataloguePromptBytes).toBe(loopEdge.promptBudgetBytes);
    expect(loopEdge.excerptCap).toBe(8);
    expect(loopEdge.fits).toBe(true);
    const overLoopBudget: any[] = JSON.parse(JSON.stringify(onLoopBudget));
    overLoopBudget[0]!.excerpts[0] += "e";
    expect(projectGeoKnowledgeSynthesisV2Catalogue(overLoopBudget as never, thin).excerptCap).toBe(7);

    // The other boundary, where `fits` is what moves: a catalogue of one-excerpt
    // sources has nothing the rule may shorten, so exactly-on-budget is bought
    // and one byte more is refused rather than trimmed.
    const heavy = synthesisInputWith(heavyProfileRef(32), evidence());
    const onFloorBudget = atExactly(
      projectGeoKnowledgeSynthesisV2Catalogue([] as never, heavy).promptBudgetBytes, 32, 1,
    );
    const floorEdge = projectGeoKnowledgeSynthesisV2Catalogue(onFloorBudget as never, heavy);
    expect(floorEdge.catalogueBytes).toBeLessThan(floorEdge.budgetBytes);
    expect(floorEdge.cataloguePromptBytes).toBe(floorEdge.promptBudgetBytes);
    expect(floorEdge.fits).toBe(true);
    const overFloorBudget: any[] = JSON.parse(JSON.stringify(onFloorBudget));
    overFloorBudget[0]!.excerpts[0] += "e";
    const overFloor = projectGeoKnowledgeSynthesisV2Catalogue(overFloorBudget as never, heavy);
    // Every cap it may choose costs the same, so it walks to the floor and then
    // says so, with every source still present and every excerpt whole.
    expect(overFloor.excerptCap).toBe(1);
    expect(overFloor.fits).toBe(false);
    expect(overFloor.cataloguePromptBytes).toBe(overFloor.promptBudgetBytes + 1);
    expect(overFloor.catalogue.map((entry) => entry.id)).toEqual(overFloorBudget.map((entry) => entry.id));
    expect(overFloor.droppedExcerpts).toBe(0);
  });

  it("mirrors the adapter's own prompt ceiling and reserves at least what the request envelope costs", () => {
    // Neither number is re-derived from the constant it checks. The ceiling is
    // read from the module that actually refuses a request, and the envelope is
    // measured from the real system prompt and response schema.
    expect(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.promptBytes).toBe(GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_BYTES);
    const envelope = new TextEncoder().encode(JSON.stringify({
      prompt: { system: GEO_KNOWLEDGE_SYNTHESIS_V2_SYSTEM_PROMPT, user: "" },
      responseJsonSchema: GEO_KNOWLEDGE_SYNTHESIS_V2_RESPONSE_JSON_SCHEMA,
    })).byteLength - 2;
    expect(envelope).toBe(13_487);
    // Reserved above the measurement, so rewording the system prompt does not
    // silently start over-spending the ceiling...
    expect(envelope).toBeLessThanOrEqual(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.promptEnvelopeBytes);
    // ...but not so far above it that the evidence pays for headroom nobody
    // uses. If this fails upward the prompt grew: raising the reservation moves
    // every stored record's re-derived cap, so it is a contract change, not a
    // constant bump.
    expect(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.promptEnvelopeBytes - envelope).toBeLessThanOrEqual(2_048);
  });

  it("splices into the input exactly, so the two halves of the request add up", () => {
    // The four bytes `GEO_PROMPT_SPLICE_BYTES` names, re-derived from real
    // values at three very different sizes rather than argued for in a comment.
    const escaped = (value: unknown) => new TextEncoder().encode(JSON.stringify(canonicalGeoV2Text(value))).byteLength;
    for (const value of [input(), synthesisInputWith(geoV2ProfileRefFixture(), maximalEvidence()), synthesisInputWith(productMaximumProfileRef(), maximalEvidence())]) {
      const skeleton = { ...value, sourceCatalogue: [], sourceCatalogueHash: "0".repeat(64), contentHash: "0".repeat(64) };
      expect(escaped(skeleton) + escaped(value.sourceCatalogue) - 4).toBe(escaped(value));
      expect(escaped(skeleton)).toBe(geoKnowledgeSynthesisV2NonCataloguePromptBytes(value));
    }
  });

  it("predicts the request the adapter measures, to the byte", () => {
    // The property the whole budget rests on. Predicted from the projection's
    // own numbers; compared against the request built by the real prompt module.
    for (const value of [
      input(),
      synthesisInputWith(geoV2ProfileRefFixture(), maximalEvidence()),
      synthesisInputWith(geoV2ProfileRefFixture(), maximalEvidence("\"")),
      synthesisInputWith(heavyProfileRef(32), maximalEvidence()),
      synthesisInputWith(productMaximumProfileRef(), maximalEvidence()),
    ]) {
      const escaped = (entry: unknown) => new TextEncoder().encode(JSON.stringify(canonicalGeoV2Text(entry))).byteLength;
      const predicted = 13_487 + geoKnowledgeSynthesisV2NonCataloguePromptBytes(value) + escaped(value.sourceCatalogue) - 4;
      expect(predicted).toBe(requestBytes(value));
    }
  });

  it("fits nothing it cannot buy: every fitted catalogue's request is inside the ceiling", () => {
    // `fits: true` is a promise about the adapter, so it is checked against the
    // adapter. Twelve inputs across both axes the budget has to survive --
    // how heavy the Profile is, and how escape-dense the page text is.
    const cases = [
      ...["e", "\"", "\\", "\n"].map((fill) => [geoV2ProfileRefFixture(), maximalEvidence(fill)] as const),
      ...[1, 8, 16, 24, 32, 36, 41].map((items) => [heavyProfileRef(items), maximalEvidence()] as const),
      // Both axes at once, which is where the two budgets disagree: a
      // mid-weight Profile beside quote-dense pages.
      ...[8, 12].map((items) => [heavyProfileRef(items), maximalEvidence("\"")] as const),
      [productMaximumProfileRef(), maximalEvidence()] as const,
    ];
    let fitted = 0;
    let refused = 0;
    for (const [profileRef, evidenceValue] of cases) {
      const value = synthesisInputWith(profileRef, evidenceValue);
      const projection = projectGeoKnowledgeSynthesisV2Catalogue(evidenceValue.sourceCatalogue as never, value);
      // The compatibility invariant the storage budget is kept for: adding the
      // request budget can only lower a cap, never raise one. A record fitted
      // under the storage rule alone therefore re-derives to the catalogue it
      // stores, because a record that was bought already satisfied both.
      const storageOnlyCap = [8, 7, 6, 5, 4, 3, 2, 1].find((cap) => geoV2JsonbBytes(
        (evidenceValue.sourceCatalogue as readonly any[]).map((entry) => entry.excerpts.length <= cap
          ? entry
          : { ...entry, excerpts: entry.excerpts.slice(0, cap), availability: "partial", reason: entry.reason ?? "partial_body" }),
      ) <= projection.budgetBytes) ?? 1;
      expect(projection.excerptCap).toBeLessThanOrEqual(storageOnlyCap);
      if (projection.fits) {
        fitted += 1;
        expect(requestBytes(value)).toBeLessThanOrEqual(GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_BYTES);
        expect(prepareGeoKnowledgeSynthesisV2(value, LLM_CONFIG)).toMatchObject({ ok: true });
      } else {
        refused += 1;
      }
    }
    // Both branches were exercised: a suite where nothing fitted would pass
    // this vacuously, and so would one where nothing was refused.
    expect(fitted).toBe(10);
    expect(refused).toBe(4);
  });

  it("refuses a Website Profile filled to every product limit, as a size and not as a defect", () => {
    // Built through the real Profile parser and the real `profileRef`
    // projection, so "inside every product limit" is proved rather than
    // claimed: 32-item lists at `WEBSITE_PROFILE_LIST_MAX_ITEMS`, five
    // 2 000-character text fields, three provenance rows at the Profile's own
    // 2 048-character evidence-URL bound.
    const profileRef = productMaximumProfileRef();
    const evidenceValue = maximalEvidence();
    const value = synthesisInputWith(profileRef, evidenceValue);
    const projection = projectGeoKnowledgeSynthesisV2Catalogue(evidenceValue.sourceCatalogue as never, value);

    // The measurements that say the gap is real and where it is. The Profile
    // escapes to 99 109 of the 117 785 bytes the request may carry beside the
    // envelope; the evidence needs 29 456 for one excerpt per source.
    expect(projection.nonCataloguePromptBytes).toBe(99_109);
    expect(projection.promptBudgetBytes).toBe(17_631);
    expect(projection.cataloguePromptBytes).toBe(29_456);
    expect(projection.excerptCap).toBe(1);
    expect(projection.fits).toBe(false);
    // No source dropped and no excerpt truncated on the way to that refusal.
    expect(projection.catalogue.map((entry) => entry.id)).toEqual(evidenceValue.sourceCatalogue.map((entry) => entry.id));
    for (const [index, entry] of projection.catalogue.entries()) {
      expect(entry.excerpts).toEqual(evidenceValue.sourceCatalogue[index]!.excerpts.slice(0, entry.excerpts.length));
    }
    // The request is 10 976 bytes past the ceiling, which no cap this rule may
    // choose can close.
    expect(requestBytes(value)).toBe(142_048);
    expect(requestBytes(value) - GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_BYTES).toBe(10_976);
    // So the input is still built and still storable -- three states, not two --
    // and the refusal names its size, spends nothing, and attempts nothing.
    expect(geoV2JsonbBytes(value)).toBeLessThanOrEqual(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBytes);
    expect(parseGeoKnowledgeSynthesisInputV2(value)).toEqual(value);
    expect(prepareGeoKnowledgeSynthesisV2(value, LLM_CONFIG)).toMatchObject({
      ok: false, reason: "input_too_large", attemptedCalls: 0, delivery: "not_attempted",
    });
  });

  it("refuses an input whose profile alone is over the ceiling, and says which half was heavy", () => {
    let thrown: unknown;
    try { synthesisInputWith(maximalProfileRef(), evidence()); } catch (error) { thrown = error; }
    // Typed, not described: the caller that turns this into an owner-visible
    // outcome must not have to match prose to tell it from "malformed".
    expect(thrown).toBeInstanceOf(GeoKnowledgeSynthesisInputTooLargeError);
    const error = thrown as GeoKnowledgeSynthesisInputTooLargeError;
    expect(error.inputBytes).toBeGreaterThan(error.limitBytes);
    expect(error.limitBytes).toBe(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBytes);
    // The evidence is not what is too large: the rest of the input is past the
    // whole-input budget on its own, so no catalogue could have fitted beside
    // it and shortening one would not have helped.
    expect(error.nonCatalogueBytes).toBeGreaterThan(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBudgetBytes);
  });
});

describe("GEO knowledge narrative v2", () => {
  it("parses a citation-bound narrative whose facts are triples", () => {
    expect(parseGeoKnowledgeNarrativeV2(narrative(), input())).toEqual(narrative());
  });

  it("keeps one attribute's qualified variants apart and admits an unqualified fact", () => {
    const parsed = parseGeoKnowledgeNarrativeV2(narrative(), input());
    const prices = parsed.facts.filter((fact) => fact.attribute === "Monthly price");
    expect(prices.map((fact) => fact.qualifiers)).toEqual([["Pro plan"], ["Team plan"], ["Enterprise plan"]]);
    expect(prices.map((fact) => fact.subject)).toEqual(["Pine Cloud", "Pine Cloud", "Pine Cloud"]);
    // Same subject and attribute, three qualifier sets: three separate items,
    // so a correction to the Pro price can never reach the Team price.
    const unqualified = parsed.facts.filter((fact) => fact.qualifiers.length === 0);
    expect(unqualified.map((fact) => fact.id)).toEqual(["fact:teams"]);
    const unavailable = prices.find((fact) => fact.value === null);
    expect(unavailable?.reason).toBe("notPublished");
  });

  it("lets a canonical question repeat its question verbatim, including the plain wh-phrasing", () => {
    const parsed = parseGeoKnowledgeNarrativeV2(narrative(), input());
    expect(parsed.qa.map((item) => item.canonicalQuestion)).toEqual(parsed.qa.map((item) => item.question));
    expect(parsed.qa[1]?.canonicalQuestion).toBe("What is Pine Cloud?");
  });

  it.each([
    ["a fabricated source reference", (value: any) => { value.facts[0].sourceRefs = ["source:invented"]; }],
    ["a reference to a source that was not collected", (value: any) => { value.facts[0].sourceRefs = ["source:llms"]; }],
    ["a numeric value that is absent from the cited evidence", (value: any) => { value.facts[1].value = "$99"; }],
    ["a numeric statement that is absent from the cited evidence", (value: any) => { value.facts[0].statement = "Pine Cloud supports teams of 99."; }],
    ["a fact whose only evidence is a competitor page", (value: any) => { value.facts[0].sourceRefs = ["source:rival"]; }],
    ["a comparison verdict evidenced on the own side only", (value: any) => { value.comparisons[0].sourceRefs = ["source:own"]; }],
    ["a comparison verdict evidenced on the competitor side only", (value: any) => { value.comparisons[0].sourceRefs = ["source:rival"]; }],
    ["a comparison row evidenced on one side only", (value: any) => { value.comparisons[0].rows[0].sourceRefs = ["source:own"]; }],
    ["a missing canonical question", (value: any) => { delete value.qa[0].canonicalQuestion; }],
    ["a null canonical question", (value: any) => { value.qa[0].canonicalQuestion = null; }],
    ["a canonical question that normalises to nothing", (value: any) => { value.qa[0].canonicalQuestion = INVISIBLE; }],
    ["two facts that would share one item key", (value: any) => { value.facts[2].qualifiers = ["Pro plan"]; }],
    ["two comparison rows that would share one item key", (value: any) => {
      value.comparisons[0].rows.push({ ...value.comparisons[0].rows[0], id: "comparison-row:teams-again" });
    }],
    ["a qualifier that normalises to nothing", (value: any) => { value.facts[1].qualifiers = [INVISIBLE]; }],
    ["a repeated qualifier", (value: any) => { value.facts[1].qualifiers = ["Pro plan", "Pro plan"]; }],
    ["a subject that normalises to nothing", (value: any) => { value.facts[0].subject = INVISIBLE; }],
    ["a scope statement that normalises to nothing", (value: any) => { value.scope.does[0].text = INVISIBLE; }],
    ["an available fact carrying an unavailability reason", (value: any) => { value.facts[0].reason = "notPublished"; }],
    ["an unavailable fact carrying no reason", (value: any) => { value.facts[3].reason = ""; }],
    ["a URL in a fact value", (value: any) => { value.facts[0].value = "https://product.example/"; }],
    ["a bare domain in a fact attribute", (value: any) => { value.facts[0].attribute = "See docs.example"; }],
    ["a competitor named in a fact qualifier", (value: any) => { value.facts[0].qualifiers = ["Rival"]; }],
    ["a competitor named in a definition answer", (value: any) => { value.qa[1].directAnswer = "Pine Cloud is not Rival."; }],
    ["a proper-name subject that no cited excerpt contains", (value: any) => { value.facts[0].statement = "Acme Corp is a partner."; }],
    ["an unknown output field", (value: any) => { value.facts[0].note = true; }],
    ["a v1 fact shape", (value: any) => {
      value.facts[0] = { id: "fact:v1", type: "feature", statement: "Pine Cloud supports teams of 2.", sourceRefs: ["source:own"] };
    }],
    ["duplicate narrative text", (value: any) => { value.scope.does[0].text = value.facts[0].statement; }],
    ["duplicate content ids", (value: any) => { value.qa[0].id = value.facts[0].id; }],
    ["a mismatched competitor name", (value: any) => { value.comparisons[0].competitor.name = "Other"; }],
    ["a wrong schema version", (value: any) => { value.schemaVersion = "marketing-geo-knowledge-narrative.v1"; }],
    // The three rows below are the only enforcement of invariants the provider
    // schema used to duplicate. `uniqueItems` and the `scope` `anyOf` branches
    // were removed from it because strict Structured Outputs refuses both and
    // rejects the whole request; see provider-json-schema-strict.test.ts.
    ["an entirely empty scope", (value: any) => { value.scope = { does: [], doesNot: [], needsHuman: [], misconceptions: [] }; }],
    ["duplicate question variants", (value: any) => { value.qa[0].variants = ["Is it for two?", "Is it for two?"]; }],
    ["duplicate entity source refs", (value: any) => { value.entity.sourceRefs = [value.entity.sourceRefs[0], value.entity.sourceRefs[0]]; }],
  ])("rejects %s", (_label, mutate) => {
    const value: any = narrative();
    mutate(value);
    expect(() => parseGeoKnowledgeNarrativeV2(value, input())).toThrow();
  });

  /**
   * Section 2 R4 wants a comparison to name the competitor and carry evidence on
   * BOTH sides. The numeric check used to read own-site excerpts only, so the
   * one answer the rule asks for -- "we support 2, Rival lists 5", citing both
   * pages -- threw `Unsupported numeric claim`, which
   * `kb-knowledge-synthesis-v2.ts` turns into `schema_invalid` for the WHOLE
   * generation: every other fact, definition and answer from a paid call, gone.
   *
   * The fix separates "must carry own-site evidence" from "where a number may
   * come from", so the negatives below matter as much as the positive: a number
   * that only a competitor page the text never names could support, or that
   * nothing supports, is still refused.
   */
  const comparisonQa = (overrides: Record<string, unknown> = {}) => ({
    id: "qa:vs-rival",
    intent: "comparison",
    question: "How does Pine Cloud compare with Rival on team size?",
    canonicalQuestion: "How does Pine Cloud compare with Rival on team size?",
    variants: [] as string[],
    directAnswer: "Pine Cloud is built for teams of 2. Rival lists support for teams of 5.",
    expansion: null as string | null,
    sourceRefs: ["source:own", "source:rival"],
    ...overrides,
  });

  it("accepts a comparison answer whose competitor number is on the competitor's own cited page", () => {
    const value: any = narrative();
    value.qa.push(comparisonQa());

    expect(() => parseGeoKnowledgeNarrativeV2(value, input())).not.toThrow();
  });

  it("still refuses a comparison answer citing a number no cited page states", () => {
    const value: any = narrative();
    // 5 is on the rival's page; 40 is on nobody's.
    value.qa.push(comparisonQa({ directAnswer: "Pine Cloud is built for teams of 2. Rival lists support for teams of 40." }));

    expect(() => parseGeoKnowledgeNarrativeV2(value, input())).toThrow(/Unsupported numeric claim/u);
  });

  it("still refuses a competitor number when the answer does not cite that competitor's page", () => {
    const value: any = narrative();
    value.qa.push(comparisonQa({ sourceRefs: ["source:own"] }));

    // The identity check fires first: naming Rival without its page is refused
    // whatever the numbers say, and that gate is unchanged.
    expect(() => parseGeoKnowledgeNarrativeV2(value, input())).toThrow(/Competitor mention requires matching competitor evidence/u);
  });

  it("still requires own-site evidence for a comparison answer", () => {
    const value: any = narrative();
    // Citing only the rival's page is refused before any number is looked at.
    // The test used to be named for a guarantee about laundering the rival's
    // number; it never reached that check, and the check does not hold -- see
    // the test below, which pins what the parser actually does.
    value.qa.push(comparisonQa({
      directAnswer: "Pine Cloud is built for teams of 5 too, and Rival lists support for teams of 5.",
      sourceRefs: ["source:rival"],
    }));

    expect(() => parseGeoKnowledgeNarrativeV2(value, input())).toThrow(/Product evidence is required/u);
  });

  it("cannot tell whose number is whose inside one comparison answer", () => {
    /*
     * A KNOWN GAP, pinned so it is visible rather than assumed away.
     *
     * The numeric check unions the product's pages with the named competitor's
     * (kb-knowledge-synthesis-v2-contract.ts, the comparison branch) and asks
     * only whether each number appears SOMEWHERE in the merged pool. That is
     * deliberate -- a real comparison answer quotes both sides, and refusing
     * the rival's figure would refuse every honest comparison -- but it means
     * an answer that attributes the rival's number to the product passes.
     *
     * Here 5 is only on the rival's page (Pine Cloud's own says 2), and the
     * sentence claims it for Pine Cloud. Closing this needs per-clause
     * attribution, not a wider or narrower pool. If someone builds that, this
     * test turns red, and that is the point: it should be changed to a `toThrow`
     * on purpose, not discovered.
     */
    const value: any = narrative();
    value.qa.push(comparisonQa({
      directAnswer: "Pine Cloud is built for teams of 5 too, and Rival lists support for teams of 5.",
      sourceRefs: ["source:own", "source:rival"],
    }));

    expect(() => parseGeoKnowledgeNarrativeV2(value, input())).not.toThrow();
  });

  it("keeps a plain answer's numbers on the product's own pages", () => {
    const value: any = narrative();
    value.qa.push({
      id: "qa:plain", intent: "applicability",
      question: "How many seats does Pine Cloud need?",
      canonicalQuestion: "How many seats does Pine Cloud need?",
      variants: [] as string[],
      // The rival's number, in an answer that names no competitor and so opens
      // no extra pool -- even though the rival's page is cited.
      directAnswer: "Pine Cloud is built for teams of 5.",
      expansion: null as string | null,
      sourceRefs: ["source:own", "source:rival"],
    });

    expect(() => parseGeoKnowledgeNarrativeV2(value, input())).toThrow(/Unsupported numeric claim/u);
  });

  it("names the failure when a source reference was invented", () => {
    const value: any = narrative();
    value.facts[0].sourceRefs = ["source:invented"];
    expect(() => parseGeoKnowledgeNarrativeV2(value, input())).toThrow(/source reference/iu);
  });

  it("names the failure when a number is not in the cited excerpt", () => {
    const value: any = narrative();
    value.facts[1].value = "$99";
    expect(() => parseGeoKnowledgeNarrativeV2(value, input())).toThrow(/numeric/iu);
  });

  it("names the failure when two items would collide on one key", () => {
    const value: any = narrative();
    value.facts[2].qualifiers = ["Pro plan"];
    expect(() => parseGeoKnowledgeNarrativeV2(value, input())).toThrow(/item key/iu);
    const rows: any = narrative();
    rows.comparisons[0].rows.push({ ...rows.comparisons[0].rows[0], id: "comparison-row:teams-again" });
    expect(() => parseGeoKnowledgeNarrativeV2(rows, input())).toThrow(/item key/iu);
  });

  it("names the failure when an identity part carries no identity", () => {
    for (const mutate of [
      (value: any) => { value.facts[1].qualifiers = [INVISIBLE]; },
      (value: any) => { value.facts[0].subject = INVISIBLE; },
      (value: any) => { value.qa[0].canonicalQuestion = INVISIBLE; },
      (value: any) => { value.scope.does[0].text = INVISIBLE; },
    ]) {
      const value: any = narrative();
      mutate(value);
      expect(() => parseGeoKnowledgeNarrativeV2(value, input())).toThrow(/normalises to nothing/iu);
    }
  });

  it("names the failure when a comparison is evidenced on one side only", () => {
    const verdict: any = narrative();
    verdict.comparisons[0].sourceRefs = ["source:own"];
    expect(() => parseGeoKnowledgeNarrativeV2(verdict, input())).toThrow(/comparison verdict evidence/iu);
    const row: any = narrative();
    row.comparisons[0].rows[0].sourceRefs = ["source:own"];
    expect(() => parseGeoKnowledgeNarrativeV2(row, input())).toThrow(/comparison row evidence/iu);
  });
});

describe("GEO knowledge generation result v2", () => {
  it("binds the manifest, the input, the evidence and the narrative to one identity", () => {
    const value = result();
    expect(value.schemaVersion).toBe("marketing-geo-knowledge-generation-result.v2");
    expect(value.manifest.schemaVersion).toBe("marketing-geo-knowledge-generation-input.v2");
    expect(value.manifest.generationInputHash).toBe(value.synthesisInput.generationInputHash);
    expect(value.narrative.facts).toHaveLength(4);
    expect(parseGeoKnowledgeGenerationResultV2(value)).toEqual(value);
  });

  it.each([
    ["a manifest bound to a different generation input", (value: any) => { value.manifest.generationInputHash = "e".repeat(64); }],
    ["a manifest scoped to another knowledge base", (value: any) => { value.manifest.kbId = "5d4c06b3-7f10-8182-be5f-6a7b8c9d0e1f"; }],
    ["a tampered content hash", (value: any) => { value.contentHash = V2_HASH; }],
    ["a result generated before its evidence", (value: any) => { value.generatedAt = "2026-09-04T07:00:00.000Z"; }],
    ["a v1 profile copy hash in the manifest", (value: any) => { value.manifest.profileCopyHash = V2_HASH; }],
  ])("rejects %s", (_label, mutate) => {
    const value: any = JSON.parse(JSON.stringify(result()));
    mutate(value);
    expect(() => parseGeoKnowledgeGenerationResultV2(value)).toThrow();
  });

  it("refuses a narrative that its own synthesis input does not support", () => {
    const value: any = JSON.parse(JSON.stringify(result()));
    value.narrative.facts[0].sourceRefs = ["source:invented"];
    expect(() => parseGeoKnowledgeGenerationResultV2(value)).toThrow();
  });

  it("keeps the evidence observation time out of the model's reach", () => {
    const value: any = narrative();
    value.facts[0].observedAt = V2_AT;
    expect(() => parseGeoKnowledgeNarrativeV2(value, input())).toThrow();
  });
});

describe("category terms cannot exceed what produces them", () => {
  it("caps at the roles step's own ceiling, not one of its own", () => {
    // The only producer of category terms is the roles synthesis output, whose
    // schema caps them at GEO_SYNTHESIS_LIMITS.categoryTerms, and the locked
    // generation input caps them there too. A wider limit here would state that
    // this contract accepts inputs the system cannot construct.
    expect(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.categoryTerms).toBe(GEO_SYNTHESIS_LIMITS.categoryTerms);
  });
});
