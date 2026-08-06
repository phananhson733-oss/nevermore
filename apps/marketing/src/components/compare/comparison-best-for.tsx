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
    <div className="mt-16 border-t border-brand-border pt-14">
      <h2 className="mb-7 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
        {heading}
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* GenGrowth —— 走强调卡片配方（左侧 inset 高亮条） */}
        <div className="rounded-card border border-brand-accent/50 bg-brand-accent/[0.08] p-[26px] shadow-[inset_2px_0_0_#3DDC97]">
          <h3 className="mb-4 text-[15.5px] font-semibold text-brand-accent-text">
            {gengrowthLabel}
          </h3>
          <ul className="space-y-2.5">
            {gengrowthItems.map((item) => (
              <li
                key={item}
                className="relative pl-4 text-[13px] leading-[1.6] text-text-dark-strong before:absolute before:top-[8px] before:left-0 before:h-1 before:w-1 before:rounded-full before:bg-brand-accent before:content-['']"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
        {/* Competitor —— 标准卡片 */}
        <div className="rounded-card border border-brand-border-card bg-brand-panel p-[26px]">
          <h3 className="mb-4 text-[15.5px] font-semibold text-text-dark-primary">
            {competitorLabel}
          </h3>
          <ul className="space-y-2.5">
            {competitorItems.map((item) => (
              <li
                key={item}
                className="relative pl-4 text-[13px] leading-[1.6] text-text-dark-secondary before:absolute before:top-[8px] before:left-0 before:h-1 before:w-1 before:rounded-full before:bg-text-dark-faint before:content-['']"
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
