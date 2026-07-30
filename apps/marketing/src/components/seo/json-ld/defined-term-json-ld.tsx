// @input  -- name string, description string
// @output -- DefinedTerm JSON-LD script tag
// @pos    -- json-ld directory member, glossary term structured data for rich results
// once this file is updated, update header comments and _DIR.md in this folder
import { safeJsonLd } from "./utils";

interface DefinedTermJsonLdProps {
  readonly name: string;
  readonly description: string;
}

export function DefinedTermJsonLd({ name, description }: DefinedTermJsonLdProps) {
  const data = {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    name,
    description,
    inDefinedTermSet: {
      "@type": "DefinedTermSet",
      name: "GenGrowth Growth Glossary",
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  );
}
