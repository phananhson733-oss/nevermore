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
      {/* Desktop table：表头走 sunken 底 + mono 小标签，行分隔用最淡的一级描边 */}
      <div className="hidden overflow-x-auto rounded-card border border-brand-border-card bg-brand-panel md:block">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-brand-border bg-brand-panel-sunken">
              <th className="px-5 py-3 font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
                Dimension
              </th>
              <th className="px-5 py-3 font-mono text-[10px] tracking-[0.12em] text-brand-accent-text uppercase">
                {genGrowthLabel}
              </th>
              <th className="px-5 py-3 font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
                {competitorLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.dimension}
                className="border-b border-brand-border-faint last:border-b-0"
              >
                <td className="px-5 py-4 text-[13.5px] leading-[1.6] font-medium text-text-dark-primary">
                  {row.dimension}
                </td>
                <td className="px-5 py-4 text-[13.5px] leading-[1.6] text-brand-accent-text">
                  {row.genGrowth}
                </td>
                <td className="px-5 py-4 text-[13.5px] leading-[1.6] text-text-dark-secondary">
                  {row.competitor}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards：窄屏换成标准卡片，标签上移成 mono 小标签 */}
      <div className="space-y-3.5 md:hidden">
        {rows.map((row) => (
          <div
            key={row.dimension}
            className="rounded-card border border-brand-border-card bg-brand-panel p-[22px]"
          >
            <p className="text-[13.5px] font-medium text-text-dark-primary">
              {row.dimension}
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <span className="block font-mono text-[10px] tracking-[0.12em] text-brand-accent-text uppercase">
                  {genGrowthLabel}
                </span>
                <span className="mt-1 block text-[13px] leading-[1.6] text-brand-accent-text">
                  {row.genGrowth}
                </span>
              </div>
              <div>
                <span className="block font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
                  {competitorLabel}
                </span>
                <span className="mt-1 block text-[13px] leading-[1.6] text-text-dark-secondary">
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
