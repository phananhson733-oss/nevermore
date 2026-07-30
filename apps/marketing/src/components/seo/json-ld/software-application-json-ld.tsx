// @input  -- none (static schema data)
// @output -- SoftwareApplication JSON-LD script tag
// @pos    -- homepage structured data, aligned with the current public-tools and project-workflow positioning
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
      "Evidence-led SEO growth system that connects public diagnostics, keyword research, site structure, internal links, and authority work into one project workflow.",
    url: "https://gengrowth.ai",
    featureList: [
      "Free public SEO audit",
      "Free public internal link audit",
      "Connected SEO project workflow",
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
