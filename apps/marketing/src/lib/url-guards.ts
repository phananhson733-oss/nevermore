// @input  -- string URL value of unknown provenance (Evidence.url, sampleUrls, future Strategy/Compliance URLs)
// @output -- isSafeUrl(value): boolean — true iff value parses as an http(s) URL; false rejects javascript: / data: / file: / mailto: / fallthrough garbage
// @pos    -- W3a.2 main health audit Plan A — H5 single SOT for the http(s) scheme guard. Replaces the duplicated SAFE_URL_RE in affected-urls-list.tsx + finding-evidence-card.tsx; future SDK consumers (CSV exporter, mobile client, AI Strategy) use the same helper so the regex never drifts across surfaces.
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Match an http or https URL prefix. The `/i` flag accepts `HTTP://` /
 * `Https://` cases that may flow through worker-normalized data, the
 * Supabase row, and back to the UI. Anchored at start so strings like
 * `not-a-url-https://...` cannot bypass.
 *
 * Defense scope:
 *  - blocks `javascript:` (XSS in `<a href>`)
 *  - blocks `data:` (XSS via base64 / SVG payload)
 *  - blocks `file:` (local file read on user agents that allow it)
 *  - blocks `mailto:`, `tel:`, `vbscript:`, etc. — none of which the
 *    diagnostic surfaces ever legitimately render
 */
export const SAFE_URL_RE = /^https?:\/\//i;

/**
 * Pure boolean wrapper around the regex. Use this instead of duplicating the
 * `SAFE_URL_RE.test(...)` call across components — it keeps the import
 * surface narrow and lets a future audit grep for a single call site.
 *
 * @example
 *   const safe = isSafeUrl(evidence.url);
 *   return safe ? <a href={evidence.url}>...</a> : <span>{evidence.url}</span>;
 */
export function isSafeUrl(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  return SAFE_URL_RE.test(value);
}
