// @input  -- cheerio CheerioAPI ($) over a parsed HTML document
// @output -- extractStructuredData($): readonly StructuredDataBlock[]
//            extractAnalyticsTags($): AnalyticsTags
//            extractRobotsMeta($): { noindex: boolean }  (HTML meta signal)
//            xRobotsTagNoindex(headerValue): boolean      (HTTP header signal)
// @pos    -- A10/A13/SV1.5 light-up. Pure extractors split out of page-fetcher.ts
//            (file-size rule <200). JSON-LD blocks → A10 SD.* rules; GA4/GTM tag
//            scan → A1 DATA.GA4_DETECTED + A13 MEASURE.* rules; meta-robots +
//            X-Robots-Tag noindex → SV1.5 isIndexable. No I/O, no AI.
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type * as cheerio from "cheerio";

import type { AnalyticsTags, StructuredDataBlock } from "./types";

/** Cap JSON-LD blocks parsed per page (defensive against malicious-deep DOMs). */
export const STRUCTURED_DATA_CAP = 50;
/** Cap analytics ids captured per kind per page (defensive). */
const ANALYTICS_ID_CAP = 20;

type CheerioApi = ReturnType<typeof cheerio.load>;

/**
 * Normalize a JSON-LD node's `@type` into a string array (array-safe: a node may
 * declare a single type string or an array of types). Non-string entries are
 * dropped. Returns `[]` when no usable `@type` is present.
 */
function normalizeTypes(node: unknown): string[] {
  if (node === null || typeof node !== "object") return [];
  const raw = (node as Record<string, unknown>)["@type"];
  const arr = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return arr.filter((t): t is string => typeof t === "string");
}

/**
 * Flatten one parsed JSON-LD value into structured-data blocks. A top-level
 * `@graph` (array OR single object) yields one block per node; an array value
 * yields one block per entry; a plain object yields a single block.
 */
function blocksFromParsed(parsed: unknown): StructuredDataBlock[] {
  if (Array.isArray(parsed)) {
    return parsed.map((node) => ({
      types: normalizeTypes(node),
      parseError: false,
    }));
  }
  if (parsed !== null && typeof parsed === "object") {
    const graph = (parsed as Record<string, unknown>)["@graph"];
    if (graph !== undefined) {
      // @graph may be an array (one block per node) or a single object
      // (wrap to a one-element array so its node is not lost).
      const nodes = Array.isArray(graph) ? graph : [graph];
      return nodes.map((node) => ({
        types: normalizeTypes(node),
        parseError: false,
      }));
    }
    return [{ types: normalizeTypes(parsed), parseError: false }];
  }
  // Primitive (string/number/bool) — valid JSON but no @type.
  return [{ types: [], parseError: false }];
}

/**
 * Extract parsed JSON-LD structured-data blocks from a page. Each
 * `<script type="application/ld+json">` is `JSON.parse`d; parse errors are
 * captured (`parseError: true`, `types: []`), never thrown. Returns an EMPTY
 * array when the page has no json-ld (a coverage gap, NOT a parse failure).
 */
export function extractStructuredData(
  $: CheerioApi,
): readonly StructuredDataBlock[] {
  const blocks: StructuredDataBlock[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    if (blocks.length >= STRUCTURED_DATA_CAP) return false; // break
    const raw = $(el).text().trim();
    if (raw.length === 0) return; // empty script tag — skip, not an error
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      blocks.push({ types: [], parseError: true });
      return;
    }
    for (const b of blocksFromParsed(parsed)) {
      if (blocks.length >= STRUCTURED_DATA_CAP) break;
      blocks.push(b);
    }
  });
  return Object.freeze(blocks);
}

// GA4 measurement id: G- followed by exactly 10 uppercase-alphanumeric chars.
// Word boundaries (\b) prevent matching ids embedded in larger tokens
// (e.g. "IMG-ABCDE12345" must NOT yield "G-ABCDE12345").
const GA4_ID_RE = /\bG-[A-Z0-9]{10}\b/g;
// GTM container id: GTM- followed by 4+ uppercase-alphanumeric chars. Bounded.
const GTM_ID_RE = /\bGTM-[A-Z0-9]{4,}\b/g;
// Placeholder ids whose suffix is entirely X (e.g. "G-XXXXXXXXXX",
// "GTM-XXXXXXX") are template stubs, not real tags — reject deterministically.
const PLACEHOLDER_ID_RE = /^(?:G|GTM)-X+$/i;

function pushMatches(
  text: string,
  re: RegExp,
  seen: Set<string>,
  out: string[],
): void {
  const matches = text.match(re);
  if (!matches) return;
  for (const m of matches) {
    if (out.length >= ANALYTICS_ID_CAP) return;
    if (PLACEHOLDER_ID_RE.test(m)) continue;
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
}

/**
 * Extract meta-robots noindex signal from a parsed HTML page. Inspects
 * `<meta name="robots">` and `<meta name="googlebot">` (case-insensitive).
 * Content is tokenized by comma and space; the page is noindex when any token
 * is "noindex" or the entire content is "none". Returns `{ noindex: false }`
 * when no relevant meta tag is present (safe default: indexable).
 *
 * Note: this covers the HTML `<meta>` signal only. The X-Robots-Tag HTTP
 * response header is parsed separately by `xRobotsTagNoindex` (the header is not
 * in the cheerio DOM); page-fetcher ORs the two into PageRecord.robotsNoindex.
 */
export function extractRobotsMeta($: CheerioApi): { noindex: boolean } {
  let noindex = false;
  $("meta").each((_, el) => {
    if (noindex) return false; // short-circuit
    const name = ($(el).attr("name") ?? "").toLowerCase();
    if (name !== "robots" && name !== "googlebot") return;
    const content = ($(el).attr("content") ?? "").toLowerCase();
    const tokens = content
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.includes("noindex") || tokens.includes("none")) {
      noindex = true;
    }
  });
  return Object.freeze({ noindex });
}

// Known X-Robots-Tag directive keywords — used to tell a directive-with-value
// ("max-image-preview: large", "unavailable_after: <date>") apart from a
// user-agent scope prefix ("googlebot: noindex"). A leading word that is NOT a
// known directive is treated as a UA scope.
const X_ROBOTS_DIRECTIVES = new Set([
  "noindex",
  "none",
  "index",
  "follow",
  "nofollow",
  "all",
  "noarchive",
  "nosnippet",
  "notranslate",
  "noimageindex",
  "nocache",
  "max-snippet",
  "max-image-preview",
  "max-video-preview",
  "unavailable_after",
  "noydir",
  "noodp",
  "indexifembedded",
]);

/**
 * Detect noindex in an X-Robots-Tag HTTP response header value, respecting
 * user-agent scope. The header is a comma-separated directive list, each
 * directive optionally prefixed with a UA ("googlebot: noindex"). A noindex /
 * none applies to us only when it is GLOBAL (no UA prefix) or scoped to
 * googlebot / google — a noindex scoped to an unrelated bot ("otherbot:
 * noindex") must NOT mark the page noindex for Google (Google docs: unscoped
 * rules apply to all crawlers; UA-prefixed rules apply only to that UA).
 * Null/empty → false. Header noindex is authoritative even when the HTML body
 * was truncated (the header is fully available regardless of body read).
 */
export function xRobotsTagNoindex(
  headerValue: string | null | undefined,
): boolean {
  if (!headerValue) return false;
  for (const rawSegment of headerValue.toLowerCase().split(",")) {
    const segment = rawSegment.trim();
    if (!segment) continue;
    let scope = "global";
    let body = segment;
    const colon = segment.indexOf(":");
    if (colon > 0) {
      const head = segment.slice(0, colon).trim();
      // A leading "word:" is a UA scope only if word is NOT a known directive
      // (so "max-image-preview: large" stays a global directive, not a scope).
      if (!X_ROBOTS_DIRECTIVES.has(head)) {
        scope = head;
        body = segment.slice(colon + 1).trim();
      }
    }
    if (scope !== "global" && scope !== "googlebot" && scope !== "google") {
      continue; // noindex scoped to an unrelated bot — ignore for Google
    }
    const tokens = body
      .split(/[\s:]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.includes("noindex") || tokens.includes("none")) return true;
  }
  return false;
}

/**
 * Scan `<script>` tags (both `src` attribute and inline text) for GA4 and GTM
 * tag ids. Detects GA4 via `gtag/js?id=G-XXXX`, inline `gtag('config','G-...')`,
 * or any `G-XXXXXXXXXX` token; GTM via `gtm.js?id=GTM-XXXX` or any `GTM-XXXX`
 * token. Ids are matched with word boundaries (no false hits inside larger
 * tokens) and all-X placeholder ids are rejected. Deduped per page. Front-end
 * presence only (no comment/JS-string stripping — documented caveat).
 */
export function extractAnalyticsTags($: CheerioApi): AnalyticsTags {
  const ga4Seen = new Set<string>();
  const gtmSeen = new Set<string>();
  const ga4Ids: string[] = [];
  const gtmIds: string[] = [];

  $("script").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    const inline = $(el).text();
    const haystack = `${src}\n${inline}`;
    pushMatches(haystack, GA4_ID_RE, ga4Seen, ga4Ids);
    pushMatches(haystack, GTM_ID_RE, gtmSeen, gtmIds);
  });

  return {
    ga4Ids: Object.freeze([...ga4Ids]),
    gtmIds: Object.freeze([...gtmIds]),
  };
}
