// @input  -- localized public-tool name, description, and canonical URL
// @output -- page-specific free SoftwareApplication JSON-LD
// @pos    -- structured data for standalone GenGrowth public tool routes

import { safeJsonLd } from "./utils";

interface ToolSoftwareApplicationJsonLdProps {
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly featureList?: readonly string[];
}

export function ToolSoftwareApplicationJsonLd({
  name,
  description,
  url,
  featureList,
}: ToolSoftwareApplicationJsonLdProps) {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name,
    applicationCategory: "SEOApplication",
    operatingSystem: "Web",
    description,
    url,
    ...(featureList ? { featureList } : {}),
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    creator: {
      "@type": "Organization",
      name: "GenGrowth",
      url: "https://gengrowth.ai",
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  );
}
