// @input  -- gengrowth/competitor best-for lists, labels
// @output -- ComparisonBestFor side-by-side "best for" cards
// @pos    -- compare page component, used by all /compare/[slug] detail pages
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

interface ComparisonBestForProps {
  readonly gengrowthItems: ReadonlyArray<string>;
  readonly competitorItems: ReadonlyArray<string>;
  readonly gengrowthLabel: string;
  readonly competitorLabel: string;
  readonly heading: string;
}

export function ComparisonBestFor({
  gengrowthItems,
  competitorItems,
  gengrowthLabel,
  competitorLabel,
  heading,
}: ComparisonBestForProps) {
  return (
    <div className="mt-12">
      <h2 className="text-text-dark-primary font-semibold text-[22px] mb-6">
        {heading}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* GenGrowth */}
        <div className="rounded-xl border border-brand-accent/30 bg-brand-accent/[0.05] p-5">
          <h3 className="text-brand-accent-text font-semibold text-[15px] mb-3">
            {gengrowthLabel}
          </h3>
          <ul className="space-y-2">
            {gengrowthItems.map((item) => (
              <li
                key={item}
                className="text-text-dark-secondary text-[13px] leading-relaxed pl-4 relative before:content-[''] before:absolute before:left-0 before:top-[7px] before:w-1.5 before:h-1.5 before:rounded-full before:bg-brand-accent/60"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
        {/* Competitor */}
        <div className="rounded-xl border border-brand-border/60 bg-brand-bg-alt/30 p-5">
          <h3 className="text-text-dark-primary font-semibold text-[15px] mb-3">
            {competitorLabel}
          </h3>
          <ul className="space-y-2">
            {competitorItems.map((item) => (
              <li
                key={item}
                className="text-text-dark-secondary text-[13px] leading-relaxed pl-4 relative before:content-[''] before:absolute before:left-0 before:top-[7px] before:w-1.5 before:h-1.5 before:rounded-full before:bg-text-dark-secondary/40"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
