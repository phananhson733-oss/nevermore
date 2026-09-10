// @input  -- the owner's saved draft, the website evidence observation library and the shared gated reader
// @output -- one observation per collection operation, appended to the library, and the ledger outcome for it
// @pos    -- the collection half of the run seam: it performs work, so every fetch goes through the injected reader

/**
 * The producer and the executor for a run's collection operations.
 *
 * The single-run route owns the ledger and the orchestration; it deliberately
 * owns no work. This file registers the half that does: which pages an update
 * observes, and what performing one of those observations means.
 *
 * Both halves are built from the same plan on purpose. If the seed came from
 * one derivation and the executor resolved keys through another, a resumed run
 * would carry rows whose keys nothing could answer, and the honest outcome for
 * an unanswerable key -- permanent failure -- would start being reported for
 * work that was simply planned differently.
 *
 * Three rules this file exists to hold:
 *
 *  - **Reuse before spending.** A target whose newest observation is inside its
 *    TTL is not fetched: no traffic reaches the site, no crawl allowance is
 *    spent, and the stored row is the operation's result. Time is the only
 *    criterion (see `kb-evidence-observations.ts` for why comparing bodies
 *    would rewrite the past).
 *  - **A gate refusal is never an observation.** `rate_limited` says something
 *    about our own quota, not about the target. Storing it would suppress the
 *    real fetch for a whole TTL, so it is reported as retryable and written
 *    nowhere.
 *  - **A fetch we cannot file is unresolved, not retryable.** The page was
 *    read; the allowance was spent. Calling that retryable would spend it
 *    again on the strength of not knowing.
 */

import { createHash } from "node:crypto";

import {
  GEO_EVIDENCE_OBSERVATION_LIMITS,
  isObservationFresh,
  geoEvidenceTtlMs,
  readLatestObservation,
  recordObservation,
  type GeoEvidenceObservation,
  type GeoEvidenceObservationAppend,
  type GeoEvidenceObservationSelector,
  type GeoEvidenceStoreResult,
  type GeoEvidenceStructured,
  type GeoEvidenceUnavailableReason,
} from "./kb-evidence-observations.ts";
import { planGeoEvidenceReuse } from "./kb-evidence-reuse.ts";
import { createGeoKnowledgeResourceReader } from "./kb-enrichment-deps.ts";
import {
  pageData,
  type GeoKnowledgeEvidenceReadResource,
  machineResourceAnsweredRequest,
} from "./kb-knowledge-evidence.ts";
import { GEO_KNOWLEDGE_LIMITS } from "./kb-knowledge-shape.ts";
import { geoV2JsonbBytes } from "./kb-v2-json.ts";
import { readGeoOffsitePageSignals } from "./kb-offsite-verification.ts";
import type { GeoKbStoreResult } from "./kb-store.ts";
import {
  geoVersionedPayloadIdentity,
  readVersionedGeoKnowledgeBase,
  type VersionedGeoKbDetails,
} from "./kb-versioned-read.ts";
import { findAccountWebsiteByUrl } from "../account-websites/store.ts";
import type {
  GeoRunExecutor,
  GeoRunProbeOutcome,
  GeoRunStartOutcome,
} from "./kb-run-advance.ts";
import { readGeoSitemapDocument } from "./kb-sitemap-document.ts";
import type { GeoRunOperationSeed } from "./kb-run-ledger.ts";
import {
  geoRunUpdateSeeds,
  planGeoRunCollection,
  type GeoRunCollectTarget,
} from "./kb-run-collect.ts";

/** What the route may do with a knowledge base it was asked to update. */
export type GeoRunSeedOutcome =
  | { readonly kind: "ready"; readonly seed: readonly GeoRunOperationSeed[] }
  | { readonly kind: "missing" | "invalid_input" | "unavailable" };

export interface GeoRunCollectSources {
  readonly readDetails: (input: {
    readonly userId: string;
    readonly kbId: string;
  }) => Promise<
    GeoKbStoreResult<Pick<VersionedGeoKbDetails, "kbId" | "draft">>
  >;
  /** The observation library is keyed by website, and the knowledge base carries no website id yet. */
  readonly resolveWebsiteId: (input: {
    readonly userId: string;
    readonly targetUrl: string;
  }) => Promise<
    | { readonly kind: "ok"; readonly websiteId: string }
    | { readonly kind: "missing" | "unavailable" }
  >;
  readonly readLatestObservation: (
    input: GeoEvidenceObservationSelector,
  ) => Promise<GeoEvidenceStoreResult<GeoEvidenceObservation | null>>;
  readonly recordObservation: (
    input: GeoEvidenceObservationAppend,
  ) => Promise<GeoEvidenceStoreResult<GeoEvidenceObservation>>;
  /** Built per operation: the reader memoises its crawl-gate admission per host. */
  readonly createReader: (
    clientKey: string,
  ) => GeoKnowledgeEvidenceReadResource;
  readonly now: () => Date;
}

export interface GeoRunCollectRuntime {
  /**
   * The WHOLE update's seed, not just this executor's half.
   *
   * The seed is derived from the same load that decides "there is nothing here
   * that may be read", and that decision governs the model step too: a draft
   * naming a site nothing may fetch must not buy a synthesis about it. Keeping
   * the two in one function is what makes that one decision instead of two
   * that can drift.
   *
   * The executor beside it performs the collection half only; the model half is
   * registered in `kb-run-runtime.ts`, which composes the two by kind.
   */
  readonly seedOperations: (input: {
    readonly userId: string;
    readonly kbId: string;
  }) => Promise<GeoRunSeedOutcome>;
  readonly executor: GeoRunExecutor;
}

/** One page read, bounded the same way the reader clamps its own timeout. */
const PAGE_TIMEOUT_MS = 8_000;

/**
 * What the three machine-readable files cost, and why they are read here
 * rather than planned as operations of their own.
 *
 * **Crawl allowance: one admission for the operation, whoever spends it.**
 * `createGeoKnowledgeResourceReader` memoises its admission per canonical host
 * (the `admissions` map in `kb-enrichment-deps.ts`): the first read of a host
 * calls `openCrawlGate`, and every later read from THAT SAME reader instance
 * finds the host already in the map and never calls the gate again. So an
 * operation that reads the page and all three files spends one admission, not
 * four, of `CRAWL_TARGET_MAX` (4 per hour per target host, shared with the
 * Profile scan, seo-audit and internal-link-audit) and of `CRAWL_IP_MAX` (12
 * per hour per caller). The later reads do not even hold the concurrency slot:
 * the first read released it in its own `finally`, because `release` is set
 * only on the call that opened the gate.
 *
 * Which read is first is not fixed. When the page is fresh enough to reuse,
 * the operation skips it and `robots.txt` opens the gate instead -- so an
 * update whose page costs nothing still spends one admission on the three
 * files, and can be refused. That is the price of the promise the button makes;
 * the alternative, silently not reading them, is the defect this replaced.
 *
 * That guarantee is per reader instance, and `createGeoRunCollectRuntime`
 * builds one reader per operation. A separate `robots` operation would build a
 * second reader with an empty map and open the gate again -- a second admission
 * against an hourly budget this update has already spent. Hence: same
 * operation, same reader (built once below and passed around), no new ledger
 * operation kinds, and no migration.
 *
 * **Time: `MACHINE_BUDGET_MS` bounds the READS, and nothing else.** What is
 * carried across the loop is time actually spent in the reader, so the ledger
 * writes are outside it: they were not, before -- a single wall-clock deadline
 * taken once before the loop, which the awaited writes ate into, so a slow
 * write after `robots` could leave nothing for `llms` while this very sentence
 * promised otherwise.
 *
 * It bounds when a read may START, not how long the three take. The reader
 * awaits `openCrawlGate` before it applies the per-read timeout, so the first
 * read carries the admission wait and can overrun its own 4 s. That used to be
 * the page's problem; reusing the page moved it here. The effect is bounded and
 * one-directional -- a slow gate costs `sitemap` and `llms` their turn, and a
 * turn not taken leaves no row, which is the same thing "we did not look"
 * always meant here.
 *
 * The own-page operation's worst case is therefore
 * 8 s of page + 6 s of machine reads + up to three ledger writes -- about
 * 14 s plus store latency, not a hard 14 s. Say it that way round: a bound
 * stated as if it covered the writes would be a number nobody can rely on.
 *
 * `GEO_RUN_ESTIMATED_MS.fetch` (10 s, in `kb-run-advance.ts`, which this change
 * does not touch) is what `planGeoRun` requires to be LEFT of the 250 s
 * invocation budget before it starts one more fetch, so the latest an operation
 * can begin is 240 s into a 300 s route. That leaves ~46 s of headroom for the
 * reads and the writes together, which is ample -- but the estimate is no
 * longer conservative for the own page, and it is a number worth revisiting in
 * that file rather than one this comment may quietly redefine.
 */
const MACHINE_TIMEOUT_MS = 4_000;
const MACHINE_BUDGET_MS = 6_000;

/**
 * The three files a site publishes for machines, at the addresses the
 * standards put them at: rooted at the origin, not relative to the draft's
 * path. A draft targeting `https://example.com/product/` still answers about
 * `https://example.com/robots.txt`.
 *
 * The ledger kind is passed as the reader's `expected` hint because the two
 * vocabularies happen to be the same three words. The reader ignores it -- it
 * uses only `url` and `timeoutMs` -- so every content-type decision is made
 * here by the caller, and nothing downstream may assume the reader checked.
 */
const MACHINE_RESOURCES = [
  { kind: "robots", path: "/robots.txt" },
  { kind: "sitemap", path: "/sitemap.xml" },
  { kind: "llms", path: "/llms.txt" },
] as const;

/**
 * The largest `structured` object this file will hand the ledger.
 *
 * The column is checked at `octet_length(structured::text) <= 65536`, and a row
 * over it comes back as `invalid` -- which this executor reports as permanent
 * failure for a fetch it has already paid for. `geoV2JsonbBytes` measures
 * exactly what that check measures, so the budget is enforced rather than
 * hoped for; the gap to 64 KiB is headroom, not slack to be spent.
 */
const STRUCTURED_BUDGET_BYTES = 48_000;

/**
 * Characters PostgreSQL's `jsonb` cannot store (NUL) or that no reader can use.
 * Same class the evidence contract refuses in `kb-knowledge-evidence.ts`.
 */
// eslint-disable-next-line no-control-regex -- naming them is the point
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isHtml(contentType: string): boolean {
  const type =
    contentType.toLocaleLowerCase("en").split(";", 1)[0]?.trim() ?? "";
  return type === "text/html" || type === "application/xhtml+xml";
}

/**
 * Bound a string by UTF-16 length without ever splitting a surrogate pair.
 *
 * The page readers bound by code points and the ledger's validator counts
 * UTF-16 units, so an excerpt of astral characters can pass one and be refused
 * by the other -- which arrives as "this observation is invalid" after the
 * fetch has already been paid for.
 */
function boundStored(value: string, max: number): string {
  if (value.length <= max) return value;
  let bounded = "";
  for (const point of value) {
    if (bounded.length + point.length > max) break;
    bounded += point;
  }
  return bounded;
}

function boundedNames(values: readonly string[]): readonly string[] {
  return values
    .map((value) => boundStored(value, 200))
    .filter((value) => value !== "")
    .slice(0, 32);
}

/**
 * One stored string, or null when nothing usable survives the bound.
 *
 * A control character rejects the WHOLE line rather than being stripped out of
 * it: a half-cleaned line would be stored as if it were what the file says.
 * The caller drops it from the sample, so a robots.txt carrying one stray form
 * feed loses that rule from its excerpts -- and since excerpts are a sample and
 * never a count, that costs the reader a line, never a wrong total.
 */
function storableText(value: string, max: number): string | null {
  const bounded = boundStored(value.trim(), max);
  return bounded === "" || CONTROL_CHARACTERS.test(bounded) ? null : bounded;
}

function storableList(
  values: readonly string[],
  maxChars: number,
  maxItems: number,
): readonly string[] {
  return values
    .flatMap((value) => {
      const stored = storableText(value, maxChars);
      return stored === null ? [] : [stored];
    })
    .slice(0, maxItems);
}

/** The excerpt sample every row carries: at most eight lines, never a census. */
function boundedExcerpts(values: readonly string[]): readonly string[] {
  return values
    .flatMap((value) => {
      const stored = storableText(value, GEO_KNOWLEDGE_LIMITS.excerptCodePoints);
      return stored === null ? [] : [stored];
    })
    .slice(0, GEO_KNOWLEDGE_LIMITS.excerptsPerSource);
}

/**
 * Bring one page's structure inside the column's byte budget, dropping the
 * biggest thing first.
 *
 * FAQ pairs go one at a time from the end, then hreflang, then the JSON-LD
 * types; authorship is last because it is the smallest and the oldest promise.
 * Nothing here is reported as a total, so a trimmed list understates rather
 * than lying -- see `faqPairs` in `observedStructure` for why no count of them
 * can honestly be stored at all.
 *
 * `jsonLdTypes` and `hreflangLocales` are three-state, and the third state is
 * the whole point. `null` means we kept no answer -- the body could not be
 * parsed, or the budget dropped the key -- and the key is left out. A parsed
 * list is written even when it is EMPTY, because an empty array is this
 * ledger's way of saying "this page publishes none of these", which is a
 * different fact from "nobody looked". The consumer holds both halves of that
 * distinction (`storedList` in `kb-generation-preparer.ts` answers
 * `not_stored` for a missing key and `stored: []` for an empty one), so
 * collapsing them here would make the machine-readable module unpublishable
 * for every single-language site and tell its owner the page was never
 * collected.
 */
function fitObservedStructure(parts: {
  readonly authorship: GeoEvidenceStructured["authorship"] | null;
  readonly jsonLdTypes: readonly string[] | null;
  readonly hreflangLocales: readonly string[] | null;
  /** The same alternates with their URLs; dropped together with the bare list. */
  readonly hreflang: readonly { readonly locale: string; readonly url: string }[] | null;
  readonly faqPairs: readonly { readonly question: string; readonly answer: string }[];
}): GeoEvidenceStructured {
  const build = (
    faqCount: number,
    withHreflang: boolean,
    withJsonLd: boolean,
  ): GeoEvidenceStructured => ({
    ...(parts.authorship === undefined || parts.authorship === null
      ? {}
      : { authorship: parts.authorship }),
    ...(withJsonLd && parts.jsonLdTypes !== null
      ? { jsonLdTypes: [...parts.jsonLdTypes] }
      : {}),
    ...(withHreflang && parts.hreflangLocales !== null
      ? { hreflangLocales: [...parts.hreflangLocales] }
      : {}),
    ...(withHreflang && parts.hreflang !== null
      ? { hreflang: parts.hreflang.map((entry) => ({ locale: entry.locale, url: entry.url })) }
      : {}),
    ...(faqCount > 0
      ? {
          faqPairs: parts.faqPairs
            .slice(0, faqCount)
            .map((pair) => ({ question: pair.question, answer: pair.answer })),
        }
      : {}),
  });
  // A value `jsonb` cannot hold throws rather than measuring; treating that as
  // "over budget" drops it instead of turning a read page into an exception.
  const bytes = (value: GeoEvidenceStructured): number => {
    try {
      return geoV2JsonbBytes(value);
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  };
  let faqCount = parts.faqPairs.length;
  let candidate = build(faqCount, true, true);
  while (faqCount > 0 && bytes(candidate) > STRUCTURED_BUDGET_BYTES) {
    faqCount -= 1;
    candidate = build(faqCount, true, true);
  }
  if (bytes(candidate) > STRUCTURED_BUDGET_BYTES) candidate = build(0, false, true);
  if (bytes(candidate) > STRUCTURED_BUDGET_BYTES) candidate = build(0, false, false);
  return candidate;
}

/**
 * The shared parser's reading of a body, or null when it cannot read it.
 *
 * `pageData` is the one answer to "what does this page carry"; parsing the
 * same bytes a second way here would let the owner's card and the assembled
 * evidence disagree about the same page. It is wrapped because a page that
 * was successfully READ must not become a thrown operation just because it
 * could not be structured.
 */
function parsedPageStructure(
  body: string,
  url: string,
): ReturnType<typeof pageData> | null {
  try {
    return pageData(body, url);
  } catch {
    return null;
  }
}

/**
 * What of a page is worth keeping as an observation.
 *
 * Excerpts are the quotable evidence; authorship is the R11 signal (who wrote
 * it, who reviewed it, when) that the evidence module reads. `structure` adds
 * what the shared page parser already extracts -- the JSON-LD types, the
 * hreflang locales and the FAQ pairs -- so the owner's card can show the
 * site's own machine-readable signals and FAQ facts the moment collection
 * finishes, without waiting for the model. Nothing here is judged or scored:
 * an absent byline is recorded as an absent byline.
 *
 * `structure` is null for a competitor page on purpose. The card's
 * machine-readable half is about the site being updated; a rival's FAQ markup
 * answers no question anyone asks of it, and every byte stored is a byte
 * against the row's own budget.
 *
 * `faqPairs` is a bounded list and never a count of the page's FAQ. `pageData`
 * itself stops at 32 pairs before this function sees them, so the true total
 * is not knowable from here -- which is exactly why no total is written. A
 * consumer may say "these pairs"; it may not say "this many".
 */
function observedStructure(
  signals: ReturnType<typeof readGeoOffsitePageSignals>,
  structure: ReturnType<typeof pageData> | null,
): {
  readonly excerpts: readonly string[];
  readonly structured: GeoEvidenceStructured;
} {
  const excerpts = signals.excerpts
    .map((excerpt) =>
      boundStored(excerpt, GEO_KNOWLEDGE_LIMITS.excerptCodePoints),
    )
    .filter((excerpt) => excerpt !== "")
    .slice(0, GEO_KNOWLEDGE_LIMITS.excerptsPerSource);
  const authors = boundedNames(signals.byline.authors);
  const reviewers = boundedNames(signals.byline.reviewers);
  const datePublished =
    signals.byline.datePublished === null
      ? null
      : boundStored(signals.byline.datePublished, 64);
  const hasAuthorship =
    authors.length > 0 || reviewers.length > 0 || datePublished !== null;
  // The ledger's own maxima for each key, so a page with an unusual amount of
  // markup is trimmed here rather than refused by the column.
  const faqPairs =
    structure === null
      ? []
      : structure.faq
          .flatMap((pair) => {
            const question = storableText(pair.question, 600);
            const answer = storableText(pair.answer, 2_000);
            return question === null || answer === null
              ? []
              : [{ question, answer }];
          })
          .slice(0, 64);
  const hreflangPairs =
    structure === null
      ? null
      : structure.hreflang
          .flatMap((entry) => {
            const locale = storableText(entry.locale, 64);
            /*
             * Refused whole, never bounded. `storableText` TRUNCATES, and a
             * truncated URL is not a shortened label -- it is a different,
             * still-valid address, which the reader would carry back into the
             * page as an alternate the page never declared. Length is checked
             * before the control-character test rather than by bounding.
             */
            const url = entry.url.length > GEO_EVIDENCE_OBSERVATION_LIMITS.urlChars
              ? null : storableText(entry.url, GEO_EVIDENCE_OBSERVATION_LIMITS.urlChars);
            return locale === null || url === null || url !== entry.url.trim() ? [] : [{ locale, url }];
          })
          .slice(0, GEO_EVIDENCE_OBSERVATION_LIMITS.hreflangLocales);
  return {
    excerpts,
    structured: fitObservedStructure({
      authorship: hasAuthorship
        ? {
            authors: [...authors],
            reviewers: [...reviewers],
            datePublished,
          }
        : null,
      // `null`, not `[]`: a page nobody could parse has published nothing we
      // know of, and storing an empty list would report that as "this page
      // carries no JSON-LD and no alternates" about a body we never read.
      jsonLdTypes:
        structure === null ? null : storableList(structure.jsonLdTypes, 200, 64),
      /*
       * The bare list is DERIVED from the pairs rather than stored beside them.
       *
       * The evidence contract's page shape refuses a locale without the URL it
       * points at, so a row holding only locales cannot be rebuilt into a page
       * and the alternates it did observe end up reported as absent -- which
       * is why the pairs are stored at all. Deriving the list is what keeps
       * the two from disagreeing: an entry whose URL will not store would
       * otherwise survive in the list and vanish from the pairs, and a reader
       * comparing their lengths could not tell that from a page with an
       * alternate we chose not to carry.
       */
      hreflangLocales: hreflangPairs === null ? null : hreflangPairs.map((entry) => entry.locale),
      hreflang: hreflangPairs,
      faqPairs,
    }),
  };
}

/**
 * The reader's vocabulary, mapped onto the one the library will store.
 *
 * The ledger has no `rate_limited` on purpose: that word is about our own
 * quota, and a gate refusal is never an observation of the site. Every caller
 * here has already dropped those -- `reached` is what tells them apart -- so a
 * `rate_limited` arriving at this function is the SITE answering 429, which is
 * the site refusing the request. `blocked` is the ledger's word for that, and
 * it is what the card renders as "the request was refused".
 *
 * It used to fall through to `invalid_response`, so the card told the owner we
 * could not confirm the returned content was this file -- about a response
 * that carried no content at all, and about a site that had told us plainly
 * why. Everything genuinely unrecognised still lands on `invalid_response`.
 */
function storableReason(reason: string): GeoEvidenceUnavailableReason {
  switch (reason) {
    case "not_found":
    case "not_published":
    case "fetch_failed":
    case "blocked":
    case "timeout":
    case "partial_body":
    case "insufficient_evidence":
      return reason;
    case "rate_limited":
      return "blocked";
    default:
      return "invalid_response";
  }
}

type MachineKind = (typeof MACHINE_RESOURCES)[number]["kind"];

/**
 * The content type each of the three must arrive as.
 *
 * This is load-bearing, not decoration. A single-page app that answers every
 * unknown path with its own HTML shell returns 200 for `/llms.txt`, and
 * storing that body as a reading of llms.txt would tell the owner they publish
 * a file they do not. A mismatch is `invalid_response` -- "we could not
 * establish it" -- and never `not_found`, which downstream reads as absent.
 *
 * The same rule lives inline in `expectedContentType`
 * (`kb-knowledge-evidence.ts`). It is copied rather than imported because this
 * change may only widen that module's exports by the page parser; two copies
 * of one rule is a seam worth closing later.
 */
function machineContentTypeMatches(
  kind: MachineKind,
  contentType: string,
): boolean {
  const type =
    contentType.toLocaleLowerCase("en").split(";", 1)[0]?.trim() ?? "";
  if (kind === "robots") return type === "text/plain";
  if (kind === "sitemap")
    return type === "application/xml" || type === "text/xml";
  return type === "text/plain" || type === "text/markdown";
}

/**
 * What one machine-readable file is worth keeping, or why it is not a reading
 * of that file at all.
 *
 * The sitemap's `sitemapUrlCount` is the point of this function.
 * `excerpts` is capped at eight everywhere in this ledger, so a 500-URL
 * sitemap stored as excerpts alone would be counted downstream as "8" by
 * anyone who counted it -- a number the run never measured. The count is taken
 * from the whole document (the reader refuses a truncated body as
 * `partial_body`, so an `ok` body is the entire file) and stored as a string,
 * this ledger's convention for numbers, beside a sample of the first eight
 * locations. Where an honest count cannot be taken it is written NOWHERE
 * rather than approximated: a `<sitemapindex>` lists child sitemaps, not
 * pages, and counting those as URLs would be the same lie in a different
 * shape.
 */
function machineObservation(
  kind: MachineKind,
  body: string,
):
  | {
      readonly kind: "ok";
      readonly excerpts: readonly string[];
      readonly structured: GeoEvidenceStructured;
    }
  | { readonly kind: "unavailable"; readonly reason: GeoEvidenceUnavailableReason } {
  if (kind !== "sitemap") {
    const lines = body
      .split(/\r?\n/u)
      .map((line) => line.replace(/\s+/gu, " ").trim())
      .filter((line) => line !== "");
    // A file served with nothing in it publishes no rules. Same answer the
    // evidence collector gives, and the one case where "absent" is the truth.
    if (lines.length === 0) return { kind: "unavailable", reason: "not_published" };
    /*
     * robots.txt is PARSED downstream, not quoted, and excerpts are capped at
     * eight -- so every real robots.txt looked truncated and the assembler,
     * correctly refusing to answer a permission question from a partial file,
     * reported "AI crawler permissions were not determined" for every site
     * there has ever been. `robotsRules` is the whole file, and it exists for
     * exactly this; it had a schema and a 256-rule cap and no producer.
     *
     * Stored only when it is provably COMPLETE. A file over the cap, or one
     * carrying a line the ledger will not take, stores nothing here: the
     * assembler then falls back to the excerpt sample and says it was not read
     * in full, which is true. Half a robots.txt published as a permission is
     * the failure this whole path exists to avoid.
     */
    if (kind === "robots") {
      const rules = storableList(lines, 400, GEO_EVIDENCE_OBSERVATION_LIMITS.robotsRules);
      /*
       * Complete AND storable. 256 rules of 400 characters is 102 KiB, well
       * over the column's `octet_length(structured::text) <= 65536` check, and
       * a row that fails it comes back `invalid` -- reported as a permanent
       * failure of a fetch this operation has already paid for. Measured with
       * the same function that check measures, and dropped whole rather than
       * trimmed, because a trimmed robots.txt is the partial file this refuses.
       */
      const structured = { robotsRules: [...rules] };
      const fits = (() => { try { return geoV2JsonbBytes(structured) <= STRUCTURED_BUDGET_BYTES; } catch { return false; } })();
      if (rules.length === lines.length && fits) {
        return { kind: "ok", excerpts: boundedExcerpts(lines), structured };
      }
    }
    return { kind: "ok", excerpts: boundedExcerpts(lines), structured: {} };
  }
  if (body.trim() === "")
    return { kind: "unavailable", reason: "not_published" };
  // Parsed, not matched: the document's ROOT element decides what it is, and
  // only the `<loc>` elements owned by a `<url>` are pages. See
  // `kb-sitemap-document.ts`. `kb-knowledge-evidence.ts` reads the same way.
  const { root, locations: parsed } = readGeoSitemapDocument(body);
  // XML that is not a sitemap is not evidence about the sitemap. We cannot say
  // the site publishes none -- only that what answered was not one.
  if (root === null)
    return { kind: "unavailable", reason: "invalid_response" };
  const locations = [...new Set(parsed)];
  return {
    kind: "ok",
    excerpts: boundedExcerpts(locations),
    structured:
      root === "urlset" ? { sitemapUrlCount: String(locations.length) } : {},
  };
}

/**
 * The outcome of the machine-readable phase, as far as its caller must act on it.
 *
 * `no_admission` is the one case the operation cannot absorb: not one of the
 * three requests got out, so the files this update promised to read are simply
 * not read and no row was written about any of them. Everything else is
 * best-effort by design -- see the third rule below.
 */
type GeoMachineCollectionOutcome =
  | { readonly kind: "collected" }
  | { readonly kind: "no_admission" };

/**
 * Read and file the site's own robots.txt, sitemap.xml and llms.txt.
 *
 * Called with the reader for this operation, so all of it happens under one
 * crawl-gate admission -- see `MACHINE_TIMEOUT_MS` above for why that is true
 * and what it is worth.
 *
 * Three rules it holds:
 *
 *  - **A refused gate is never an observation**, exactly as for a page. This
 *    used to be unreachable in practice: the page was always read first and
 *    the admission is memoised, so by the time these ran the gate had already
 *    said yes. It is reachable now -- when the page is fresh enough to reuse,
 *    these three reads are the whole operation and the first of them is what
 *    asks the gate. The refusal cannot be recognised by its `reason`, because
 *    our gate and the site answer with the same words; the reader marks what it
 *    actually sent (`reached`), and only that is written down. A refusal before
 *    anything got out ends the phase and is reported, rather than stepped over,
 *    because stepping over it would file an update that sent nothing as an
 *    update that succeeded.
 *  - **Out of time is not an observation either.** A resource the budget did
 *    not reach gets no row at all. A row would say we looked, and the absence
 *    of a row is the only shape this ledger has for "we did not". The budget
 *    counts time spent reading and nothing else: a slow ledger write must not
 *    be able to consume the allowance for the read after it, which is what a
 *    single wall-clock deadline across the whole loop silently did.
 *  - **A row we cannot file changes nothing about the operation.** The page is
 *    what the operation is for; a failed side-write leaves no row, which reads
 *    downstream as unobserved -- never as absent.
 */
async function recordMachineSignals(input: {
  readonly read: GeoKnowledgeEvidenceReadResource;
  readonly record: GeoRunCollectSources["recordObservation"];
  readonly now: () => Date;
  readonly userId: string;
  readonly websiteId: string;
  readonly targetUrl: string;
  /** True when a read of this host has already got out on this reader. */
  readonly gateAlreadyOpen: boolean;
}): Promise<GeoMachineCollectionOutcome> {
  let readMsSpent = 0;
  let reachedSite = input.gateAlreadyOpen;
  for (const resource of MACHINE_RESOURCES) {
    let url: string;
    try {
      url = new URL(resource.path, input.targetUrl).toString();
    } catch {
      continue;
    }
    const remainingMs = MACHINE_BUDGET_MS - readMsSpent;
    if (remainingMs <= 0) break;
    const readStartedAt = input.now().getTime();
    const read = await input
      .read({
        url,
        expected: resource.kind,
        timeoutMs: Math.min(MACHINE_TIMEOUT_MS, remainingMs),
      })
      .catch(() => null);
    readMsSpent += Math.max(0, input.now().getTime() - readStartedAt);
    if (read === null) continue;
    let status: GeoEvidenceObservationAppend["status"];
    if (read.kind !== "ok") {
      /*
       * A refusal our own gate produced is not a reading of the site, and the
       * reader says which is which: `reached` is set only below the admission
       * check. Without it the two are the same value -- our gate answers a
       * refusal as `blocked`, `rate_limited` or `fetch_failed`, and so does the
       * site -- and the reader memoises that verdict per host, so filing it
       * would write three rows asserting something about a site none of the
       * three requests ever left for.
       *
       * This used to be unreachable, because the page was read first and its
       * own admission failure ended the operation before these ran. Reusing a
       * fresh page is what put these three in front of the gate.
       */
      if (read.reached !== true) {
        if (!reachedSite) return { kind: "no_admission" };
        continue;
      }
      reachedSite = true;
      status = { kind: "unavailable", reason: storableReason(read.reason) };
    } else if (!machineResourceAnsweredRequest(url, read.url) || !machineContentTypeMatches(resource.kind, read.contentType)) {
      /**
       * Two ways a 200 is not this file. The content type catches the SPA shell
       * served at `/llms.txt`; the address check catches the same-host
       * redirect that answered from somewhere else. Both would otherwise be
       * filed as `ok` under the address we asked about -- the ledger saying a
       * site publishes a file at an address where it publishes nothing, which
       * is the inverse of what these rows exist to record. The sibling reader
       * in `kb-knowledge-evidence.ts` admits a machine resource on exactly
       * these two tests; copying only the first was a hole.
       */
      reachedSite = true;
      status = { kind: "unavailable", reason: "invalid_response" };
    } else {
      reachedSite = true;
      const observed = machineObservation(resource.kind, read.body);
      status =
        observed.kind === "ok"
          ? {
              kind: "ok",
              bodyHash: sha256(read.body),
              excerpts: observed.excerpts,
              structured: observed.structured,
            }
          : observed;
    }
    await input
      .record({
        userId: input.userId,
        websiteId: input.websiteId,
        kind: resource.kind,
        url,
        observedAt:
          read.kind === "ok" ? read.observedAt : input.now().toISOString(),
        status,
      })
      .catch(() => undefined);
  }
  return { kind: "collected" };
}

function targetsFor(
  payload: VersionedGeoKbDetails["draft"],
): readonly GeoRunCollectTarget[] {
  if (payload === null) return [];
  const identity = geoVersionedPayloadIdentity(payload.payload);
  return planGeoRunCollection({
    targetUrl: identity.targetUrl,
    competitors: identity.competitors,
  });
}

export function createGeoRunCollectRuntime(
  sources: GeoRunCollectSources,
): GeoRunCollectRuntime {
  /**
   * The plan, re-derived from the stored draft.
   *
   * Deliberately re-read rather than cached across invocations: every advance
   * of a run is its own request, and the draft is what says what this update
   * is about.
   */
  const load = async (input: {
    readonly userId: string;
    readonly kbId: string;
  }): Promise<
    | { readonly kind: "ok"; readonly targets: readonly GeoRunCollectTarget[] }
    | { readonly kind: "missing" | "invalid_input" | "unavailable" }
  > => {
    const read = await sources
      .readDetails(input)
      .catch(() => ({ kind: "unavailable" as const }));
    if (read.kind === "missing") return { kind: "missing" };
    if (read.kind !== "ok") return { kind: "unavailable" };
    if (read.value.kbId !== input.kbId) return { kind: "unavailable" };
    if (read.value.draft === null) return { kind: "missing" };
    let targets: readonly GeoRunCollectTarget[];
    try {
      targets = targetsFor(read.value.draft);
    } catch {
      return { kind: "invalid_input" };
    }
    // An empty plan is not an update with nothing to do; it is a draft naming
    // a site nothing may read. Reporting it as a finished run would say the
    // knowledge base was refreshed.
    if (targets.length === 0) return { kind: "invalid_input" };
    return { kind: "ok", targets };
  };

  const seedOperations = async (input: {
    readonly userId: string;
    readonly kbId: string;
  }): Promise<GeoRunSeedOutcome> => {
    const loaded = await load(input);
    return loaded.kind === "ok"
      ? { kind: "ready", seed: geoRunUpdateSeeds(loaded.targets) }
      : loaded;
  };

  const resolve = async (
    context: { readonly userId: string; readonly kbId: string },
    key: string,
  ): Promise<
    | {
        readonly kind: "ok";
        readonly target: GeoRunCollectTarget;
        readonly websiteId: string;
      }
    | { readonly kind: "missing" | "unavailable" }
  > => {
    const loaded = await load(context);
    if (loaded.kind === "missing" || loaded.kind === "invalid_input")
      return { kind: "missing" };
    if (loaded.kind !== "ok") return { kind: "unavailable" };
    const target = loaded.targets.find((candidate) => candidate.key === key);
    if (target === undefined) return { kind: "missing" };
    // Every observation belongs to the owner's own website, competitor pages
    // included: the library is the record of what THIS site's update looked at.
    // Resolving by the competitor's URL would file a rival's page under a
    // website this owner may not even have.
    const own = loaded.targets.find((candidate) => candidate.scope === "own");
    if (own === undefined) return { kind: "missing" };
    const website = await sources
      .resolveWebsiteId({ userId: context.userId, targetUrl: own.url })
      .catch(() => ({ kind: "unavailable" as const }));
    if (website.kind !== "ok")
      return { kind: website.kind === "missing" ? "missing" : "unavailable" };
    return { kind: "ok", target, websiteId: website.websiteId };
  };

  const selector = (
    userId: string,
    websiteId: string,
    target: GeoRunCollectTarget,
  ): GeoEvidenceObservationSelector => ({
    userId,
    websiteId,
    kind: target.kind,
    url: target.url,
  });

  const start = async (
    operation: { readonly key: string; readonly kind: string },
    context: { readonly userId: string; readonly kbId: string },
  ): Promise<GeoRunStartOutcome> => {
    // A kind nothing here produces is recorded as unsupported rather than
    // retried or reported as done, so a run holding one finishes and says so.
    if (operation.kind !== "fetch")
      return { kind: "failed_permanent", reason: "unsupported" };
    const resolved = await resolve(context, operation.key);
    if (resolved.kind === "missing")
      return { kind: "failed_permanent", reason: "not_found" };
    if (resolved.kind !== "ok")
      return { kind: "failed_retryable", reason: "store_unavailable" };
    const { target, websiteId } = resolved;

    const latest = await sources
      .readLatestObservation(selector(context.userId, websiteId, target))
      .catch(() => ({ kind: "unavailable" as const }));
    if (latest.kind === "missing")
      return { kind: "failed_permanent", reason: "not_found" };
    if (latest.kind !== "ok")
      return { kind: "failed_retryable", reason: "store_unavailable" };

    const plan = planGeoEvidenceReuse({
      targets: [
        { kind: target.kind, url: target.url, gateKey: target.gateKey },
      ],
      observations: latest.value === null ? [] : [latest.value],
      now: sources.now(),
    });
    const entry = plan.entries[0];
    if (entry === undefined)
      return { kind: "failed_permanent", reason: "not_found" };
    const reusedPage = entry.decision === "reuse" ? entry.reused : null;
    // A competitor page is the whole of its operation -- a rival's robots.txt
    // answers no question the owner's card asks -- so a fresh one finishes here
    // without a request leaving this process.
    if (reusedPage !== null && target.scope !== "own") {
      return { kind: "succeeded", resultRef: reusedPage.observationId };
    }

    // One reader for the whole operation. Whichever read comes first opens this
    // host's crawl gate, and every later read through THIS instance rides that
    // same admission. Re-creating it per read would spend the hourly allowance
    // once per file.
    const reader = sources.createReader(context.userId);

    /*
     * A reused own page does not finish the operation.
     *
     * "Every update reads your robots.txt, sitemap.xml and llms.txt" is what
     * this product tells the owner above the button; the page and the
     * competitor pages are the parts that get a day of reuse. Returning here on
     * a fresh page -- which is what this did -- meant those three were read
     * only on the runs where the page happened to be stale. On 2026-09-09 that
     * pinned one site's robots.txt, sitemap.xml and llms.txt to a single 09:58
     * reading for the rest of the day: three later updates re-filed the same
     * verdict without sending a request, and a fix that shipped for exactly
     * those three reads never once executed.
     *
     * The page's own row is still the operation's result. Nothing about it was
     * re-read, and its `resultRef` is the row that stood before this run.
     */
    if (reusedPage !== null) {
      const machine = await recordMachineSignals({
        read: reader,
        record: sources.recordObservation,
        now: sources.now,
        userId: context.userId,
        websiteId,
        targetUrl: target.url,
        // Nothing has been read on this reader, so the first of the three
        // files is what asks the gate.
        gateAlreadyOpen: false,
      });
      // A closed gate is one of the things `failed_retryable` is for, and the
      // page row this would have returned is still there to be reused when the
      // retry comes round.
      if (machine.kind === "no_admission")
        return { kind: "failed_retryable", reason: "rate_limited" };
      return { kind: "succeeded", resultRef: reusedPage.observationId };
    }

    const read = await reader({
      url: target.url,
      expected: "html",
      timeoutMs: PAGE_TIMEOUT_MS,
    });
    const observedAt =
      read.kind === "ok" ? read.observedAt : sources.now().toISOString();
    let status: GeoEvidenceObservationAppend["status"];
    if (read.kind !== "ok") {
      /*
       * Our own gate said no. `reached` is what tells that apart from the site
       * answering -- the reader sets it only below the admission check -- and
       * this branch used to test the REASON instead, so a gate refusal carrying
       * 400 or 500 was filed as `blocked` or `fetch_failed` against a site no
       * request ever left for. Nothing about the site was observed, and the row
       * would suppress the real fetch for the rest of the TTL.
       *
       * The machine-resource loop above has always checked `reached`; this is
       * the same check, and it is what makes `storableReason` able to say that
       * a `rate_limited` arriving there is the site's own 429.
       */
      if (read.reached !== true)
        return { kind: "failed_retryable", reason: "rate_limited" };
      // The site itself asked us to slow down. Retried rather than filed: a
      // 429 is transient, and an unavailable own-page row is what makes the
      // whole update refuse its own input.
      if (read.reason === "rate_limited")
        return { kind: "failed_retryable", reason: "rate_limited" };
      status = { kind: "unavailable", reason: storableReason(read.reason) };
    } else if (!isHtml(read.contentType)) {
      status = { kind: "unavailable", reason: "invalid_response" };
    } else {
      const observed = observedStructure(
        readGeoOffsitePageSignals(read.body, target.url),
        target.scope === "own"
          ? parsedPageStructure(read.body, target.url)
          : null,
      );
      // A page with nothing quotable supports no claim. It was still reached,
      // and "reached and unusable" is a different fact from "never looked".
      status =
        observed.excerpts.length === 0
          ? { kind: "unavailable", reason: "insufficient_evidence" }
          : {
              kind: "ok",
              bodyHash: sha256(read.body),
              excerpts: observed.excerpts,
              structured: observed.structured,
            };
    }

    const written = await sources
      .recordObservation({
        ...selector(context.userId, websiteId, target),
        observedAt,
        status,
      })
      .catch(() => ({ kind: "unavailable" as const }));
    if (written.kind === "ok") {
      /*
       * The site's own machine-readable files, on the back of the admission
       * the page read already spent, and only once the page's own row is
       * safely filed: if this ledger cannot take the row the operation exists
       * for, spending six more seconds and three more writes on rows beside it
       * is throwing work at a store we have just watched fail.
       *
       * Competitor operations do not do this. A rival's robots.txt answers no
       * question the owner's card asks, and it would be a second host's
       * allowance.
       */
      if (target.scope === "own") {
        const machine = await recordMachineSignals({
          read: reader,
          record: sources.recordObservation,
          now: sources.now,
          userId: context.userId,
          websiteId,
          targetUrl: target.url,
          // The page read above got out, so the admission is already memoised.
          gateAlreadyOpen: true,
        });
        // Unreachable while that holds. Kept because the branch above decides
        // it from what the reader reported, not from where it was called.
        if (machine.kind === "no_admission")
          return { kind: "failed_retryable", reason: "rate_limited" };
      }
      return { kind: "succeeded", resultRef: written.value.observationId };
    }
    if (written.kind === "missing")
      return { kind: "failed_permanent", reason: "not_found" };
    // The row we built is one this ledger refuses; building it again produces
    // the same one, and the fetch behind it has already been spent.
    if (written.kind === "invalid")
      return { kind: "failed_permanent", reason: "invalid_output" };
    // We looked, and we cannot say whether the library kept it. Not a retry.
    return { kind: "outcome_unknown" };
  };

  const probe = async (
    operation: {
      readonly key: string;
      readonly kind: string;
      readonly state: string;
    },
    context: { readonly userId: string; readonly kbId: string },
  ): Promise<GeoRunProbeOutcome> => {
    if (operation.kind !== "fetch") return { kind: "unresolved" };
    // The dispatch mark is written before the request leaves, so a row still
    // reading `claimed` provably sent nothing. That is the only state in which
    // "nothing was dispatched" is a fact rather than a hope.
    if (operation.state === "claimed") return { kind: "not_dispatched" };
    const resolved = await resolve(context, operation.key);
    if (resolved.kind !== "ok") return { kind: "unresolved" };
    const latest = await sources
      .readLatestObservation(
        selector(context.userId, resolved.websiteId, resolved.target),
      )
      .catch(() => ({ kind: "unavailable" as const }));
    if (latest.kind !== "ok" || latest.value === null)
      return { kind: "unresolved" };
    // Only a row this operation could have produced settles it. An expired one
    // is the row the fetch was meant to supersede, and reporting it as this
    // operation's result would date the update by an observation it replaced.
    return isObservationFresh(
      latest.value,
      sources.now(),
      geoEvidenceTtlMs(resolved.target.kind),
    )
      ? { kind: "succeeded", resultRef: latest.value.observationId }
      : { kind: "unresolved" };
  };

  return {
    seedOperations,
    executor: {
      start: async (operation, runContext) =>
        await start(operation, runContext),
      probe: async (operation, runContext) =>
        await probe(operation, runContext),
    },
  };
}

/**
 * The real sources.
 *
 * `findAccountWebsiteByUrl` is how a knowledge base reaches its website today:
 * the two registries are still joined by canonical site key rather than by a
 * foreign key (design D10), so the target URL is the only bridge there is.
 */
export const DEFAULT_GEO_RUN_COLLECT_SOURCES: GeoRunCollectSources = {
  readDetails: async (input) => await readVersionedGeoKnowledgeBase(input),
  resolveWebsiteId: async (input) => {
    const found = await findAccountWebsiteByUrl(input.userId, input.targetUrl);
    if (found.kind === "missing") return { kind: "missing" };
    if (found.kind !== "ok") return { kind: "unavailable" };
    return { kind: "ok", websiteId: found.value.website.websiteId };
  },
  readLatestObservation: async (input) => await readLatestObservation(input),
  recordObservation: async (input) => await recordObservation(input),
  createReader: (clientKey) => createGeoKnowledgeResourceReader(clientKey),
  now: () => new Date(),
};
