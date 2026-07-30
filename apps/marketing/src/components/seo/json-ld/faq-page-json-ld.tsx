// @input  -- faqs: { q: string; a: string }[]
// @output -- FaqPageJsonLd 组件 (FAQPage 结构化数据)
// @pos    -- json-ld 目录成员，FAQ 页面使用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { safeJsonLd } from "./utils";

export function FaqPageJsonLd({
  faqs,
}: {
  faqs: { q: string; a: string }[];
}) {
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.a,
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(faqLd) }}
    />
  );
}
