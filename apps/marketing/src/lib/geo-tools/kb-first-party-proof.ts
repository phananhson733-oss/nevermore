// @input  -- the HTML of one page on the site the knowledge base is about
// @output -- the authorship, review and first-party-data markers that page carries
// @pos    -- observation only; it fetches nothing, verifies nothing and scores nothing

/**
 * Rule R11: an engine reads author identity, review credit and original data as
 * reliability signals. So the knowledge base records whether a page carries
 * them -- and stops there.
 *
 * It stops there because the honest thing this layer can say is "the page
 * credits an author", never "the author is qualified" or "the data is real". A
 * byline is a string a template printed; a table is markup. Turning either into
 * a credential or a score would be the machine granting itself the verification
 * that only a person can grant (R10), and the customer would have no way to see
 * that the number came from a `<table>` tag.
 *
 * The byline reader also serves the offsite independence judgement, which asks
 * a different question of the same markup: is there a publishing identity here
 * that is not the brand? Both questions read one extractor so that the day the
 * markup changes, they cannot start disagreeing about what the page says.
 */
import { load } from "cheerio";

import { codePointLength, sliceCodePoints } from "../agents/geo-canonical.ts";

export const GEO_FIRST_PARTY_LIMITS = {
  /** A single JSON-LD block larger than this is not read; it is not evidence. */
  jsonLdScriptBytes: 64 * 1024,
  jsonLdDepth: 16,
  jsonLdArrayWidth: 128,
  /** Names kept per kind. More than a handful is a credits page, not a byline. */
  namesPerKind: 8,
  nameCodePoints: 200,
  /** Elements whose class names are scanned for a visible byline. */
  bylineCandidates: 400,
  /** Raw characters an element may hold and still be considered a byline. */
  bylineRawCharacters: 400,
  headingsScanned: 24,
  headingCodePoints: 200,
  summaryCodePoints: 800,
  labelCodePoints: 120,
} as const;

/** A parsed document, shared so authorship and body text are read from one parse. */
export type GeoLoadedHtml = ReturnType<typeof load>;

/**
 * Controls JSON can carry but the knowledge contracts reject. Replaced with a
 * space rather than deleted: deleting joins two words that were separate.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;

/** One line of whitespace-collapsed, contract-safe text. */
export function geoCleanText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, " ").replace(/\s+/gu, " ").trim();
}

/** Cleaned and cut to a code-point budget, never splitting an astral character. */
export function geoBoundText(value: string, limit: number): string {
  return sliceCodePoints(geoCleanText(value), limit);
}

export interface GeoBylineSignals {
  /** `author` and `creator` names, from structured data and from `meta`. */
  readonly authors: readonly string[];
  /** `reviewedBy` names. Separate from authors: reviewing is not writing. */
  readonly reviewers: readonly string[];
  /**
   * Named publishing entities.
   *
   * `og:site_name` is deliberately excluded. It names the website, which every
   * page has, so accepting it would make "this page declares a publisher" true
   * everywhere and the independence test that depends on it meaningless.
   */
  readonly publishers: readonly string[];
  /** The first structured publication date, exactly as the page wrote it. */
  readonly datePublished: string | null;
  /** Text of blocks the page itself marks up as a byline. */
  readonly visibleBylines: readonly string[];
}

interface BylineAccumulator {
  readonly authors: string[];
  readonly reviewers: string[];
  readonly publishers: string[];
  datePublished: string | null;
}

function addName(target: string[], value: unknown): void {
  if (target.length >= GEO_FIRST_PARTY_LIMITS.namesPerKind) return;
  if (typeof value === "string") {
    const name = geoBoundText(value, GEO_FIRST_PARTY_LIMITS.nameCodePoints);
    // A URL in an author slot identifies a profile, not a person by name.
    if (name === "" || /^https?:\/\//iu.test(name) || target.includes(name)) return;
    target.push(name);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, GEO_FIRST_PARTY_LIMITS.jsonLdArrayWidth)) addName(target, entry);
    return;
  }
  if (value !== null && typeof value === "object") addName(target, (value as Record<string, unknown>).name);
}

function walkJsonLd(value: unknown, found: BylineAccumulator, depth: number): void {
  if (depth > GEO_FIRST_PARTY_LIMITS.jsonLdDepth || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length > GEO_FIRST_PARTY_LIMITS.jsonLdArrayWidth) return;
    for (const item of value) walkJsonLd(item, found, depth + 1);
    return;
  }
  const object = value as Record<string, unknown>;
  addName(found.authors, object["author"]);
  addName(found.authors, object["creator"]);
  addName(found.reviewers, object["reviewedBy"]);
  addName(found.publishers, object["publisher"]);
  const published = object["datePublished"];
  if (found.datePublished === null && typeof published === "string") {
    const date = geoBoundText(published, 64);
    if (date !== "") found.datePublished = date;
  }
  for (const nested of Object.values(object)) walkJsonLd(nested, found, depth + 1);
}

/**
 * Class names a page uses to mark its own byline.
 *
 * Matched against the whole lower-cased class attribute with `-`, `_` and space
 * all treated as separators, so `entry-author` and `post_byline` match while
 * `authorization` does not.
 */
const BYLINE_CLASS = /(?:^|[\s_-])(?:byline|author|contributor)(?:[\s_-]|$)/u;

function readVisibleBylines($: GeoLoadedHtml): readonly string[] {
  const found: string[] = [];
  const consider = (raw: string): void => {
    if (found.length >= GEO_FIRST_PARTY_LIMITS.namesPerKind) return;
    if (raw.length > GEO_FIRST_PARTY_LIMITS.bylineRawCharacters) return;
    const cleaned = geoCleanText(raw);
    // Rejected rather than truncated: a cut-off paragraph presented as a byline
    // is a claim about the page that the page never made.
    if (codePointLength(cleaned) < 2 || codePointLength(cleaned) > GEO_FIRST_PARTY_LIMITS.nameCodePoints) return;
    if (!found.includes(cleaned)) found.push(cleaned);
  };
  $('[rel~="author"], [itemprop~="author"], [itemprop~="creator"]').each((_index, element) => {
    consider($(element).text());
  });
  let scanned = 0;
  $("[class]").each((_index, element) => {
    if (scanned >= GEO_FIRST_PARTY_LIMITS.bylineCandidates) return false;
    scanned += 1;
    if (BYLINE_CLASS.test(($(element).attr("class") ?? "").toLocaleLowerCase("en"))) consider($(element).text());
    return undefined;
  });
  return found;
}

function readMetaContent($: GeoLoadedHtml, selector: string): readonly string[] {
  const values: string[] = [];
  $(selector).each((_index, element) => {
    addName(values, $(element).attr("content"));
  });
  return values;
}

/** Authorship signals read from an already-parsed document; never mutates it. */
export function readGeoBylineSignalsFrom($: GeoLoadedHtml): GeoBylineSignals {
  const found: BylineAccumulator = { authors: [], reviewers: [], publishers: [], datePublished: null };
  $("script[type='application/ld+json']").each((_index, element) => {
    const script = $(element).html() ?? $(element).text();
    if (Buffer.byteLength(script, "utf8") > GEO_FIRST_PARTY_LIMITS.jsonLdScriptBytes) return;
    try {
      walkJsonLd(JSON.parse(script) as unknown, found, 0);
    } catch {
      // Malformed JSON-LD is not a signal; a page that ships broken markup has
      // not credited anybody.
    }
  });
  for (const name of readMetaContent($, "meta[name='author'], meta[property='article:author']")) addName(found.authors, name);
  for (const name of readMetaContent($, "meta[name='publisher']")) addName(found.publishers, name);
  if (found.datePublished === null) {
    const published = $("meta[property='article:published_time']").attr("content")
      ?? $("time[itemprop='datePublished']").attr("datetime")
      ?? "";
    const date = geoBoundText(published, 64);
    if (date !== "") found.datePublished = date;
  }
  return {
    authors: [...found.authors],
    reviewers: [...found.reviewers],
    publishers: [...found.publishers],
    datePublished: found.datePublished,
    visibleBylines: readVisibleBylines($),
  };
}

/** Authorship signals for callers holding raw HTML. */
export function readGeoBylineSignals(html: string): GeoBylineSignals {
  return readGeoBylineSignalsFrom(load(html));
}

/**
 * Heading words that say a page is reporting its own work.
 *
 * Deliberately narrow. Bare `data` and `report` were dropped: every pricing
 * page has "data" somewhere and every product ships a "report", so including
 * them would have marked most of a site as original research -- which is the
 * exact claim this module refuses to invent.
 */
const RESEARCH_HEADING = /methodolog|data ?set|survey|benchmark|white ?paper|statistics|research|stud(?:y|ies)|方法论|数据集|调查|统计|研究|基准/iu;

/** Alt text that says a figure is a chart rather than a photograph. */
const CHART_ALT = /chart|graph|plot|图表/iu;

export interface GeoFirstPartyDataSignals {
  /** Tables with at least two rows and four cells; layout tables do not count. */
  readonly dataTables: number;
  readonly charts: number;
  /** The heading that matched, kept verbatim so a reader can check the match. */
  readonly researchHeading: string | null;
}

function countDataTables($: GeoLoadedHtml): number {
  let tables = 0;
  $("table").each((_index, element) => {
    const table = $(element);
    if ((table.attr("role") ?? "").toLocaleLowerCase("en") === "presentation") return;
    if (table.find("tr").length >= 2 && table.find("td, th").length >= 4) tables += 1;
  });
  return tables;
}

function countCharts($: GeoLoadedHtml): number {
  let charts = $("canvas").length + $("svg[role='img'], svg[aria-label], figure svg").length;
  $("figure img[alt]").each((_index, element) => {
    if (CHART_ALT.test($(element).attr("alt") ?? "")) charts += 1;
  });
  return charts;
}

function readDataSignals($: GeoLoadedHtml): GeoFirstPartyDataSignals {
  const headings: string[] = [geoBoundText($("title").text(), GEO_FIRST_PARTY_LIMITS.headingCodePoints)];
  $("h1, h2, h3").each((_index, element) => {
    if (headings.length >= GEO_FIRST_PARTY_LIMITS.headingsScanned) return false;
    headings.push(geoBoundText($(element).text(), GEO_FIRST_PARTY_LIMITS.headingCodePoints));
    return undefined;
  });
  const matched = headings.find((heading) => heading !== "" && RESEARCH_HEADING.test(heading)) ?? null;
  return { dataTables: countDataTables($), charts: countCharts($), researchHeading: matched };
}

export type GeoFirstPartySignalKind =
  | "structured_author"
  | "structured_reviewed_by"
  | "structured_date_published"
  | "visible_byline"
  | "first_party_data_candidate";

export interface GeoFirstPartyObservation {
  /** Stable per page and signal, so a re-run of the same page produces one row. */
  readonly id: string;
  readonly signal: GeoFirstPartySignalKind;
  readonly url: string;
  readonly sourceRef: string;
  readonly label: string;
  /** What was observed, in the page's own words where there are any. */
  readonly summary: string;
}

const SIGNAL_LABELS: Readonly<Record<GeoFirstPartySignalKind, string>> = {
  structured_author: "Author in structured data",
  structured_reviewed_by: "Reviewer in structured data",
  structured_date_published: "Publication date in structured data",
  visible_byline: "Visible byline",
  first_party_data_candidate: "First-party data candidate",
};

function observation(
  signal: GeoFirstPartySignalKind,
  input: { readonly url: string; readonly sourceRef: string },
  summary: string,
): GeoFirstPartyObservation {
  return {
    id: `evidence:first-party:${signal}:${input.sourceRef}`,
    signal,
    url: input.url,
    sourceRef: input.sourceRef,
    label: geoBoundText(SIGNAL_LABELS[signal], GEO_FIRST_PARTY_LIMITS.labelCodePoints),
    summary: geoBoundText(summary, GEO_FIRST_PARTY_LIMITS.summaryCodePoints),
  };
}

export interface GeoFirstPartyPageInput {
  readonly url: string;
  readonly sourceRef: string;
  readonly html: string;
}

/**
 * What one own-site page carries, as rows for the evidence module's first-party
 * group. An empty list means the page carried none of these markers -- which is
 * an observation, not a failure, and not a lower score.
 */
export function observeGeoFirstPartyProof(input: GeoFirstPartyPageInput): readonly GeoFirstPartyObservation[] {
  const $ = load(input.html);
  const byline = readGeoBylineSignalsFrom($);
  const data = readDataSignals($);
  const rows: GeoFirstPartyObservation[] = [];
  if (byline.authors.length > 0) rows.push(observation("structured_author", input, `Credits author: ${byline.authors.join(", ")}.`));
  if (byline.reviewers.length > 0) rows.push(observation("structured_reviewed_by", input, `Credits reviewer: ${byline.reviewers.join(", ")}.`));
  if (byline.datePublished !== null) rows.push(observation("structured_date_published", input, `Declares publication date: ${byline.datePublished}.`));
  if (byline.visibleBylines.length > 0) rows.push(observation("visible_byline", input, `Marks up a byline block: ${byline.visibleBylines.join(" / ")}.`));
  if (data.researchHeading !== null && (data.dataTables > 0 || data.charts > 0)) {
    rows.push(observation(
      "first_party_data_candidate",
      input,
      `Heading "${data.researchHeading}" over ${data.dataTables} data table(s) and ${data.charts} chart element(s). Whether the data is original was not checked.`,
    ));
  }
  return rows;
}
