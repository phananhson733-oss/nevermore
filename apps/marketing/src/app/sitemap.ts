// @input  — siteConfig、统一 blog 数据层、getGlossaryTerms（术语数据）
// @output — Next.js MetadataRoute.Sitemap，生成 /sitemap.xml
// @pos    — SEO 基础设施，供搜索引擎发现所有页面
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { getAllBlogPosts } from "@/lib/blog";
import { getGlossaryTerms } from "@/lib/glossary";

// Keep this dynamic only while the read-only legacy Supabase bridge is enabled.
// Repository-backed Markdown posts are present during build and in the
// standalone trace; after the bridge is removed this may become static/ISR.
export const dynamic = "force-dynamic";

// Per-instance stable timestamp for STATIC routes. Previously every static entry
// emitted `lastModified: new Date()` (the crawl time), so Google saw every URL
// "modified" on every crawl, which trains it to distrust our lastmod signal.
// BUILD_DATE is evaluated once at module load, i.e. per serverless cold start:
// NOT per request (the real win), but also NOT strictly per deploy. A scale-to-
// zero cold start hours later restamps it, and concurrent instances can differ.
// That is far better than per-request churn, but it is not a single content-
// signed date. For true per-deploy/content stability, inject a build-time
// timestamp or port oracle's content-hash lastmod manifest
// (seo-lastmod-manifest.json). Blog posts already use real post.updated_at below.
const BUILD_DATE = new Date();

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const locales = ["en", "zh"];
  const staticPages = [
    "",
    "/features",
    "/pricing",
    "/playbooks",
    "/templates",
    "/about",
    "/contact",
    "/blog",
    "/glossary",
    "/tools",
    "/compare",
    "/use-cases",
    "/privacy",
    "/terms",
    "/cookies",
    "/copyright",
  ];

  const entries: MetadataRoute.Sitemap = [];

  // Static pages
  for (const locale of locales) {
    for (const page of staticPages) {
      const priority =
        page === ""
          ? 1.0
          : page === "/glossary" || page === "/tools"
            ? 0.7
            : 0.8;
      const changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] =
        page === "/blog" ? "daily" : "weekly";

      entries.push({
        url: `${siteConfig.url}/${locale}${page}`,
        lastModified: BUILD_DATE,
        changeFrequency,
        priority,
      });
    }
  }

  // Markdown posts are always included; any explicitly enabled legacy records
  // come from the same bridge used by list/detail/RSS routes.
  const posts = await getAllBlogPosts();
  for (const post of posts) {
    entries.push({
      url: `${siteConfig.url}/${post.locale}/blog/${post.slug}`,
      lastModified: new Date(post.updated_at),
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  // Blog category pages
  const blogCategories = [
    "case-study",
    "methodology",
    "weekly-review",
    "experiment-log",
  ];
  for (const locale of locales) {
    for (const category of blogCategories) {
      entries.push({
        url: `${siteConfig.url}/${locale}/blog/category/${category}`,
        lastModified: BUILD_DATE,
        changeFrequency: "weekly",
        priority: 0.5,
      });
    }
  }

  // Tool pages
  const tools = [
    "ab-test-calculator",
    "growth-roi-calculator",
    "seo-audit",
  ];
  for (const locale of locales) {
    for (const tool of tools) {
      entries.push({
        url: `${siteConfig.url}/${locale}/tools/${tool}`,
        lastModified: BUILD_DATE,
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  }

  // Compare pages
  const compareSlugs = ["manual-growth"];
  for (const locale of locales) {
    for (const slug of compareSlugs) {
      entries.push({
        url: `${siteConfig.url}/${locale}/compare/${slug}`,
        lastModified: BUILD_DATE,
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  }

  // Use Case pages
  const useCaseSlugs = ["saas-zero-to-1000", "content-site-seo-scale"];
  for (const locale of locales) {
    for (const slug of useCaseSlugs) {
      entries.push({
        url: `${siteConfig.url}/${locale}/use-cases/${slug}`,
        lastModified: BUILD_DATE,
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  }

  // Glossary term pages (skip if Supabase unavailable at build time)
  try {
    const allSlugs = new Set<string>();
    for (const locale of locales) {
      const terms = await getGlossaryTerms(locale);
      for (const term of terms) {
        allSlugs.add(term.slug);
      }
    }

    for (const slug of allSlugs) {
      for (const locale of locales) {
        entries.push({
          url: `${siteConfig.url}/${locale}/glossary/${slug}`,
          lastModified: BUILD_DATE,
          changeFrequency: "monthly",
          priority: 0.6,
        });
      }
    }
  } catch {
    // Supabase not available at build time — skip glossary terms
  }

  return entries;
}
