// @input  — siteConfig（站点 URL）
// @output — Next.js MetadataRoute.Robots，生成 /robots.txt
// @pos    — SEO 基础设施，控制爬虫访问策略（含 AI 爬虫白名单）
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/_next/", "/app/"],
      },
      // AI 爬虫（SPEC 8.1.4）
      { userAgent: "GPTBot", allow: "/" },
      { userAgent: "ClaudeBot", allow: "/" },
      { userAgent: "PerplexityBot", allow: "/" },
      { userAgent: "DeepseekBot", allow: "/" },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
  };
}
