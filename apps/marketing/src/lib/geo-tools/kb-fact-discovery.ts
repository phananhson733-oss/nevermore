// @input  -- one fetched page of the site the knowledge base is about
// @output -- the claims that page publishes about itself, as fact candidates
// @pos    -- extraction only; it fetches nothing, judges nothing and admits nothing
import { load } from "cheerio";
import { createHash } from "node:crypto";
import { GEO_KB_SOURCE_LIMITS } from "./kb-source-contract.ts";
import type { GeoFactSourceV2 } from "./kb-source-contract.ts";
import type { GeoEnrichmentPage } from "./kb-enrichment.ts";
import { GEO_KB_LIMITS } from "./kb-contract.ts";

/**
 * A page's own structured question and answer pairs. `FAQPage` is the one place
 * a site states, in its own markup and its own words, "this is the question,
 * and this is our answer" -- which is the shape a GEO fact needs: a dimension
 * a page can be searched for, and the value it gives for it.
 *
 * Prose is deliberately not mined. A sentence lifted out of a paragraph is an
 * editorial judgement about what the page meant; a marked-up answer is what the
 * site published as its answer, and the marker is the site's own.
 */
export interface GeoFactCandidate {
  readonly key: string;
  readonly value: string;
  /** What the page said in full, kept as the evidence for the shortened value. */
  readonly excerpt: string;
}

const collapse = (value: unknown): string =>
  typeof value === "string" ? load(`<x>${value}</x>`)("x").text().replace(/\s+/gu, " ").trim() : "";

/**
 * As many whole sentences of the answer as the 200-character fact value holds.
 * Cutting mid-sentence would put a claim in the knowledge base that the page
 * does not make; an answer whose first sentence alone does not fit is left out
 * rather than trimmed into something shorter than what was said.
 */
function opening(answer: string): string | null {
  const sentences: string[] = [];
  let start = 0;
  const terminator = /[.!?。！？]/gu;
  for (let match = terminator.exec(answer); match !== null; match = terminator.exec(answer)) {
    const after = answer[match.index + 1] ?? "";
    // A terminator with a word still attached to it is inside a token, not the
    // end of a sentence: this is what keeps "29.5 years" one number and "every
    // 29. 5 years" out of the knowledge base. A digit test as well would read
    // as a second rule and never fire -- this one has already decided.
    if (after !== "" && !/\s/u.test(after)) continue;
    sentences.push(answer.slice(start, match.index + 1).trim());
    start = match.index + 1;
  }
  const tail = answer.slice(start).trim();
  if (tail !== "") sentences.push(tail);
  let taken = "";
  for (const sentence of sentences) {
    const next = taken === "" ? sentence : `${taken} ${sentence}`;
    if (next.length > GEO_KB_LIMITS.text) break;
    taken = next;
  }
  return taken.length >= 12 ? taken : null;
}

/** Every `FAQPage` answer this page publishes, in document order. */
export function geoFactCandidates(page: GeoEnrichmentPage): readonly GeoFactCandidate[] {
  if (page.kind !== "ok") return [];
  const $ = load(page.body);
  const candidates: GeoFactCandidate[] = [];
  const seen = new Set<string>();
  let visited = 0;
  const walk = (value: unknown, depth = 0): void => {
    if (depth > 5 || visited++ > 200 || candidates.length >= GEO_KB_LIMITS.facts) return;
    if (Array.isArray(value)) { for (const child of value.slice(0, 201)) walk(child, depth + 1); return; }
    if (value === null || typeof value !== "object") return;
    const entry = value as Record<string, unknown>;
    const types = Array.isArray(entry["@type"]) ? entry["@type"] : [entry["@type"]];
    if (types.includes("Question")) {
      const key = collapse(entry.name);
      const answer = entry.acceptedAnswer;
      const excerpt = collapse(answer !== null && typeof answer === "object" ? (answer as Record<string, unknown>).text : undefined);
      const value = excerpt === "" ? null : opening(excerpt);
      const identity = key.toLocaleLowerCase("en");
      if (key !== "" && key.length <= GEO_KB_LIMITS.text && value !== null && !seen.has(identity)) {
        seen.add(identity);
        candidates.push({ key, value, excerpt: excerpt.slice(0, 1_000) });
      }
    }
    for (const child of ["mainEntity", "@graph", "itemListElement"]) if (entry[child] !== undefined) walk(entry[child], depth + 1);
  };
  $("script[type='application/ld+json']").slice(0, 10).each((_index, node) => {
    try { walk(JSON.parse($(node).text())); } catch { /* malformed JSON-LD carries no claim */ }
  });
  return candidates;
}

/**
 * The candidates as receipt evidence. Their support is the page's own markup,
 * not a rendered paragraph: that is where the site made the statement, so that
 * is what the receipt records, with the body hash of the page it came from.
 */
export function discoverGeoFactSourcesV2(page: GeoEnrichmentPage, firstIndex: number, limit: number): readonly GeoFactSourceV2[] {
  if (page.kind !== "ok" || limit <= 0) return [];
  const bodyHash = createHash("sha256").update(page.body).digest("hex");
  return geoFactCandidates(page).slice(0, Math.min(limit, GEO_KB_SOURCE_LIMITS.facts - firstIndex + 1)).map((candidate, offset) => ({
    evidenceId: `F${firstIndex + offset}` as const,
    key: candidate.key, value: candidate.value, confirmed: false as const,
    source: "crawl" as const, sourceUrl: page.url, observedAt: page.observedAt, bodyHash,
    status: "available" as const, reason: null, excerpt: candidate.excerpt,
  }));
}
