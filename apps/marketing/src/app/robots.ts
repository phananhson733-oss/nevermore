// @input  — siteConfig（站点 URL）
// @output — Next.js MetadataRoute.Robots，生成 /robots.txt
// @pos    — SEO 基础设施，控制爬虫访问策略（含 AI 爬虫白名单）
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { MetadataRoute } from "next";
import { siteConfig } from "../config/site";

/**
 * 非内容路径。每个具名 user-agent 组都要重复声明一次：robots.txt 里
 * 一个 UA 匹配到自己的组之后就**不再继承** `*` 的规则，只写 `Allow: /`
 * 会让该 UA 的权限反而大于 Googlebot。
 *
 * 不含 `/_next/`：Google 明确要求不要屏蔽渲染所需的 CSS/JS，屏蔽它会
 * 影响渲染判定；静态资源本身不构成可索引内容，无需 disallow。
 */
const NON_CONTENT_PATHS = [
  "/api/",
  "/app/",
  "/*?*category=",
  "/*?*pillar=",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: NON_CONTENT_PATHS,
      },
      // AI 爬虫（SPEC 8.1.4）
      // 训练型：抓取内容供模型训练使用
      { userAgent: "GPTBot", allow: "/", disallow: NON_CONTENT_PATHS },
      { userAgent: "ClaudeBot", allow: "/", disallow: NON_CONTENT_PATHS },
      { userAgent: "DeepseekBot", allow: "/", disallow: NON_CONTENT_PATHS },
      // 检索/引用型：与训练型是不同 UA，屏蔽它们会让对应产品
      // 无法在回答里引用本站。OAI-SearchBot 服务 ChatGPT 搜索；
      // PerplexityBot 是 Perplexity 的搜索引用爬虫（不做模型训练）。
      { userAgent: "OAI-SearchBot", allow: "/", disallow: NON_CONTENT_PATHS },
      { userAgent: "PerplexityBot", allow: "/", disallow: NON_CONTENT_PATHS },
      // 授权令牌，不是爬虫：抓取始终由 Googlebot 完成，Google-Extended
      // 只决定内容能否被 Gemini App / Vertex AI 使用。它不影响 Google
      // Search 的收录与排名，也控制不了 AI Overviews —— 后者属于 Search，
      // 用的是 Googlebot 的数据，唯一杠杆是 nosnippet / max-snippet。
      { userAgent: "Google-Extended", allow: "/", disallow: NON_CONTENT_PATHS },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
  };
}
