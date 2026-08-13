// @input  -- none (static schema data)
// @output -- SoftwareApplication JSON-LD script tag
// @pos    -- homepage structured data, aligned with account-gated Agent audits
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
      "Evidence-led SEO growth system with independent SEO and Tech URL audit Agents. A verified GenGrowth account is required before an audit; current runs use public static HTML and are not persisted.",
    url: "https://gengrowth.ai",
    featureList: [
      "Account-gated SEO Agent for metadata, headings, and structured data",
      "Account-gated Tech Agent for crawl, indexability, and internal links",
      "No payment, Search Console connection, or site-ownership verification required for current Agent audits",
      "No persistence for current Agent audit runs",
    ],
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
