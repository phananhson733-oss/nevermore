// @input  — routing 配置（locales/defaultLocale）、siteConfig（站点 URL）
// @output — localePath()/localeUrl()/stripLocalePrefix()：按 as-needed 规则生成站内路径与绝对 URL
// @pos    — i18n 链接工具层，被页面内链、面包屑、JSON-LD、语言切换与 SEO metadata 共用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
// Relative imports, not the `@/` alias: the shared Vitest config maps `@/` to
// apps/web only, so an aliased runtime import here would not resolve in tests.
import { siteConfig } from "../config/site";
import { routing } from "../i18n/routing";

/** Matches a locale only as a whole leading segment: /zh, /zh/x — never /zhuanti. */
const localePrefixPattern = new RegExp(
  `^/(?:${routing.locales.join("|")})(?=/|$)`,
);

/**
 * Builds an in-site path under the `as-needed` locale prefix rule: the default
 * locale is served unprefixed (`/pricing`), every other locale keeps its prefix
 * (`/zh/pricing`). Centralizing this keeps internal links pointing at canonical
 * URLs instead of at the /en/* forms that proxy.ts redirects away.
 *
 * @param path Path below the locale root, with a leading slash. Empty means the
 *   locale home.
 */
export function localePath(locale: string, path = ""): string {
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  const suffix = path === "/" ? "" : path;
  return `${prefix}${suffix}` || "/";
}

/** Absolute canonical URL for a locale path — for JSON-LD, sitemap and metadata. */
export function localeUrl(locale: string, path = ""): string {
  return `${siteConfig.url}${localePath(locale, path)}`;
}

/**
 * Removes a leading locale segment, yielding the locale-agnostic path that
 * `localePath` takes. Under `as-needed` the default locale carries no prefix,
 * so callers cannot assume one is present — the language switcher relies on
 * this to re-prefix the current page for the target locale.
 */
export function stripLocalePrefix(pathname: string): string {
  return pathname.replace(localePrefixPattern, "");
}
