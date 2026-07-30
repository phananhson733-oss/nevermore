// @input  -- robots.txt body string (raw text)
// @output -- RobotsAnalysis: hasUserAgent, hasSitemap, blocksAllCrawlers
// @pos    -- D1 Phase 1 chunk 2 — pure parsing helpers for crawl-robots-core.ts.
//            No HTTP, no I/O. Deliberately separate to keep the rule file < 200 LOC.
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

export interface RobotsAnalysis {
  readonly hasUserAgent: boolean;
  readonly hasSitemap: boolean;
  readonly blocksAllCrawlers: boolean;
}

/** One parsed robots.txt group (consecutive UA lines + their rules). */
interface RobotsGroup {
  readonly agents: readonly string[]; // lowercased user-agent values
  readonly disallowRoot: boolean; // group has Disallow: /
  readonly allowRoot: boolean; // group has Allow: / or Allow: (empty)
}

/**
 * Parse the robots.txt body and classify it along three boolean axes:
 *
 * - `hasUserAgent`:      at least one `User-agent:` directive is present
 * - `hasSitemap`:        at least one `Sitemap:` directive is present
 * - `blocksAllCrawlers`: any group whose `agents` contains `*` has
 *                        `Disallow: /` with no overriding `Allow: /`
 *
 * Implements the Google Robots Exclusion Protocol group semantics:
 * consecutive `User-agent:` lines before the first Allow/Disallow form a
 * single group that applies to ALL listed agents.
 *
 * Intentionally minimal — only what CRAWL.ROBOTS_CORE needs for Phase 1.
 * Phase 2+ page-level crawl analysis will use the full parseRobotsTxt from
 * analysis-data-robots.ts.
 */
export function analyzeRobotsBody(body: string): RobotsAnalysis {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  const groups = parseGroups(lines);
  const hasUserAgent = groups.length > 0;

  // hasSitemap: Sitemap: directives are top-level (outside groups per spec).
  // We track them during group parsing as well.
  let hasSitemap = false;
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    if (directive === "sitemap") {
      hasSitemap = true;
      break;
    }
  }

  // blocksAllCrawlers: true iff some group containing * has Disallow: /
  // with no overriding Allow: /
  const wildcardGroups = groups.filter((g) => g.agents.includes("*"));
  const blocksAllCrawlers = wildcardGroups.some(
    (g) => g.disallowRoot && !g.allowRoot,
  );

  return { hasUserAgent, hasSitemap, blocksAllCrawlers };
}

/**
 * Split a flat directive list into robots.txt groups.
 *
 * A group begins at the first `User-agent:` line encountered after
 * non-User-agent content (or at the start of the file). The group's
 * agent list grows as long as consecutive `User-agent:` lines follow.
 * The first non-UA directive (Allow/Disallow/Crawl-delay/…) closes the
 * agent-accumulation phase and starts accumulating rules. A blank-line
 * boundary (already stripped by the caller) or a new `User-agent:` line
 * after any rule closes the group entirely.
 */
function parseGroups(lines: readonly string[]): RobotsGroup[] {
  const groups: RobotsGroup[] = [];

  let currentAgents: string[] = [];
  let currentDisallowRoot = false;
  let currentAllowRoot = false;
  // Whether we have seen at least one non-UA directive in the current group
  let inRulePhase = false;

  function flushGroup(): void {
    if (currentAgents.length === 0) return;
    groups.push({
      agents: currentAgents,
      disallowRoot: currentDisallowRoot,
      allowRoot: currentAllowRoot,
    });
    currentAgents = [];
    currentDisallowRoot = false;
    currentAllowRoot = false;
    inRulePhase = false;
  }

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line
      .slice(colonIdx + 1)
      .trim()
      .toLowerCase();

    if (directive === "user-agent") {
      // A new UA line after we already collected rules → new group
      if (inRulePhase) {
        flushGroup();
      }
      currentAgents.push(value);
    } else if (directive === "disallow" || directive === "allow") {
      // First non-UA directive: close the agent-accumulation phase
      inRulePhase = true;
      if (directive === "disallow" && value === "/") {
        currentDisallowRoot = true;
      } else if (directive === "allow" && (value === "/" || value === "")) {
        currentAllowRoot = true;
      }
    }
    // sitemap / crawl-delay / host / other directives: no action needed here
  }

  flushGroup();
  return groups;
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
export function buildExtractedTextEvidence(body: string): {
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
 * Inline + tiny + zero-dependency by design — the alternative is pulling in
 * a sanitizer dep for ~5 lines of work.
 */
function sanitizeSnippet(input: string): string {
  // 1. Drop ASCII control chars except \t (0x09) and \n (0x0A)
  // eslint-disable-next-line no-control-regex
  const stripped = input.replace(/[\x00-\x08\x0B-\x1F]/g, "");
  // 2. Entity-encode HTML-special characters
  return stripped
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
