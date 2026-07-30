// @input  — blog data layer（本地 Markdown + 迁移期 legacy）、siteConfig、locale 路由参数
// @output — RSS 2.0 XML 响应，供 RSS 阅读器订阅
// @pos    — 博客 RSS feed 端点，按语言输出最近 20 篇已发布文章
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { getAllBlogPosts } from "@/lib/blog";
import { siteConfig } from "@/config/site";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeCdata(value: string): string {
  return value.replace(/]]>/g, "]]]]><![CDATA[>");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string }> }
) {
  const { locale } = await params;
  const posts = await getAllBlogPosts({ locale });

  const items = posts
    .slice(0, 20)
    .map(
      (post) => `
    <item>
      <title><![CDATA[${escapeCdata(post.title)}]]></title>
      <link>${siteConfig.url}/${locale}/blog/${encodeURIComponent(post.slug)}</link>
      <description><![CDATA[${escapeCdata(post.excerpt)}]]></description>
      <pubDate>${new Date(post.published_at).toUTCString()}</pubDate>
      <guid>${siteConfig.url}/${locale}/blog/${encodeURIComponent(post.slug)}</guid>
      <category>${escapeXml(post.category)}</category>
    </item>`
    )
    .join("");

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${siteConfig.name} Blog</title>
    <link>${siteConfig.url}/${locale}/blog</link>
    <description>Growth experiments, case studies, and methodology from ${siteConfig.name}</description>
    <language>${locale}</language>
    <atom:link href="${siteConfig.url}/${locale}/blog/rss.xml" rel="self" type="application/rss+xml" />
    ${items}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
