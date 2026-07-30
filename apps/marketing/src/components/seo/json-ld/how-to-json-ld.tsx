// @input  -- name string, steps array of {name, text}
// @output -- HowTo JSON-LD script tag
// @pos    -- features page structured data, helps Google show how-to rich results
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { safeJsonLd } from "./utils";

interface HowToJsonLdProps {
  readonly name: string;
  readonly steps: ReadonlyArray<{
    readonly name: string;
    readonly text: string;
  }>;
}

export function HowToJsonLd({ name, steps }: HowToJsonLdProps) {
  const data = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name,
    step: steps.map((s) => ({
      "@type": "HowToStep",
      name: s.name,
      text: s.text,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  );
}
