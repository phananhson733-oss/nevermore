// @input  -- items: { name: string; url?: string }[]
// @output -- BreadcrumbJsonLd 组件 (BreadcrumbList 结构化数据)
// @pos    -- json-ld 目录成员，多个页面使用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { safeJsonLd } from "./utils";

export function BreadcrumbJsonLd({
  items,
}: {
  items: { name: string; url?: string }[];
}) {
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      ...(item.url ? { item: item.url } : {}),
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbLd) }}
    />
  );
}
