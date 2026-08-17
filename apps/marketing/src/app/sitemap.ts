// @input  — siteConfig、统一 blog 数据层
// @output — Next.js MetadataRoute.Sitemap，生成当前营销站（含 Resources Hub）的 canonical URL 集
// @pos    — SEO 基础设施；避免把旧实验页当成当前产品信息架构的一部分
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { MetadataRoute } from "next";
import { SITEMAP_TOOLS } from "../config/sitemap-tools";
import { getAllBlogPosts } from "../lib/blog";
import { getLegalDocument } from "../lib/legal";
import { localeUrl } from "../lib/locale-path";
import { getPrompts } from "../lib/prompt-content";
import { getSkills } from "../lib/skill-content";

// Keep this dynamic only while the read-only legacy Supabase bridge is enabled.
// Repository-backed Markdown posts are present during build and in the
// standalone trace; after the bridge is removed this may become static/ISR.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const locales = ["en", "zh"];
  const staticPages = [
    "",
    "/agents",
    "/agents/seo",
    // `/agents/tech` is deliberately absent: it is canonical to `/agents/seo`,
    // and listing a page here while its own markup points elsewhere asks for
    // the crawl budget of a page we are asking not to be indexed.
    "/resources",
    "/prompts",
    "/skills",
    // Keep the established Tools canonical. Resources changes navigation
    // grouping, not any existing public URL.
    "/tools",
    "/blog",
    "/pricing",
  ];

  const entries: MetadataRoute.Sitemap = [];

  // Static pages
  for (const locale of locales) {
    for (const page of staticPages) {
      const priority =
        page === ""
          ? 1.0
          : page === "/agents" ||
              page === "/resources" ||
              page === "/tools" ||
              page === "/prompts" ||
              page === "/skills"
            ? 0.9
            : page === "/agents/seo" ||
                page === "/blog" ||
                page === "/pricing"
              ? 0.8
              : 0.2;
      const changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] =
        page === "/blog" ? "weekly" : "monthly";

      entries.push({
        url: localeUrl(locale, page),
        changeFrequency,
        priority,
      });
    }
  }

  // Markdown posts are always included; any explicitly enabled legacy records
  // come from the same bridge used by list/detail/RSS routes.
  const [posts, legalDocuments] = await Promise.all([
    getAllBlogPosts(),
    Promise.all(
      locales.flatMap((locale) =>
        (["privacy", "terms", "cookies", "copyright"] as const).map(
          async (docType) => ({
            locale,
            docType,
            document: await getLegalDocument(docType, locale),
          }),
        ),
      ),
    ),
  ]);
  for (const post of posts) {
    entries.push({
      url: localeUrl(post.locale, `/blog/${post.slug}`),
      lastModified: new Date(post.updated_at),
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  // A legal URL stays reachable from the Footer even while its deployment-
  // managed document is absent. Only an actual current document is canonical
  // enough to place in the sitemap.
  for (const { locale, docType, document } of legalDocuments) {
    if (!document) continue;
    entries.push({
      url: localeUrl(locale, `/${docType}`),
      lastModified: new Date(document.effective_date),
      changeFrequency: "yearly",
      priority: 0.2,
    });
  }

  for (const locale of locales) {
    for (const tool of SITEMAP_TOOLS) {
      entries.push({
        url: localeUrl(locale, `/tools/${tool}`),
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  }

  // Resource detail pages are enumerated from the content directories rather
  // than a hand-kept list: unlike Tools, every file is exactly one live page,
  // so the directory is the authority and a second list could only drift from
  // it.
  //
  // Listed only for the locale whose file exists. A locale without a
  // translation still serves the page — navigation and the language switch
  // reach it — but offering that URL to crawlers would advertise a second
  // document carrying the same English text. The hubs stay listed in both
  // locales because their own copy is fully translated.
  for (const locale of locales) {
    const [prompts, skills] = await Promise.all([
      getPrompts(locale),
      getSkills(locale),
    ]);

    for (const prompt of prompts) {
      entries.push({
        url: localeUrl(locale, `/prompts/${prompt.slug}`),
        lastModified: new Date(prompt.updatedAt),
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }

    for (const skill of skills) {
      entries.push({
        url: localeUrl(locale, `/skills/${skill.slug}`),
        lastModified: new Date(skill.updatedAt),
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  }

  return entries;
}
