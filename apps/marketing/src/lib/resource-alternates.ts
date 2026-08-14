// @input  — 基础 metadata、路由 locale、内容实际所属 locale 与拥有该 slug 文件的 locale 集合
// @output — 按内容归属修正后的 canonical / hreflang
// @pos    — Prompt / Skill 详情页共享；决定一个回退页面如何向搜索引擎自我描述
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import type { Metadata } from "next";

import { localeUrl } from "./locale-path";
import { routing } from "../i18n/routing";

interface ResourceAlternatesInput {
  readonly metadata: Metadata;
  /** The locale in the URL being rendered. */
  readonly locale: string;
  /** The locale whose file actually supplied the content. */
  readonly owningLocale: string;
  readonly path: string;
  /** Every locale that has its own file for this slug. */
  readonly localesOwningFile: readonly string[];
}

/**
 * Describe a resource page to search engines by who owns its content.
 *
 * A locale without its own file still serves the page — navigation and the
 * language switch reach it, and the surrounding UI is translated. But its body
 * is the owning locale's text, so it must not self-canonicalise and must not
 * announce itself as that language's version. Doing both is what turns a UX
 * fallback into an indexable duplicate competing with the page it copied.
 *
 * Only locales that own a file get an hreflang entry, and `x-default` points at
 * a URL that exists — never at a locale that has no file for this slug.
 */
export function resourceAlternates({
  metadata,
  locale,
  owningLocale,
  path,
  localesOwningFile,
}: ResourceAlternatesInput): Metadata {
  const owners =
    localesOwningFile.length > 0 ? localesOwningFile : [owningLocale];

  const languages: Record<string, string> = {};
  for (const owner of owners) {
    languages[owner] = localeUrl(owner, path);
  }
  // Prefer the default locale as x-default when it owns a file; otherwise point
  // at the owning locale, which is guaranteed to resolve.
  const fallbackDefault = owners.includes(routing.defaultLocale)
    ? routing.defaultLocale
    : (owners[0] ?? owningLocale);
  languages["x-default"] = localeUrl(fallbackDefault, path);

  const canonical = localeUrl(owningLocale, path);
  const isFallbackRoute = owningLocale !== locale;

  return {
    ...metadata,
    alternates: { canonical, languages },
    // The social card should name the page a share actually lands on.
    ...(isFallbackRoute && metadata.openGraph
      ? { openGraph: { ...metadata.openGraph, url: canonical } }
      : {}),
  };
}
