// @input  -- cheerio CheerioAPI ($) over a parsed HTML document
// @output -- extractSocialMeta($): SocialMeta  (og:title/description/image + twitter:card presence)
//            extractHtmlLang($): string | null  (trimmed <html lang> value, null when absent/empty)
// @pos    -- A9 SOCIAL/LANG light-up. Pure extractors split out of page-fetcher.ts
//            (page-extractors.ts already >200 lines). og/twitter tag presence →
//            A9 SOCIAL.OG / SOCIAL.TWITTER rules; html[lang] → A9 LANG.HTML_LANG
//            rule. No I/O, no AI. Presence requires a non-empty content (honest).
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type * as cheerio from "cheerio";

import type { SocialMeta } from "./types";

type CheerioApi = ReturnType<typeof cheerio.load>;

/**
 * True when the document declares a `<meta>` for `key` (matched against either
 * the `property` or `name` attribute, case-insensitive) WITH a non-empty,
 * non-whitespace `content`. A tag present but empty is treated as ABSENT — an
 * empty og:title is no more useful to a crawler than a missing one, so we do
 * not fabricate "present" (Data-Layer honesty).
 */
function hasMetaWithContent($: CheerioApi, key: string): boolean {
  const target = key.toLowerCase();
  let found = false;
  $("meta").each((_, el) => {
    if (found) return false; // short-circuit
    const prop = ($(el).attr("property") ?? "").trim().toLowerCase();
    const name = ($(el).attr("name") ?? "").trim().toLowerCase();
    if (prop !== target && name !== target) return;
    const content = ($(el).attr("content") ?? "").trim();
    if (content.length > 0) found = true;
  });
  return found;
}

/**
 * Extract Open Graph + Twitter Card meta presence from a parsed HTML page.
 * Each flag is true only when the corresponding `<meta>` exists with a
 * non-empty content. Front-end markup presence only (no value validation).
 */
export function extractSocialMeta($: CheerioApi): SocialMeta {
  return {
    ogTitle: hasMetaWithContent($, "og:title"),
    ogDescription: hasMetaWithContent($, "og:description"),
    ogImage: hasMetaWithContent($, "og:image"),
    twitterCard: hasMetaWithContent($, "twitter:card"),
  };
}

/**
 * Extract the `<html lang>` attribute value, trimmed. Returns null when the
 * attribute is absent OR present-but-empty/whitespace (present-but-empty is no
 * more useful than missing; never fabricate a value). The first `<html>` element
 * is authoritative.
 */
export function extractHtmlLang($: CheerioApi): string | null {
  const raw = $("html").first().attr("lang");
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
