// @input -- authenticated saved-draft identities and owner-scoped source readers
// @output -- secret-free durable input and a deferred single-invocation closure
// @pos -- business preflight only; no routes, environment lookup or store wiring
import { createHash } from "node:crypto";
import { geoGenerationLanguage } from "@sf/public-tools/content-brief/geo-contract";
import type { KeywordLlmConfig } from "../tools/keyword-llm-client.ts";
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { profileCopyReference, type GeoProfileCopy } from "./kb-profile-copy.ts";
import type { VersionedGeoKbDetails } from "./kb-versioned-read.ts";
import type { GeoKbGenerationHandlerDependencies } from "./kb-generation-handler.ts";
import { GEO_GENERATION_INPUT_BYTES, geoGenerationInputHash, type GeoKbGenerationRecord, type GeoKbGenerationInvocation, type GeoGenerationAttempt, type GeoGenerationValue } from "./kb-generation.ts";
import { synthesizeGeoKbRoles, synthesizeGeoKbQuestions, prepareGeoRoleSynthesis, prepareGeoQuestionSynthesis, isUsableGeoSynthesisConfig, type GeoSynthesisResult, type GeoSynthesisProvider } from "./kb-synthesis.ts";
import { parseAnyGeoKbPayload, parseGeoKbPayloadV2, GEO_KB_SCHEMA_VERSION_V2, type AnyGeoKbPayload, type GeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { assertGeoProfileCopyIntegrity } from "./kb-profile-copy-server.ts";
import { buildGeoRoleSynthesisBasis, buildGeoQuestionSynthesisBasis, type GeoAdmittedQuestionFact } from "./kb-synthesis-input.ts";
import { createGeoRoleProposal, parseGeoRoleProposal, resolveGeoModelRoleLineage, type GeoRoleProposal } from "./kb-role-proposal.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { canonicalGeoV2Text, geoV2JsonbBytes } from "./kb-v2-json.ts";
import type { GeoSynthesisSource, GeoQuestionSynthesisInput } from "./kb-synthesis-contract.ts";
import { verifyGeoKbSourceReportV2, geoKbSourceCatalogueV2 } from "./kb-sources.ts";
import type { GeoKbSourceReportV2 } from "./kb-source-contract.ts";
import { selectGeoCompetitorEvidence } from "./kb-competitor-evidence.ts";
import { buildGeoPreparedKnowledgeBase, buildGeoPreparedKnowledgeBaseV2 } from "./kb-preparation.ts";
import { assertGeoSnapshotContextV2KnownInput, GEO_CONTEXT_EVIDENCE_MAX_BYTES, type GeoSourceReceiptRef, type GeoSourceSummaryV2, type GeoVerifiedFactSupportV2 } from "./snapshot-context-v2.ts";
import { GEO_KNOWLEDGE_EVIDENCE_LIMITS, parseGeoKnowledgeEvidenceV1, type GeoKnowledgeEvidencePage, type GeoKnowledgeEvidenceSource, type GeoKnowledgeResourceResult } from "./kb-knowledge-evidence.ts";
import { geoEvidenceTtlMs, isObservationFresh, type GeoEvidenceObservation } from "./kb-evidence-observations.ts";
import { buildGeoKnowledgeSynthesisInputV1, type GeoKnowledgeSynthesisInputV1 } from "./kb-knowledge-synthesis-contract.ts";
import { GEO_KNOWLEDGE_SYNTHESIS_PROMPT_VERSION, prepareGeoKnowledgeSynthesis, synthesizeGeoKnowledgeNarrative, type GeoKnowledgeSynthesisDependencies, type GeoKnowledgeSynthesisResult } from "./kb-knowledge-synthesis.ts";
import { buildGeoKnowledgeGenerationInputManifest } from "./kb-prepared-contract.ts";
import { buildGeoKnowledgeGenerationResultV1, parseGeoKnowledgeGenerationResultV1, type GeoKnowledgeGenerationResultV1 } from "./kb-knowledge-generation-contract.ts";
import { buildGeoKnowledgePack } from "./kb-knowledge-pack.ts";
import type { KeywordLlmUsage } from "../tools/keyword-llm-client.ts";
import { isGeoKbPayloadV3, parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import { geoGenerationInputHashV3 } from "./kb-prepared-v3-contract.ts";
import { GEO_KNOWLEDGE_GENERATION_INPUT_V2_SCHEMA, GEO_KNOWLEDGE_GENERATION_RESULT_V2_SCHEMA, buildGeoKnowledgeGenerationResultV2, buildGeoKnowledgeSynthesisInputV2, type GeoKnowledgeSynthesisInputV2 } from "./kb-knowledge-synthesis-v2-contract.ts";
import { prepareGeoKnowledgeSynthesisV2, synthesizeGeoKnowledgeNarrativeV2, type GeoKnowledgeSynthesisV2Dependencies, type GeoKnowledgeSynthesisV2Result } from "./kb-knowledge-synthesis-v2.ts";

/** The reader's own vocabulary for "we did not get this page". */
export type GeoKnowledgeUnavailableReason = Extract<GeoKnowledgeResourceResult, { readonly kind: "unavailable" }>["reason"];

/**
 * What one target of an update is worth to the model step, given what the
 * update's own `fetch` operations already put in the observation library.
 *
 * This exists because the knowledge collector used to run its own crawl. Every
 * `knowledge_pack` preparation built a fresh gated reader and re-read the pages
 * the run had just fetched, plus pages the run never planned -- work that spent
 * the site's shared hourly crawl allowance a second time and that no ledger row
 * named. `kb-run-plan.ts` states the rule that broke: every operation in an
 * update that costs money or spends a shared crawl allowance gets its own
 * durable row.
 *
 * Three answers, because three things can be true of a target and only one of
 * them is "we know nothing":
 *
 *  - `reuse` -- the library holds a live, successful observation of exactly
 *    this page. It becomes a source the collector takes in place of a fetch,
 *    carrying the observation's OWN timestamp, body hash and excerpts. Nothing
 *    is invented: an observation that cannot be expressed as a valid source
 *    falls through to `fetch` rather than being trimmed into one.
 *  - `observed_unavailable` -- the update looked inside the TTL and did not get
 *    the page. Fetching again would be the same page read twice in a day, so
 *    the reader answers from the observation. The source the collector then
 *    builds carries `observedAt: null`, exactly as a live failure would,
 *    because a reused failure is not a fresh measurement of anything.
 *  - `fetch` -- nothing usable is known. The collector reads the page.
 *
 * Freshness is time and only time, the same criterion `planGeoEvidenceReuse`
 * applies, so this cannot disagree with the executor that wrote the row. An
 * expired observation is never silently reused, and a future-dated one is not
 * fresh at all.
 *
 * Pure: it reads no store, and no clock beyond the `now` it is handed.
 */
export type GeoKnowledgeObservationCredit =
  | { readonly kind: "reuse"; readonly source: GeoKnowledgeEvidenceSource }
  | { readonly kind: "observed_unavailable"; readonly reason: GeoKnowledgeUnavailableReason }
  | { readonly kind: "fetch" };

/*
 * The controls JSON cannot carry safely, and the exact-URL shape the evidence
 * contract admits. Both are deliberately re-stated rather than imported: they
 * are private to `kb-knowledge-evidence.ts`. The only drift they can cause is
 * THIS side refusing a source that side would have taken, which costs one fetch
 * and can never produce reuse the collector would reject -- and a reused source
 * the collector rejects is not a failed fetch, it is a thrown collection and a
 * knowledge step that never runs. `builds a source the real collector accepts`
 * is the test that holds the direction.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const OBSERVATION_HASH = /^[a-f0-9]{64}$/u;

function usableSourceText(value: string, maximum: number): boolean {
  return value.trim().length > 0 && Array.from(value).length <= maximum && !CONTROL_CHARACTERS.test(value);
}

function exactPublicSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return value.length <= 2_048 && url.protocol === "https:" && url.username === "" && url.password === ""
      && url.port === "" && url.hash === "" && url.toString() === value;
  } catch { return false; }
}

/**
 * The evidence catalogue's own source identity, re-derived.
 *
 * `sourceId` is private to `kb-knowledge-evidence.ts`, so this is a second
 * implementation of one rule. It is pinned by a test that compares this value
 * with the id the real collector mints for the same `(kind, url)`: an id that
 * merely looked plausible would put two entries for one page into a catalogue
 * that dedupes on id before it dedupes on URL.
 */
function evidenceCatalogueSourceId(kind: GeoKnowledgeCreditKind, url: string): string {
  return `${kind}-${createHash("sha256").update(`${kind}:${url}`, "utf8").digest("hex").slice(0, 20)}`;
}

/**
 * The kinds a stored observation can be credited as.
 *
 * The three machine-readable resources are here because the run's own-page
 * fetch operation now reads them and files one ledger row each. They are
 * credited like a page -- same freshness rule, same source shape, same excerpt
 * admission -- and two things differ: the label is the collector's own
 * (`label: kind`), so a reused row and a freshly read one are indistinguishable
 * in the catalogue, and each kind's address must be the one the evidence
 * contract allows that kind to have (see `exactMachineResourceUrl`).
 */
export type GeoKnowledgeCreditKind = "own_page" | "competitor_page" | "robots" | "sitemap" | "llms";

/**
 * The address shape the evidence contract demands of each machine resource,
 * restated (`assertEvidenceIntegrity` is private) in the same direction as
 * every other restatement here: this side may refuse a source that side would
 * have taken, and must never build one that side throws on. It throws rather
 * than refuses -- a rejected reused source is not a failed fetch, it is a
 * collection that dies -- which is why the check is made before the source is
 * built rather than after.
 */
function exactMachineResourceUrl(kind: GeoKnowledgeCreditKind, url: URL): boolean {
  if (kind === "own_page" || kind === "competitor_page") return true;
  if (url.search !== "") return false;
  if (kind === "robots") return url.pathname === "/robots.txt";
  if (kind === "llms") return url.pathname === "/llms.txt";
  const path = url.pathname.toLocaleLowerCase("en");
  return path.includes("sitemap") && path.endsWith(".xml");
}

export function creditGeoKnowledgeObservation(input: {
  readonly kind: GeoKnowledgeCreditKind;
  /** The address the collector will ask for, exactly as it will ask for it. */
  readonly url: string;
  readonly competitor: { readonly key: string; readonly name: string; readonly confirmed: true } | null;
  readonly observation: GeoEvidenceObservation | null;
  readonly now: Date;
}): GeoKnowledgeObservationCredit {
  const observation = input.observation;
  if (observation === null) return { kind: "fetch" };
  // The library is keyed by `(kind, url)`; a row answering a different question
  // is not this target's evidence, however fresh it is.
  if (observation.kind !== input.kind || observation.url !== input.url) return { kind: "fetch" };
  if (!isObservationFresh(observation, input.now, geoEvidenceTtlMs(input.kind))) return { kind: "fetch" };
  if (observation.status.kind === "unavailable") return { kind: "observed_unavailable", reason: observation.status.reason };
  if (!exactPublicSourceUrl(input.url)) return { kind: "fetch" };
  if (!exactMachineResourceUrl(input.kind, new URL(input.url))) return { kind: "fetch" };
  if ((input.kind === "competitor_page") !== (input.competitor !== null)) return { kind: "fetch" };
  const competitor = input.competitor;
  if (competitor !== null && (new URL(input.url).host !== competitor.key
    || !usableSourceText(competitor.key, 128) || !usableSourceText(competitor.name, 200))) return { kind: "fetch" };
  if (!OBSERVATION_HASH.test(observation.status.bodyHash)) return { kind: "fetch" };
  const observedAtMs = Date.parse(observation.observedAt);
  if (!Number.isFinite(observedAtMs)) return { kind: "fetch" };
  const usable = observation.status.excerpts
    .filter(excerpt => usableSourceText(excerpt, GEO_KNOWLEDGE_EVIDENCE_LIMITS.excerptCodePoints));
  const excerpts = usable.slice(0, GEO_KNOWLEDGE_EVIDENCE_LIMITS.maxExcerpts);
  /**
   * A robots.txt is not quoted, it is PARSED: the assembler reads per-agent
   * allow/disallow claims out of these lines, and its only protection against
   * claiming from a partial file is that a full sample (`excerpts.length >= 8`)
   * is treated as possibly truncated. Dropping a line here shortens the sample
   * below that threshold and hands the assembler what looks like a complete
   * file with one rule silently missing -- turning "this site does not mention
   * GPTBot" into a sentence about a line we threw away. Every other kind loses
   * a quote and claims nothing from the gap, so only robots refuses.
   */
  if (input.kind === "robots" && usable.length !== observation.status.excerpts.length) return { kind: "fetch" };
  // A source with no quotable line supports no claim, and `sourceSchema`
  // refuses one. Reading the page again is the honest answer.
  if (excerpts.length === 0) return { kind: "fetch" };
  return { kind: "reuse", source: {
    id: evidenceCatalogueSourceId(input.kind, input.url), kind: input.kind,
    label: input.kind === "own_page" ? "Own site page" : input.kind === "competitor_page" ? "Competitor page" : input.kind,
    url: input.url, competitor,
    availability: "available", reason: null,
    /*
     * The observation's own instant, normalised to the canonical form the
     * evidence contract demands. Postgres hands back `+00:00` where the
     * producer wrote `Z`, and `canonicalTimestamp` compares the exact string.
     */
    observedAt: new Date(observedAtMs).toISOString(),
    bodyHash: observation.status.bodyHash, excerpts,
  } };
}

/**
 * What one own-page observation stored ABOUT the page, as the evidence contract
 * can carry it.
 *
 * Three answers per list, and the difference between the last two is the whole
 * point of reading them here rather than at the call site:
 *
 *  - `stored` -- the run recorded this list and every entry fits the evidence
 *    contract's own text rules, so the bundle can carry it whole.
 *  - `not_stored` -- the row has no such key. The run either predates the
 *    change that records it, or dropped it to stay inside the column's byte
 *    budget. It is NOT an empty list: "we did not keep it" and "the page has
 *    none" are different sentences and only one of them may be shown.
 *  - `unreadable` -- the key is there and the contract cannot take it whole:
 *    a control character, an over-long entry, a duplicate, or more entries than
 *    the page shape admits. Trimming it to fit would understate the page, so
 *    the list is refused and the caller withholds whatever rests on it.
 */
export type GeoKnowledgeStoredList =
  | { readonly kind: "stored"; readonly values: readonly string[] }
  | { readonly kind: "not_stored" }
  | { readonly kind: "unreadable" };

/**
 * The robots.txt a row proves it read IN FULL, or null.
 *
 * The assembler answers "may GPTBot crawl this site" by parsing rules, and its
 * only protection against answering from half a file is that a full excerpt
 * sample (eight lines, the ledger's cap) is treated as possibly truncated. Every
 * real robots.txt has more than eight lines, so that protection fired for every
 * site and no owner was ever told anything about AI crawler permissions.
 *
 * `robotsRules` is the producer's answer: written only when the whole file fit
 * the ledger, absent otherwise. Absent here means the excerpt fallback stands
 * and the assembler keeps saying the file was not read in full -- which is
 * still true for those rows, and true for every row written before this key
 * existed.
 */
export function creditGeoKnowledgeObservedRobots(
  observation: GeoEvidenceObservation | null,
): { readonly text: string } | null {
  if (observation === null || observation.status.kind !== "ok") return null;
  const rules = observation.status.structured.robotsRules;
  if (!Array.isArray(rules) || rules.length === 0) return null;
  if (!rules.every((rule) => typeof rule === "string" && usableSourceText(rule, 400))) return null;
  return { text: (rules as readonly string[]).join("\n") };
}

/** The alternates a row stored, complete enough for the contract's page shape. */
export type GeoKnowledgeStoredHreflang =
  | { readonly kind: "stored"; readonly values: readonly { readonly locale: string; readonly url: string }[] }
  | { readonly kind: "not_stored" }
  | { readonly kind: "unreadable" };

export interface GeoKnowledgeObservedStructure {
  /**
   * Question-and-answer markup the run parsed off the page, bounded twice: the
   * parser keeps at most 32 pairs and the evidence contract's page shape takes
   * at most 32. It is a sample of what the page carries and nothing counts it.
   * A pair the contract cannot carry is left out rather than shortened, because
   * a truncated answer is a different answer.
   */
  readonly faq: readonly { readonly question: string; readonly answer: string }[];
  readonly jsonLdTypes: GeoKnowledgeStoredList;
  readonly hreflangLocales: GeoKnowledgeStoredList;
  /**
   * The same alternates with the URL each points at.
   *
   * `hreflangLocales` alone cannot rebuild a page: the evidence contract pairs
   * every locale with its URL and refuses a bare locale, so a row that stored
   * only the list leaves the caller with no honest option but to withhold. A
   * row written before the pairs were recorded answers `not_stored` here while
   * `hreflangLocales` answers `stored`, and that difference is the whole point
   * -- it is "we kept half of it", not "the page has none".
   */
  readonly hreflang: GeoKnowledgeStoredHreflang;
}

/** The page shape's own caps, restated for the same reason the text rules are. */
const OBSERVED_PAGE_LIMITS = { faq: 32, jsonLdTypes: 32, hreflangLocales: 64, typeCodePoints: 120, textCodePoints: GEO_KNOWLEDGE_EVIDENCE_LIMITS.excerptCodePoints } as const;

function storedList(values: unknown, maximum: number, codePoints: number): GeoKnowledgeStoredList {
  if (values === undefined) return { kind: "not_stored" };
  if (!Array.isArray(values)) return { kind: "unreadable" };
  const entries = values as readonly unknown[];
  const usable = entries.every((value) => typeof value === "string" && usableSourceText(value, codePoints));
  if (!usable || entries.length > maximum) return { kind: "unreadable" };
  const strings = entries as readonly string[];
  if (new Set(strings).size !== strings.length) return { kind: "unreadable" };
  return { kind: "stored", values: strings };
}

/**
 * The alternates a row stored, as the contract's page shape can carry them.
 *
 * Refused whole rather than trimmed, for the reason every list here is: a page
 * declaring eight alternates and a page declaring the three of them that fit
 * are different pages, and only one of them is the owner's.
 */
function storedHreflang(values: unknown): GeoKnowledgeStoredHreflang {
  if (values === undefined) return { kind: "not_stored" };
  if (!Array.isArray(values)) return { kind: "unreadable" };
  const entries = values as readonly unknown[];
  if (entries.length > OBSERVED_PAGE_LIMITS.hreflangLocales) return { kind: "unreadable" };
  const pairs: { locale: string; url: string }[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") return { kind: "unreadable" };
    const { locale, url } = entry as { locale?: unknown; url?: unknown };
    if (typeof locale !== "string" || typeof url !== "string") return { kind: "unreadable" };
    if (!usableSourceText(locale, OBSERVED_PAGE_LIMITS.typeCodePoints) || !exactPublicSourceUrl(url)) return { kind: "unreadable" };
    pairs.push({ locale, url });
  }
  if (new Set(pairs.map((pair) => pair.locale)).size !== pairs.length
    || new Set(pairs.map((pair) => pair.url)).size !== pairs.length) return { kind: "unreadable" };
  return { kind: "stored", values: pairs };
}

/**
 * The page structure a stored own-page row is worth, or null when the row is
 * not a successful reading of that page at all.
 *
 * Reads the row and nothing else: no clock, no store, and no second parse of
 * any body. `pageData` in `kb-knowledge-evidence.ts` is what produced these
 * lists, and this only decides which of them the evidence contract can carry.
 */
export function creditGeoKnowledgeObservedStructure(
  observation: GeoEvidenceObservation | null,
): GeoKnowledgeObservedStructure | null {
  if (observation === null || observation.status.kind !== "ok") return null;
  const structured = observation.status.structured;
  const pairs = structured.faqPairs ?? [];
  return {
    faq: pairs
      .filter((pair) => usableSourceText(pair.question, OBSERVED_PAGE_LIMITS.textCodePoints)
        && usableSourceText(pair.answer, OBSERVED_PAGE_LIMITS.textCodePoints))
      .slice(0, OBSERVED_PAGE_LIMITS.faq)
      .map((pair) => ({ question: pair.question, answer: pair.answer })),
    jsonLdTypes: storedList(structured.jsonLdTypes, OBSERVED_PAGE_LIMITS.jsonLdTypes, OBSERVED_PAGE_LIMITS.typeCodePoints),
    hreflangLocales: storedList(structured.hreflangLocales, OBSERVED_PAGE_LIMITS.hreflangLocales, OBSERVED_PAGE_LIMITS.typeCodePoints),
    hreflang: storedHreflang(structured.hreflang),
  };
}

/**
 * One own-site page, rebuilt from what a run stored ABOUT it, or the reason it
 * cannot be.
 *
 * This exists because `machine.jsonLd` and `machine.hreflang` are derived from
 * the bundle's PAGES, while their citations come from its SOURCES. A run that
 * credits a stored own-page row contributes the source and no page, and both
 * summaries then read `absent` while citing the row that holds the answer --
 * which is what production reported on 2026-09-09 about a home page carrying
 * six JSON-LD types and a set of hreflang alternates.
 *
 * What it will not do is guess. The ledger stores no canonical URL, no title,
 * no `lang` and no links, so every one of those is null or empty here rather
 * than invented; a caller that needs them must read the page again. And when
 * either list is missing or unreadable the answer is `withheld`, never a page
 * with an empty list: "we did not keep it" and "the page has none" are
 * different sentences and only one of them may reach an owner.
 */
export type GeoKnowledgeRebuiltPage =
  | { readonly kind: "page"; readonly page: GeoKnowledgeEvidencePage }
  | { readonly kind: "withheld"; readonly reason: "not_stored" | "unreadable" };

export function creditGeoKnowledgeObservedPage(input: {
  readonly url: string;
  readonly structure: GeoKnowledgeObservedStructure;
}): GeoKnowledgeRebuiltPage {
  const { jsonLdTypes, hreflang } = input.structure;
  if (jsonLdTypes.kind === "not_stored" || hreflang.kind === "not_stored") return { kind: "withheld", reason: "not_stored" };
  if (jsonLdTypes.kind === "unreadable" || hreflang.kind === "unreadable") return { kind: "withheld", reason: "unreadable" };
  const alternates = hreflang.values.map((entry) => ({ locale: entry.locale, url: entry.url }));
  return { kind: "page", page: {
    url: input.url, canonicalUrl: null, title: null, description: null, lang: null,
    jsonLdTypes: [...jsonLdTypes.values],
    // The contract's page shape requires these two to agree entry for entry,
    // in order, so the list is derived here rather than read separately.
    hreflangLocales: alternates.map((entry) => entry.locale),
    hreflang: alternates,
    faq: input.structure.faq.map((pair) => ({ question: pair.question, answer: pair.answer })),
    links: [],
  } };
}

export interface GeoKnowledgeEvidenceCollectionInput {
  readonly userId: string;
  readonly kbId: string;
  readonly targetUrl: string;
  /**
   * The saved draft this collection is for. Carried so a collector can scope
   * itself to the draft rather than to caller-supplied text; the shipped
   * collector reads only `targetUrl` and `confirmedCompetitors`, which is why a
   * v3 draft can be handed to it unchanged.
   */
  readonly payload: GeoKbPayloadV2 | GeoKbPayloadV3;
  readonly confirmedCompetitors: readonly {
    readonly key: string;
    readonly name: string;
    readonly confirmed: true;
  }[];
  readonly reusedSources: readonly GeoKnowledgeEvidenceSource[];
}
export interface GeoKbGenerationPreparerDependencies {
  readonly readDetails: (input: { readonly userId: string; readonly kbId: string }) => Promise<{ readonly kind: "ok"; readonly value: Pick<VersionedGeoKbDetails, "kbId" | "origin" | "draft"> } | { readonly kind: "missing" | "unavailable" }>;
  readonly validateCurrentProfileCopy: (input: { readonly userId: string; readonly copy: GeoProfileCopy }) => Promise<"current" | "stale" | "unavailable">;
  readonly readReceipt: (input: { readonly userId: string; readonly kbId: string; readonly receiptId: string }) => Promise<{ readonly kind: "ok"; readonly value: unknown } | { readonly kind: "missing" | "unavailable" }>;
  readonly readGeneration: (input: { readonly userId: string; readonly kbId: string; readonly generationId: string }) => Promise<{ readonly kind: "ok"; readonly generation: GeoKbGenerationRecord } | { readonly kind: "missing" | "unavailable" }>;
  readonly resolveConfig: () => KeywordLlmConfig | null;
  readonly collectKnowledgeEvidence: (input: GeoKnowledgeEvidenceCollectionInput) => Promise<unknown>;
  readonly now: () => Date;
  readonly synthesizeRoles?: typeof synthesizeGeoKbRoles;
  readonly synthesizeQuestions?: typeof synthesizeGeoKbQuestions;
  readonly synthesizeKnowledge?: (input: GeoKnowledgeSynthesisInputV1, dependencies?: GeoKnowledgeSynthesisDependencies) => Promise<GeoKnowledgeSynthesisResult>;
  /** The v3 narrative runner. v1 drafts never reach it; v3 drafts never reach `synthesizeKnowledge`. */
  readonly synthesizeKnowledgeV2?: (input: GeoKnowledgeSynthesisInputV2, dependencies?: GeoKnowledgeSynthesisV2Dependencies) => Promise<GeoKnowledgeSynthesisV2Result>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const hash = /^[a-f0-9]{64}$/u;
const asValue = (value: unknown): GeoGenerationValue => JSON.parse(canonicalGeoV2Text(value)) as GeoGenerationValue;
function modelInput(provider: GeoSynthesisProvider, config: KeywordLlmConfig, timeoutMs: number) {
  return { modelRequested: provider.modelRequested, authScheme: provider.authScheme, temperature: String(provider.effectiveTemperature),
    maxOutputTokens: provider.maxOutputTokens, timeoutMs, endpointHash: createHash("sha256").update(config.url).digest("hex") };
}
/** A check that named itself, e.g. `Invalid role proposal output (english:roles.0.label)`. */
const NAMED_REJECTION = /\(([a-z_]+:[A-Za-z0-9_.]*)\)$/u;
/**
 * A message our own code wrote in full, e.g. `Role proposal exceeds byte
 * limit`. Deliberately narrow: a schema library's failure dump is JSON, so it
 * opens with `[` or `{` and carries quotes, braces and newlines, none of which
 * this admits.
 */
const FIXED_REJECTION = /^[A-Za-z][A-Za-z0-9 ._:/-]{0,119}$/u;
/**
 * The rejection token we are willing to carry out of a failed assembly.
 *
 * The thrown message is the only thing standing between a caller and a black
 * box, so the check's own name is kept -- and this value now leaves the process
 * in the generation response, so nothing else may be. Taking the first 120
 * characters of whatever was thrown does not hold that line: a strict schema
 * answers an unexpected key with a dump that quotes the model's own key names,
 * and a rejected enum value quotes the value. An unrecognised message is worth
 * less than the promise, so it becomes `unknown`.
 */
function rejectionOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const named = NAMED_REJECTION.exec(message)?.[1];
  if (named !== undefined && named !== "") return named.slice(0, 120);
  return FIXED_REJECTION.test(message) ? message : "unknown";
}

function invocation<T>(result: GeoSynthesisResult<T>, build: (value: T) => unknown): GeoKbGenerationInvocation {
  const attempt: GeoGenerationAttempt = { attemptedCalls: result.attemptedCalls, delivery: result.delivery, modelRequested: result.provider?.modelRequested ?? null,
    inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, requestCount: result.usage.requestCount };
  if (!result.ok) {
    const reason = result.delivery === "outcome_unknown" ? "outcome_unknown" : result.reason === "not_configured" ? "model_unavailable" : result.reason === "rate_limited" ? "rate_limited" : ["auth_failed", "bad_request", "server_error"].includes(result.reason) ? "provider_rejected" : "invalid_output";
    return { ok: false, reason, delivery: result.delivery, attempt };
  }
  try { return { ok: true, value: asValue(build(result.value)), attempt }; }
  catch (error) { return { ok: false, reason: "invalid_output", delivery: "response_received", attempt, rejection: rejectionOf(error) }; }
}
/**
 * What a narrative runner answers, without saying which narrative.
 *
 * The v1 and v2 runners differ only in the contract they parse; their attempt
 * accounting -- how many calls were made, whether the outcome is known, what the
 * provider reported -- is deliberately identical, because that is the one answer
 * a paid step may never get wrong. Making the invocation generic over the
 * narrative keeps that accounting in one place instead of two that can drift.
 */
type GeoNarrativeResult<T> =
  | { readonly ok: true; readonly value: T; readonly attemptedCalls: 1; readonly delivery: "response_received"; readonly provider: { readonly modelRequested: string }; readonly usage: KeywordLlmUsage }
  | { readonly ok: false; readonly reason: string; readonly attemptedCalls: 0 | 1; readonly delivery: "not_attempted" | "response_received" | "outcome_unknown"; readonly provider: { readonly modelRequested: string } | null; readonly usage: KeywordLlmUsage };
function knowledgeInvocation<T>(result: GeoNarrativeResult<T>, build: (value: T) => unknown): GeoKbGenerationInvocation {
  const attempt: GeoGenerationAttempt = { attemptedCalls: result.attemptedCalls, delivery: result.delivery, modelRequested: result.provider?.modelRequested ?? null,
    inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, requestCount: result.usage.requestCount };
  if (!result.ok) {
    const reason = result.delivery === "outcome_unknown" ? "outcome_unknown" : result.reason === "not_configured" ? "model_unavailable" : result.reason === "rate_limited" ? "rate_limited" : ["auth_failed", "bad_request", "server_error"].includes(result.reason) ? "provider_rejected" : "invalid_output";
    return { ok: false, reason, delivery: result.delivery, attempt };
  }
  try { return { ok: true, value: asValue(build(result.value)), attempt }; }
  catch (error) { return { ok: false, reason: "invalid_output", delivery: "response_received", attempt, rejection: rejectionOf(error) }; }
}
const unknownInvocation = (modelRequested: string): GeoKbGenerationInvocation => ({ ok: false, reason: "outcome_unknown", delivery: "outcome_unknown",
  attempt: { attemptedCalls: 1, delivery: "outcome_unknown", modelRequested, inputTokens: null, outputTokens: null, requestCount: null } });
class PreparationFailure extends Error {
  constructor(readonly kind: "invalid_input" | "unavailable") { super(kind); }
}
function invalid(): never { throw new PreparationFailure("invalid_input"); }
const same = (left: unknown, right: unknown): boolean => canonicalGeoV2Text(left) === canonicalGeoV2Text(right);
function mergeSources(...groups: readonly (readonly GeoSynthesisSource[])[]): GeoSynthesisSource[] {
  const items = new Map<string, GeoSynthesisSource>();
  for (const group of groups) for (const item of group) {
    if (items.has(item.id) && !same(items.get(item.id), item)) invalid();
    items.set(item.id, item);
  }
  return [...items.values()];
}
function evidenceCounts(sources: readonly GeoSynthesisSource[]) {
  const counts = { profile: 0, gsc: 0, crawl: 0, manual: 0 };
  for (const source of sources) counts[source.kind] += 1;
  if (Object.values(counts).some((count) => count > 10_000)) invalid();
  return counts;
}
function sourceSummary(reports: readonly GeoKbSourceReportV2[], selected: readonly GeoSynthesisSource[], available: readonly GeoSynthesisSource[]): GeoSourceSummaryV2 {
  const ordered = [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.receiptId.localeCompare(b.receiptId));
  const primary = ordered.find((report) => report.gsc.status === "available") ?? ordered[0];
  const gsc = primary === undefined ? null : (({ queries: _queries, ...metadata }) => metadata)(primary.gsc);
  return { gsc, selectedEvidenceCounts: evidenceCounts(selected), availableEvidenceCounts: evidenceCounts(available) };
}
function admittedFacts(payload: GeoKbPayloadV2, receipts: ReadonlyMap<string, GeoKbSourceReportV2>) {
  const facts: GeoAdmittedQuestionFact[] = [], verifiedFactSupport: GeoVerifiedFactSupportV2[] = [];
  for (const fact of payload.facts) {
    if (fact.review !== "accepted" || fact.value === "" || fact.reason !== "") continue;
    if (fact.supportRef !== null) {
      const receipt = receipts.get(fact.supportRef.receiptId);
      const support = receipt?.facts.find((entry) => entry.evidenceId === fact.supportRef!.evidenceId);
      if (!support || support.status !== "available" || support.source !== "crawl" || support.key !== fact.key || support.value !== fact.value || support.sourceUrl !== fact.sourceUrl || support.observedAt !== fact.observedAt) invalid();
      verifiedFactSupport.push({ ...fact.supportRef, key: fact.key, value: fact.value, sourceUrl: fact.sourceUrl, observedAt: fact.observedAt });
    }
    facts.push({ key: fact.key, value: fact.value, sourceUrl: fact.sourceUrl, observedAt: fact.observedAt, source: fact.supportRef === null ? "user_confirmed" : "crawl" });
  }
  return { facts, verifiedFactSupport };
}
function knowledgeSourceId(kind: "fact" | "gsc", value: unknown): string {
  return `knowledge-${kind}-${geoV2Digest(value).slice(0, 24)}`;
}
function knowledgeReusableSources(payload: GeoKbPayloadV2, receipts: ReadonlyMap<string, GeoKbSourceReportV2>, selectedReceiptIds: ReadonlySet<string>): GeoKnowledgeEvidenceSource[] {
  const sources: GeoKnowledgeEvidenceSource[] = [];
  for (const fact of payload.facts.filter(item => item.review === "accepted" && item.value !== "" && item.reason === "").slice(0, 8)) {
    if (fact.supportRef === null) {
      sources.push({ id: knowledgeSourceId("fact", { key: fact.key, value: fact.value }), kind: "accepted_fact", label: fact.key, url: null, competitor: null,
        availability: "available", reason: null, observedAt: null, bodyHash: null, excerpts: [fact.value] });
      continue;
    }
    const report = receipts.get(fact.supportRef.receiptId);
    const support = report?.facts.find(item => item.evidenceId === fact.supportRef!.evidenceId);
    if (!support || support.status !== "available" || support.source !== "crawl" || support.key !== fact.key || support.value !== fact.value || support.sourceUrl !== fact.sourceUrl || support.observedAt !== fact.observedAt || support.bodyHash === null || support.excerpt === null) invalid();
    sources.push({ id: knowledgeSourceId("fact", { receiptId: report!.receiptId, evidenceId: support.evidenceId }), kind: "accepted_fact", label: fact.key,
      // Facts are declarations, not fetched resources. Keeping their receipt
      // URL here would participate in collector URL dedupe and could suppress
      // the independent own-page crawl (including the homepage itself).
      url: null, competitor: null, availability: "available", reason: null, observedAt: support.observedAt, bodyHash: support.bodyHash, excerpts: [support.excerpt] });
  }
  const gsc = [...receipts.values()].filter(report => selectedReceiptIds.has(report.receiptId) && report.gsc.status === "available" && report.gsc.queries.length > 0)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.receiptId.localeCompare(right.receiptId))[0];
  if (gsc?.gsc.status === "available") {
    const partial = gsc.gsc.truncated || gsc.gsc.queries.length > 8;
    sources.push({ id: knowledgeSourceId("gsc", { receiptId: gsc.receiptId, contentHash: gsc.contentHash }), kind: "gsc", label: "Search Console queries", url: null,
      competitor: null, availability: partial ? "partial" : "available", reason: partial ? "partial_body" : null, observedAt: gsc.gsc.observedAt, bodyHash: null, excerpts: gsc.gsc.queries.slice(0, 8).map(query => query.text) });
  }
  if (sources.length > 9 || sources.some(source => source.excerpts.length > 8)) invalid();
  return sources;
}
function durableInput(value: unknown): Readonly<Record<string, GeoGenerationValue>> {
  const parsed = asValue(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) invalid();
  return parsed as Readonly<Record<string, GeoGenerationValue>>;
}
type SelectedKnowledge = { readonly record: GeoKbGenerationRecord; readonly result: GeoKnowledgeGenerationResultV1 };
async function readSelectedKnowledge(input: { readonly userId: string; readonly kbId: string; readonly generationId: string; readonly payload: GeoKbPayloadV2; readonly base: { readonly baseDraftVersion: string; readonly baseDraftHash: string; readonly profileCopyHash: string } }, dependencies: Pick<GeoKbGenerationPreparerDependencies, "readGeneration">): Promise<{ readonly kind: "ok"; readonly value: SelectedKnowledge } | { readonly kind: "invalid_input" | "input_stale" | "unavailable" }> {
  const read = await dependencies.readGeneration({ userId: input.userId, kbId: input.kbId, generationId: input.generationId }).catch(() => ({ kind: "unavailable" as const }));
  if (read.kind !== "ok") return { kind: read.kind === "unavailable" ? "unavailable" : "invalid_input" };
  const record = read.generation;
  if (record.generationId !== input.generationId || record.userId !== input.userId || record.kbId !== input.kbId || record.kind !== "knowledge_pack" || record.state !== "succeeded" || record.errorReason !== null || record.attempt?.attemptedCalls !== 1 || record.attempt.delivery !== "response_received") return { kind: "invalid_input" };
  let result: GeoKnowledgeGenerationResultV1;
  try {
    result = parseGeoKnowledgeGenerationResultV1(record.result);
    if (result.generationId !== record.generationId || result.kbId !== record.kbId || geoGenerationInputHash("knowledge_pack", durableInput(result.manifest)) !== record.inputHash) return { kind: "invalid_input" };
  } catch { return { kind: "invalid_input" }; }
  if (result.manifest.baseDraftVersion !== input.base.baseDraftVersion || result.manifest.baseDraftHash !== input.base.baseDraftHash || result.manifest.profileCopyHash !== input.base.profileCopyHash) return { kind: "input_stale" };
  const synthesis = result.synthesisInput;
  const confirmedCompetitors = input.payload.competitors.filter(competitor => competitor.confirmed).map(competitor => ({ key: competitor.domain, name: competitor.brandName, confirmed: true }));
  if (synthesis.targetUrl !== new URL(input.payload.targetUrl).toString() || synthesis.officialName !== input.payload.officialName || !same(synthesis.aliases, input.payload.aliases)
    || !same(synthesis.categoryTerms, input.payload.categoryTerms) || synthesis.market !== input.payload.market.country || synthesis.language !== input.payload.market.language
    || !same(synthesis.confirmedCompetitors, confirmedCompetitors)) return { kind: "invalid_input" };
  return { kind: "ok", value: { record, result } };
}
function declaredRoleSources(payload: GeoKbPayloadV2, profileSources: readonly GeoSynthesisSource[]): GeoSynthesisSource[] {
  const known = new Map(profileSources.map((source) => [source.id, source]));
  const out: GeoSynthesisSource[] = [];
  for (const role of payload.roles) {
    if (role.source.kind === "model") continue;
    for (const id of role.source.evidenceRefs) {
      if (role.source.kind === "profile") {
        const source = known.get(id); if (!source) invalid(); out.push(source);
      } else {
        if (id !== `manual:${role.id}`) invalid();
        const { source: _source, ...declaration } = role;
        out.push({ id, kind: "manual", text: `Saved manual role declaration: ${canonicalGeoV2Text(declaration)}` });
      }
    }
  }
  return mergeSources(out);
}
type LineageReaders = Pick<GeoKbGenerationPreparerDependencies, "readReceipt" | "readGeneration">;
interface LineageScope { readonly userId: string; readonly kbId: string; readonly payload: GeoKbPayloadV2 }
function receiptReader(scope: { readonly userId: string; readonly kbId: string; readonly targetUrl: string; readonly copy: GeoProfileCopy }, dependencies: Pick<LineageReaders, "readReceipt">) {
  const receipts = new Map<string, GeoKbSourceReportV2>();
  return {
    receipts,
    refs: (): GeoSourceReceiptRef[] => [...receipts.values()].map(({ receiptId, contentHash }) => ({ receiptId, contentHash })).sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
    sources: (): GeoSynthesisSource[] => [...receipts.values()].sort((a, b) => a.receiptId.localeCompare(b.receiptId)).flatMap(geoKbSourceCatalogueV2),
    load: async (selected: readonly { readonly receiptId: string; readonly contentHash?: string }[], historical = false): Promise<void> => {
      for (const ref of selected) {
        if (!uuid.test(ref.receiptId) || ref.contentHash !== undefined && !hash.test(ref.contentHash)) invalid();
        let report = receipts.get(ref.receiptId);
        if (report === undefined) {
          if (receipts.size >= 32) invalid();
          const read = await dependencies.readReceipt({ userId: scope.userId, kbId: scope.kbId, receiptId: ref.receiptId }).catch(() => ({ kind: "unavailable" as const }));
          if (read.kind !== "ok") throw new PreparationFailure(read.kind === "missing" ? "invalid_input" : "unavailable");
          report = verifyGeoKbSourceReportV2(read.value);
        }
        if (report.receiptId !== ref.receiptId || ref.contentHash !== undefined && report.contentHash !== ref.contentHash || report.kbId !== scope.kbId || report.targetHost !== normalizeAccountWebsiteUrl(scope.targetUrl)?.host) invalid();
        if (historical ? report.profileReference !== null && report.profileReference.websiteId !== scope.copy.websiteId : !same(report.profileReference, profileCopyReference(scope.copy))) invalid();
        receipts.set(ref.receiptId, report);
      }
    },
  };
}
async function readRoleProposals(scope: LineageScope, dependencies: Pick<LineageReaders, "readGeneration">): Promise<GeoRoleProposal[]> {
  const proposals: GeoRoleProposal[] = [];
  for (const generationId of new Set(scope.payload.roles.flatMap((role) => role.source.kind === "model" ? [role.source.generationId!] : []))) {
    if (!uuid.test(generationId)) invalid();
    const read = await dependencies.readGeneration({ userId: scope.userId, kbId: scope.kbId, generationId }).catch(() => ({ kind: "unavailable" as const }));
    if (read.kind !== "ok") throw new PreparationFailure(read.kind === "missing" ? "invalid_input" : "unavailable");
    const record = read.generation;
    if (record.generationId !== generationId || record.userId !== scope.userId || record.kbId !== scope.kbId || record.kind !== "roles" || record.state !== "succeeded" || record.errorReason !== null || !hash.test(record.inputHash)) invalid();
    const proposal = parseGeoRoleProposal(record.result);
    if (proposal.generationId !== generationId || proposal.kbId !== scope.kbId) invalid();
    proposals.push(proposal);
  }
  return proposals;
}

/** previousPayload, when supplied, must be the owner-read saved draft, never
 * another HTTP field. Draft retention is not current preparation eligibility. */
export async function validateGeoKbDraftLineage(input: LineageScope & { readonly previousPayload?: AnyGeoKbPayload }, dependencies: LineageReaders): Promise<"valid" | "invalid" | "unavailable"> {
  try {
    if (!uuid.test(input.userId) || !uuid.test(input.kbId)) invalid();
    const payload = parseGeoKbPayloadV2(input.payload);
    assertGeoProfileCopyIntegrity(payload.profileCopy);
    const scope = { userId: input.userId, kbId: input.kbId, payload };
    const reader = receiptReader({ ...scope, targetUrl: payload.targetUrl, copy: payload.profileCopy }, dependencies);
    const profiles = buildGeoRoleSynthesisBasis(payload, "en", []).input.sources;
    const knownProfiles = new Set(profiles.map((source) => source.id));
    const proposals = await readRoleProposals(scope, dependencies);
    for (const role of payload.roles) {
      if (role.source.kind === "model") {
        const proposal = proposals.find((entry) => entry.generationId === role.source.generationId);
        if (!proposal) invalid();
        const current = role.review === "accepted";
        const lineage = resolveGeoModelRoleLineage({ kbId: input.kbId, roles: [role], proposals: [proposal],
          profileCopyHash: current ? geoV2Digest(payload.profileCopy) : proposal.profileCopyHash,
          officialName: current ? payload.officialName : proposal.input.officialName,
          language: current ? payload.market.language : proposal.input.questionLanguage });
        await reader.load(lineage.sourceReceiptRefs, !current);
        const known = new Map(mergeSources(profiles, reader.sources()).map((source) => [source.id, source]));
        for (const source of lineage.evidenceCatalog) {
          // Historical Profile wording is already sealed inside the owned
          // succeeded proposal. It supplies no accepted/current authority.
          if (!current && source.kind === "profile") continue;
          if (!known.has(source.id) || !same(known.get(source.id), source)) invalid();
        }
      } else if (role.source.kind === "profile" && role.review !== "accepted" && role.source.evidenceRefs.some((id) => !knownProfiles.has(id))) {
        if (input.previousPayload?.schemaVersion !== GEO_KB_SCHEMA_VERSION_V2) invalid();
        const previous = parseGeoKbPayloadV2(input.previousPayload);
        assertGeoProfileCopyIntegrity(previous.profileCopy);
        if (previous.profileCopy.websiteId !== payload.profileCopy.websiteId || normalizeAccountWebsiteUrl(previous.targetUrl)?.host !== normalizeAccountWebsiteUrl(payload.targetUrl)?.host) invalid();
        const original = previous.roles.find((entry) => entry.id === role.id);
        if (!original || !same(original.source, role.source)) invalid();
        declaredRoleSources({ ...previous, roles: [original] }, buildGeoRoleSynthesisBasis(previous, "en", []).input.sources);
      } else declaredRoleSources({ ...payload, roles: [role] }, profiles);
    }
    for (const fact of payload.facts) {
      if (fact.supportRef === null) continue;
      const positive = fact.review === "accepted" && fact.value !== "" && fact.reason === "";
      await reader.load([{ receiptId: fact.supportRef.receiptId }], !positive);
      const support = reader.receipts.get(fact.supportRef.receiptId)?.facts.find((entry) => entry.evidenceId === fact.supportRef!.evidenceId);
      if (!support || support.status !== "available" || support.source !== "crawl") invalid();
      // Pending/excluded pointers retain the original observed tuple. They do
      // not assert that newly edited provisional wording matches that tuple.
      if (positive) admittedFacts({ ...payload, facts: [fact] }, reader.receipts);
    }
    return "valid";
  } catch (error) { return error instanceof PreparationFailure && error.kind === "unavailable" ? "unavailable" : "invalid"; }
}

type GeoKbGenerationRequestInput = Parameters<GeoKbGenerationHandlerDependencies["prepare"]>[0];
type GeoKbGenerationPreparation = Awaited<ReturnType<GeoKbGenerationHandlerDependencies["prepare"]>>;

/**
 * What a refused preparation is called on the wire.
 *
 * Four adapters answer a preflight refusal -- roles, questions, knowledge v1
 * and knowledge v2 -- and every one of them can say `input_too_large`: the
 * payload is well formed and inside its contract, and the prompt it would buy
 * is bigger than we are willing to pay to send. This function is the only
 * place that names those reasons, so the four call sites cannot drift.
 *
 * `input_too_large` used to fall through to `invalid_input`, which is the same
 * answer a corrupt payload gets. The two need different actions from an owner
 * -- one is "fix your draft", the other is "there is more evidence here than
 * one request can carry" -- and an owner told the wrong one has nothing to do.
 *
 * It is deliberately not called `payload_too_large`: that name already means
 * "the posted HTTP body exceeded the read cap" (`readAccountMutationJson`), and
 * this refusal is about the prompt, not about what the client sent.
 *
 * Everything else stays `invalid_input`. `schema_invalid` and
 * `insufficient_basis` are both "this input cannot be asked", and neither adds
 * an action the owner does not already have.
 */
function preparationRefusal(reason: string): { readonly kind: "model_unavailable" | "unsupported_language" | "input_too_large" | "invalid_input" } {
  if (reason === "not_configured") return { kind: "model_unavailable" };
  if (reason === "unsupported_language") return { kind: "unsupported_language" };
  if (reason === "input_too_large") return { kind: "input_too_large" };
  return { kind: "invalid_input" };
}

/**
 * Preflight for a v3 draft.
 *
 * A v3 draft carries `profileRef` -- an immutable pointer at the confirmed
 * Profile snapshot plus the 13 fields GEO reads -- where v1/v2 carried a whole
 * `profileCopy`. Three things move because of that, and one deliberately does
 * not:
 *
 *   The durable input names `generationInputHash` where v1/v2 names
 *   `profileCopyHash`. That is the whole v3 identity: the hash is locked once,
 *   right after the roles step, and every record bought under it stays reusable
 *   through a review that edits the draft around it.
 *
 *   That hash is RE-DERIVED here, never minted. `geoGenerationInputHashV3` is
 *   the single definition, and it has to agree with the value already recorded
 *   in `runRef` -- the claim refuses an input whose hash is not the draft's own
 *   (`marketing_geo_generation_input_current`, v3 branch), so a draft whose
 *   recorded hash has drifted from the input it carries has nothing to buy.
 *
 *   Profile currency stays the database's answer. The v1/v2 body asks
 *   `validateCurrentProfileCopy`; the v3 equivalent compares `profileRef`
 *   against the website's current confirmed snapshot under the same SHARE lock
 *   Profile confirmation takes, which is a decision only the transaction that
 *   holds that lock can make. A second answer here could disagree with the
 *   authoritative one, and the weaker of two disagreeing answers is worse than
 *   one answer.
 *
 * What does not move is the money rule: nothing below returns `ready` unless a
 * result of that kind can actually be stored, because `ready` is the
 * authorization to spend.
 */
async function prepareGeoKbV3Generation(
  request: GeoKbGenerationRequestInput,
  loaded: { readonly origin: string; readonly draft: { readonly payload: unknown; readonly contentHash: string } },
  dependencies: GeoKbGenerationPreparerDependencies,
): Promise<GeoKbGenerationPreparation> {
  let payload: GeoKbPayloadV3;
  try {
    payload = parseGeoKbPayloadV3(loaded.draft.payload);
    if (geoV2Digest(payload) !== loaded.draft.contentHash
      || normalizeAccountWebsiteUrl(payload.generationInput.identity.targetUrl)?.host !== normalizeAccountWebsiteUrl(loaded.origin)?.host) return { kind: "unavailable" };
  } catch { return { kind: "invalid_input" }; }
  const generationInputHash = geoGenerationInputHashV3(payload);
  if (generationInputHash !== payload.runRef.generationInputHash) return { kind: "input_stale" };
  /**
   * Two request fields a v3 draft cannot honour, refused rather than ignored.
   *
   * `sourceReceiptRefs` names v2 source receipts, and a receipt is admitted by
   * comparing its `profileReference` against the draft's `profileCopy` -- the
   * field a v3 draft does not have. Accepting the refs and skipping that
   * comparison would put unverified receipt bytes into a paid input.
   *
   * `knowledgeGenerationId` is the v2 candidate binding, which exists because a
   * v2 questions run mints a candidate that has to name the knowledge it
   * embedded. A v3 questions run mints no candidate; its knowledge is bound
   * through `runRef` and read at publish time.
   */
  if (request.sourceReceiptRefs.length > 0 || request.knowledgeGenerationId !== undefined) return { kind: "invalid_input" };
  if (request.kind !== "knowledge_pack") return { kind: "unsupported_draft" };

  const { identity, profileRef, competitors } = payload.generationInput;
  /*
   * No language refusal here, deliberately (design decision D8).
   *
   * This was the gate that actually stopped a non-English site: it answered
   * `unsupported_language`, which the generation route turns into 422, so the
   * knowledge step of a Chinese site's update refused before it reached a
   * provider. The English registry governs the QUESTION SET, and a v3 run has
   * no questions step at all -- so the refusal cost the site its knowledge body
   * to protect a step nobody was going to run. The synthesis prompt now names
   * the site's own language, and the absent question set is stated at publish
   * time with the reason that is true for that site.
   *
   * The v1 chain beside this one keeps its refusal: that flow really does
   * dispatch a questions step against the English registry.
   */
  let config: KeywordLlmConfig | null;
  try { const resolved = dependencies.resolveConfig(); config = resolved === null ? null : { ...resolved }; }
  catch { return { kind: "model_unavailable" }; }
  if (!isUsableGeoSynthesisConfig(config)) return { kind: "model_unavailable" };
  const capture = config;

  const confirmedCompetitors = competitors.filter(competitor => competitor.confirmed).map(competitor => ({ key: competitor.domain, name: competitor.brandName, confirmed: true as const }));
  const targetUrl = new URL(identity.targetUrl).toString();
  let rawEvidence: unknown;
  try {
    rawEvidence = await dependencies.collectKnowledgeEvidence({ userId: request.userId, kbId: request.kbId, targetUrl, payload,
      confirmedCompetitors,
      // A v3 draft reuses nothing here. Reuse in v1/v2 means accepted facts and
      // Search Console queries carried by a source receipt, and this path has
      // just refused receipts; the knowledge already in `payload.knowledge` is
      // an output of an earlier run, not observed evidence this one may cite.
      reusedSources: [] });
  } catch { return { kind: "unavailable" }; }
  try {
    const evidence = parseGeoKnowledgeEvidenceV1(rawEvidence);
    if (evidence.availability === "unavailable" || evidence.targetUrl !== targetUrl || !same(evidence.confirmedCompetitors, confirmedCompetitors)) return { kind: "invalid_input" };
    const synthesisInput = buildGeoKnowledgeSynthesisInputV2({ officialName: identity.officialName, aliases: identity.aliases, categoryTerms: identity.categoryTerms,
      market: identity.market.country, language: identity.market.language, profileRef, generationInputHash }, evidence);
    const prepared = prepareGeoKnowledgeSynthesisV2(synthesisInput, capture);
    if (!prepared.ok) return preparationRefusal(prepared.reason);
    /**
     * The manifest is assembled here rather than by a builder because
     * kb-knowledge-synthesis-v2-contract.ts exports the v2 manifest only as the
     * `manifest` member of a result. Its seven keys are pinned by
     * `marketing_geo_knowledge_input_valid` (v2 branch) at claim time and by
     * `parseGeoKnowledgeGenerationResultV2` when the result is built, so a
     * malformed one is refused before anything is dispatched -- but a v2
     * `buildGeoKnowledgeGenerationInputManifestV2` would let it be refused
     * here, one call earlier, and is the seam to close.
     */
    const manifest = { schemaVersion: GEO_KNOWLEDGE_GENERATION_INPUT_V2_SCHEMA, kbId: request.kbId, baseDraftVersion: String(request.baseVersion),
      baseDraftHash: request.draftHash, generationInputHash, sourceReceiptRefs: [], knowledgeSynthesisInput: prepared.value.input };
    const input = durableInput(manifest);
    if (geoV2JsonbBytes(input) > GEO_GENERATION_INPUT_BYTES) return { kind: "invalid_input" };
    return { kind: "ready", input,
      invoke: async (generationId) => {
        try {
          const result = await (dependencies.synthesizeKnowledgeV2 ?? synthesizeGeoKnowledgeNarrativeV2)(prepared.value.input, { config: capture, timeoutMs: prepared.value.timeoutMs });
          return knowledgeInvocation<Extract<GeoKnowledgeSynthesisV2Result, { readonly ok: true }>["value"]>(result, narrative => buildGeoKnowledgeGenerationResultV2({
            schemaVersion: GEO_KNOWLEDGE_GENERATION_RESULT_V2_SCHEMA, generationId, kbId: request.kbId, manifest,
            synthesisInput: prepared.value.input, evidence, narrative, generatedAt: dependencies.now().toISOString() }));
        } catch { return unknownInvocation(capture.model); }
      } };
  } catch (error) { return { kind: error instanceof PreparationFailure ? error.kind : "invalid_input" }; }
}

export function createGeoKbGenerationPreparer(dependencies: GeoKbGenerationPreparerDependencies): GeoKbGenerationHandlerDependencies["prepare"] {
  return async (request) => {
    if (!uuid.test(request.userId) || !uuid.test(request.kbId) || !Number.isSafeInteger(request.baseVersion) || request.baseVersion < 1 || !hash.test(request.draftHash) || !["roles", "questions", "knowledge_pack"].includes(request.kind)
      || request.knowledgeGenerationId !== undefined && (request.kind !== "questions" || !uuid.test(request.knowledgeGenerationId))
      || !Array.isArray(request.sourceReceiptRefs) || request.sourceReceiptRefs.length > 32 || new Set(request.sourceReceiptRefs.map((ref) => ref.receiptId)).size !== request.sourceReceiptRefs.length) return { kind: "invalid_input" };
    const loaded = await dependencies.readDetails({ userId: request.userId, kbId: request.kbId }).catch(() => ({ kind: "unavailable" as const }));
    if (loaded.kind !== "ok") return { kind: loaded.kind };
    if (loaded.value.kbId !== request.kbId) return { kind: "unavailable" };
    const draft = loaded.value.draft;
    if (draft === null) return { kind: "invalid_input" };
    if (draft.draftVersion !== request.baseVersion || draft.contentHash !== request.draftHash) return { kind: "input_stale" };
    // Before `parseAnyGeoKbPayload`, which knows only v1 and v2 and answers a v3
    // draft with `invalid_input` -- the refusal that made every v3 generation
    // unreachable.
    if (isGeoKbPayloadV3(draft.payload)) return await prepareGeoKbV3Generation(request, { origin: loaded.value.origin, draft }, dependencies);
    let payload;
    try {
      payload = parseAnyGeoKbPayload(draft.payload);
      if (geoV2Digest(payload) !== draft.contentHash || normalizeAccountWebsiteUrl(payload.targetUrl)?.host !== normalizeAccountWebsiteUrl(loaded.value.origin)?.host) return { kind: "unavailable" };
      if (payload.profileCopy === undefined) return { kind: "invalid_input" };
      assertGeoProfileCopyIntegrity(payload.profileCopy);
    } catch { return { kind: "invalid_input" }; }
    if (request.kind !== "roles" && (payload.schemaVersion !== GEO_KB_SCHEMA_VERSION_V2 || payload.roles.some((role) => role.review === "pending") || payload.facts.some((fact) => fact.review === "pending"))) return { kind: "invalid_input" };
    const current = await dependencies.validateCurrentProfileCopy({ userId: request.userId, copy: payload.profileCopy }).catch(() => "unavailable" as const);
    if (current !== "current") return { kind: current === "stale" ? "input_stale" : "unavailable" };
    if (request.kind === "knowledge_pack" && geoGenerationLanguage(payload.market.language) === null) return { kind: "unsupported_language" };
    let config: KeywordLlmConfig | null;
    try { const resolved = dependencies.resolveConfig(); config = resolved === null ? null : { ...resolved }; }
    catch { return { kind: "model_unavailable" }; }
    if (!isUsableGeoSynthesisConfig(config)) return { kind: "model_unavailable" };
    const base = { kbId: request.kbId, baseDraftVersion: String(request.baseVersion), baseDraftHash: request.draftHash, profileCopyHash: geoV2Digest(payload.profileCopy) };
    try {
      const capture = config;
      const reader = receiptReader({ userId: request.userId, kbId: request.kbId, targetUrl: payload.targetUrl, copy: payload.profileCopy! }, dependencies);
      await reader.load(request.sourceReceiptRefs);
      const { receipts, refs: receiptRefs, sources: receiptSources } = reader;
      if (request.kind === "roles") {
        const basis = buildGeoRoleSynthesisBasis(payload, request.displayLocale, receiptSources());
        if (Object.values(basis.availableEvidenceCounts).some((count) => count > 10_000)) invalid();
        const prepared = prepareGeoRoleSynthesis(basis.input, capture);
        if (!prepared.ok) return preparationRefusal(prepared.reason);
        const sourceReceiptRefs = receiptRefs();
        return { kind: "ready", input: { ...base, promptHash: geoV2Digest(prepared.value.prompt), promptVersion: prepared.value.promptVersion,
          responseSchemaHash: geoV2Digest(prepared.value.responseJsonSchema), provider: modelInput(prepared.value.provider, capture, prepared.value.timeoutMs), sourceReceiptRefs: sourceReceiptRefs.map((ref) => ({ ...ref })) },
          invoke: async (generationId) => {
            try {
              const result = await (dependencies.synthesizeRoles ?? synthesizeGeoKbRoles)(prepared.value.input, { config: capture, timeoutMs: prepared.value.timeoutMs });
              return invocation(result, (output) => createGeoRoleProposal({ ...base, generationId, input: prepared.value.input, output, sourceReceiptRefs,
                selectedEvidenceCounts: basis.selectedEvidenceCounts, availableEvidenceCounts: basis.availableEvidenceCounts }));
            } catch { return unknownInvocation(capture.model); }
          } };
      }
      if (request.kind === "knowledge_pack") {
        const finalPayload = parseGeoKbPayloadV2(payload);
        await reader.load(finalPayload.facts.flatMap(fact => fact.review === "accepted" && fact.value !== "" && fact.reason === "" && fact.supportRef !== null ? [{ receiptId: fact.supportRef.receiptId }] : []));
        const reusedSources = knowledgeReusableSources(finalPayload, receipts, new Set(request.sourceReceiptRefs.map(ref => ref.receiptId)));
        const confirmedCompetitors = finalPayload.competitors.filter(competitor => competitor.confirmed).map(competitor => ({ key: competitor.domain, name: competitor.brandName, confirmed: true as const }));
        const targetUrl = new URL(finalPayload.targetUrl).toString();
        let rawEvidence: unknown;
        try {
          rawEvidence = await dependencies.collectKnowledgeEvidence({ userId: request.userId, kbId: request.kbId, targetUrl, payload: finalPayload,
            confirmedCompetitors, reusedSources });
        } catch { return { kind: "unavailable" }; }
        const evidence = parseGeoKnowledgeEvidenceV1(rawEvidence);
        if (evidence.availability === "unavailable" || evidence.targetUrl !== targetUrl || !same(evidence.confirmedCompetitors, confirmedCompetitors)
          || reusedSources.some(source => !evidence.sourceCatalogue.some(candidate => candidate.id === source.id && same(candidate, source)))) return { kind: "invalid_input" };
        const synthesisInput = buildGeoKnowledgeSynthesisInputV1({ officialName: finalPayload.officialName, aliases: finalPayload.aliases, categoryTerms: finalPayload.categoryTerms,
          market: finalPayload.market.country, language: finalPayload.market.language }, evidence);
        const prepared = prepareGeoKnowledgeSynthesis(synthesisInput, capture);
        if (!prepared.ok) return preparationRefusal(prepared.reason);
        const manifest = buildGeoKnowledgeGenerationInputManifest({ ...base, sourceReceiptRefs: receiptRefs(), knowledgeSynthesisInput: prepared.value.input });
        const input = durableInput(manifest);
        if (geoV2JsonbBytes(input) > GEO_GENERATION_INPUT_BYTES) return { kind: "invalid_input" };
        return { kind: "ready", input,
          invoke: async (generationId) => {
            try {
              const result = await (dependencies.synthesizeKnowledge ?? synthesizeGeoKnowledgeNarrative)(prepared.value.input, { config: capture, timeoutMs: prepared.value.timeoutMs });
              return knowledgeInvocation<Extract<GeoKnowledgeSynthesisResult, { readonly ok: true }>["value"]>(result, narrative => buildGeoKnowledgeGenerationResultV1({ schemaVersion: "marketing-geo-knowledge-generation-result.v1",
                generationId, kbId: request.kbId, manifest, evidence, synthesisInput: prepared.value.input, narrative, generatedAt: dependencies.now().toISOString() }));
            } catch { return unknownInvocation(capture.model); }
          } };
      }
      const finalPayload = parseGeoKbPayloadV2(payload);
      let selectedKnowledge: SelectedKnowledge | null = null;
      if (request.knowledgeGenerationId !== undefined) {
        const selected = await readSelectedKnowledge({ userId: request.userId, kbId: request.kbId, generationId: request.knowledgeGenerationId, payload: finalPayload, base }, dependencies);
        if (selected.kind !== "ok") return { kind: selected.kind };
        selectedKnowledge = selected.value;
      }
      const proposals = await readRoleProposals({ userId: request.userId, kbId: request.kbId, payload: parseGeoKbPayloadV2(payload) }, dependencies);
      if (proposals.some((proposal) => proposal.profileCopyHash !== base.profileCopyHash || proposal.input.officialName !== finalPayload.officialName || proposal.input.questionLanguage !== finalPayload.market.language)) return { kind: "input_stale" };
      const lineage = resolveGeoModelRoleLineage({ kbId: request.kbId, profileCopyHash: base.profileCopyHash, officialName: finalPayload.officialName, language: finalPayload.market.language, roles: finalPayload.roles, proposals });
      await reader.load(lineage.sourceReceiptRefs);
      await reader.load(finalPayload.facts.flatMap((fact) => fact.review === "accepted" && fact.value !== "" && fact.reason === "" && fact.supportRef !== null ? [{ receiptId: fact.supportRef.receiptId }] : []));
      const profileSources = buildGeoRoleSynthesisBasis(finalPayload, request.displayLocale, []).input.sources;
      const available = mergeSources(profileSources, receiptSources());
      const known = new Map(available.map((source) => [source.id, source]));
      if (lineage.evidenceCatalog.some((source) => !known.has(source.id) || !same(known.get(source.id), source))) invalid();
      const declarations = declaredRoleSources(finalPayload, profileSources);
      const { facts, verifiedFactSupport } = admittedFacts(finalPayload, receipts);
      const basis = buildGeoQuestionSynthesisBasis(finalPayload, facts);
      const evidenceCatalog = mergeSources(basis.input.evidenceSources, lineage.evidenceCatalog, declarations);
      if (evidenceCatalog.length > 256 || geoV2JsonbBytes(evidenceCatalog) > GEO_CONTEXT_EVIDENCE_MAX_BYTES) invalid();
      const semanticInput: GeoQuestionSynthesisInput = { ...basis.input, evidenceSources: evidenceCatalog };
      const summary = sourceSummary([...receipts.values()], evidenceCatalog, mergeSources(available, basis.input.evidenceSources, declarations));
      const prepared = prepareGeoQuestionSynthesis(semanticInput, capture);
      if (!prepared.ok) return preparationRefusal(prepared.reason);
      const sourceReceiptRefs = receiptRefs();
      if (selectedKnowledge !== null && !same(selectedKnowledge.result.manifest.sourceReceiptRefs, sourceReceiptRefs)) invalid();
      const competitorEvidence = selectGeoCompetitorEvidence({ kbId: request.kbId, targetHost: normalizeAccountWebsiteUrl(finalPayload.targetUrl)!.host,
        competitors: finalPayload.competitors, sourceReceiptRefs, receipts: [...receipts.values()] });
      assertGeoSnapshotContextV2KnownInput({ kbId: request.kbId, payload: finalPayload, sourceReceiptRefs, evidenceCatalog, sourceSummary: summary,
        modelRoleEdits: lineage.userEdited, verifiedFactSupport, competitorEvidence });
      const input = { ...base, promptHash: geoV2Digest(prepared.value.prompt), promptVersion: prepared.value.promptVersion,
        responseSchemaHash: geoV2Digest(prepared.value.responseJsonSchema), provider: modelInput(prepared.value.provider, capture, prepared.value.timeoutMs), sourceReceiptRefs: sourceReceiptRefs.map((ref) => ({ ...ref })),
        ...(selectedKnowledge === null ? {} : { knowledgeGeneration: { generationId: selectedKnowledge.record.generationId, inputHash: selectedKnowledge.record.inputHash, resultHash: selectedKnowledge.result.contentHash } }) };
      return { kind: "ready", input,
        invoke: async (generationId) => {
          try {
            const result = await (dependencies.synthesizeQuestions ?? synthesizeGeoKbQuestions)(prepared.value.input, { config: capture, timeoutMs: prepared.value.timeoutMs });
            return invocation(result, (semanticOutput) => {
              const candidateInput = { candidateId: generationId, kbId: request.kbId, baseDraftVersion: request.baseVersion, payload: finalPayload,
                semanticInput: prepared.value.input, semanticOutput, sourceReceiptRefs, evidenceCatalog, sourceSummary: summary, modelRoleEdits: lineage.userEdited, verifiedFactSupport, competitorEvidence };
              if (selectedKnowledge === null) return buildGeoPreparedKnowledgeBase(candidateInput);
              const candidate = buildGeoPreparedKnowledgeBase(candidateInput);
              const knowledgePack = buildGeoKnowledgePack({ generatedAt: selectedKnowledge.result.generatedAt, payload: candidate.payload, context: candidate.context,
                questionSet: candidate.questionSet, evidence: selectedKnowledge.result.evidence, synthesisInput: selectedKnowledge.result.synthesisInput,
                narrative: selectedKnowledge.result.narrative, narrativeFailureReason: null });
              return buildGeoPreparedKnowledgeBaseV2({ ...candidateInput, knowledgePack, knowledgeSynthesisInput: selectedKnowledge.result.synthesisInput,
                knowledgeGeneration: { generationId: selectedKnowledge.record.generationId, inputHash: selectedKnowledge.record.inputHash, promptVersion: GEO_KNOWLEDGE_SYNTHESIS_PROMPT_VERSION } });
            });
          } catch { return unknownInvocation(capture.model); }
        } };
    } catch (error) { return { kind: error instanceof PreparationFailure ? error.kind : "invalid_input" }; }
  };
}
