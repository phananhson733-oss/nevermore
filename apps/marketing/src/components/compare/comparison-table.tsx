// @input  -- rows array with dimension/genGrowth/competitor, genGrowthLabel, competitorLabel
// @output -- ComparisonTable with responsive desktop table and mobile stacked cards
// @pos    -- compare page core component, used by all /compare/* detail pages
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

interface ComparisonRow {
  readonly dimension: string;
  readonly genGrowth: string;
  readonly competitor: string;
}

interface ComparisonTableProps {
  readonly rows: ReadonlyArray<ComparisonRow>;
  readonly genGrowthLabel?: string;
  readonly competitorLabel?: string;
}

export function ComparisonTable({
  rows,
  genGrowthLabel = "GenGrowth",
  competitorLabel = "Manual",
}: ComparisonTableProps) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-brand-border/60">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-brand-border/40 bg-brand-bg-alt/40">
              <th className="px-5 py-3 text-text-dark-secondary text-[13px] font-medium">
                Dimension
              </th>
              <th className="px-5 py-3 text-brand-accent text-[13px] font-medium">
                {genGrowthLabel}
              </th>
              <th className="px-5 py-3 text-text-dark-secondary text-[13px] font-medium">
                {competitorLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.dimension}
                className="border-b border-brand-border/20 last:border-b-0"
              >
                <td className="px-5 py-4 text-text-dark-primary text-[14px] font-medium">
                  {row.dimension}
                </td>
                <td className="px-5 py-4 text-brand-accent-text text-[14px]">
                  {row.genGrowth}
                </td>
                <td className="px-5 py-4 text-text-dark-secondary text-[14px]">
                  {row.competitor}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards */}
      <div className="md:hidden space-y-4">
        {rows.map((row) => (
          <div
            key={row.dimension}
            className="rounded-xl border border-brand-border/60 bg-brand-bg-alt/30 p-4"
          >
            <p className="text-text-dark-primary text-[14px] font-medium mb-3">
              {row.dimension}
            </p>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-brand-accent text-[12px] font-medium shrink-0 mt-0.5">
                  {genGrowthLabel}
                </span>
                <span className="text-brand-accent-text text-[13px]">
                  {row.genGrowth}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-text-dark-secondary text-[12px] font-medium shrink-0 mt-0.5">
                  {competitorLabel}
                </span>
                <span className="text-text-dark-secondary text-[13px]">
                  {row.competitor}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
