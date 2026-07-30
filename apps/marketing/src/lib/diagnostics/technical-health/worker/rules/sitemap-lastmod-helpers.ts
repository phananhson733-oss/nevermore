// @input  -- raw sitemap XML body string + a reference `nowMs` epoch (injected)
// @output -- extractMaxLastmodAgeDays(body, nowMs): number | null
// @pos    -- A1 DATA.FRESHNESS light-up. Pure helper: parse all <lastmod> dates,
//            take the MOST RECENT (smallest age), return its age in whole days
//            relative to the caller-supplied `nowMs` (NEVER Date.now() — keeps the
//            data-source/rule deterministic and testable). null when no parseable
//            lastmod. Reflects sitemap-DECLARED freshness only. No I/O, no AI.
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

const DAY_MS = 24 * 60 * 60 * 1000;
/** Cap lastmod values parsed (defensive against huge sitemaps). */
const LASTMOD_PARSE_CAP = 5000;

/**
 * Extract the most-recent `<lastmod>` date from a sitemap body and return its
 * age in whole days relative to `nowMs`. Returns null when no `<lastmod>` element
 * carries a parseable date. A future date clamps to 0 (never negative).
 *
 * Determinism: `nowMs` is injected by the caller (the data-source captures the
 * run's reference time once; tests pass a fixed epoch). This function never reads
 * the wall clock.
 */
export function extractMaxLastmodAgeDays(
  body: string,
  nowMs: number,
): number | null {
  const matches = body.match(/<lastmod>([^<]+)<\/lastmod>/gi);
  if (!matches) return null;

  let mostRecentMs: number | null = null;
  let count = 0;
  for (const raw of matches) {
    if (count >= LASTMOD_PARSE_CAP) break;
    count += 1;
    const inner = raw.replace(/<\/?lastmod>/gi, "").trim();
    const parsed = Date.parse(inner);
    if (Number.isNaN(parsed)) continue;
    if (mostRecentMs === null || parsed > mostRecentMs) {
      mostRecentMs = parsed;
    }
  }

  if (mostRecentMs === null) return null;

  const ageMs = nowMs - mostRecentMs;
  // Future-dated lastmod ⇒ clamp to 0; floor to whole days.
  return Math.max(0, Math.floor(ageMs / DAY_MS));
}
