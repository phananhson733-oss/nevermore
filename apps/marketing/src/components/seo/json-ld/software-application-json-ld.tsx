// @input  -- none (static schema data)
// @output -- SoftwareApplication JSON-LD script tag
// @pos    -- homepage structured data, helps Google understand GenGrowth as a software product
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { safeJsonLd } from "./utils";

export function SoftwareApplicationJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "GenGrowth",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "Automated Growth Operating System — from minimal input to measurable growth through AI-powered discovery, strategy, execution, attribution, and optimization.",
    url: "https://gengrowth.ai",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "7-day free trial",
    },
    creator: {
      "@type": "Organization",
      name: "GenGrowth",
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  );
}
