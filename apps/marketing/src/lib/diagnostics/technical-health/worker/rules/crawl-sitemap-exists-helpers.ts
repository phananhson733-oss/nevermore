// @input  -- raw sitemap XML body string
// @output -- SitemapAnalysis: rootTag, locCount, childCount
// @pos    -- D1 Phase 1 chunk 3 — pure parsing helpers for crawl-sitemap-exists.ts.
//            No HTTP, no I/O. Split out to keep the rule file < 200 LOC.
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

export type SitemapRootTag = "urlset" | "sitemapindex" | "unknown";

export interface SitemapAnalysis {
  readonly rootTag: SitemapRootTag;
  /** Number of <loc> occurrences (proxy for URL count in a <urlset>). */
  readonly locCount: number;
  /** Number of <sitemap> occurrences (proxy for child sitemap count in a <sitemapindex>). */
  readonly childCount: number;
}

/**
 * Classify a sitemap body without a full XML parser.
 * Counts occurrences via regex — fast and sufficient for Phase 1 detection.
 * Phase 2+ can introduce a proper XML parser for page-level analysis.
 */
export function analyzeSitemapBody(body: string): SitemapAnalysis {
  const hasUrlset = /<urlset[\s>]/i.test(body);
  const hasSitemapIndex = /<sitemapindex[\s>]/i.test(body);

  const rootTag: SitemapRootTag = hasUrlset
    ? "urlset"
    : hasSitemapIndex
      ? "sitemapindex"
      : "unknown";

  const locCount = (body.match(/<loc>/gi) ?? []).length;
  const childCount = (body.match(/<sitemap[\s>]/gi) ?? []).length;

  return { rootTag, locCount, childCount };
}

/**
 * Build an `extracted_text` evidence record from the first 500 chars of body.
 *
 * Storage-time hygiene (P2-13):
 *   1. Truncate to 500 chars first (bounds work below to a fixed budget).
 *   2. Strip ASCII control characters \x00-\x1F EXCEPT \n (0x0A) and \t (0x09),
 *      which carry useful structure.
 *   3. HTML-escape & < > " ' so a future UI that mis-renders this column with
 *      innerHTML cannot execute the stored payload (defense in depth: every
 *      UI must still escape on render).
 * Appends "[truncated]" suffix when the original body exceeded 500 chars.
 */
export function buildSitemapTextEvidence(body: string): {
  kind: "extracted_text";
  snippet: string;
} {
  const wasTruncated = body.length > 500;
  const head = wasTruncated ? body.slice(0, 500) : body;
  const sanitized = sanitizeSnippet(head);
  const snippet = wasTruncated ? `${sanitized}[truncated]` : sanitized;
  return { kind: "extracted_text", snippet };
}

/**
 * Strip control characters (except \n / \t) and HTML-escape special characters.
 * Inline + tiny + zero-dependency by design — see crawl-robots-core-helpers.ts
 * for the rationale. Duplicated rather than extracted because the two helpers
 * are deliberately independent (rules can be deleted independently).
 */
function sanitizeSnippet(input: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = input.replace(/[\x00-\x08\x0B-\x1F]/g, "");
  return stripped
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
